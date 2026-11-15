// The Processes surface: list, output paging, mark as good, stop and stop-all, plus the
// liveness rule that turns a stale "running" into "Needs checking".
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createDevServers } from "./dev-server.mjs";

const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "ade-processes-")));
process.once("exit", () => rmSync(home, { recursive: true, force: true }));
mkdirSync(path.join(home, ".ade"), { mode: 0o700 });
process.env.HOME = home;
process.env.USERPROFILE = home;

const projectDir = path.join(home, "project");
mkdirSync(projectDir);
const otherDir = path.join(home, "other");
mkdirSync(otherDir);
// A project with a real dev script, so a start through the API can record its session.
const scriptDir = path.join(home, "scripted");
mkdirSync(scriptDir);
writeFileSync(
  path.join(scriptDir, "package.json"),
  JSON.stringify({ name: "scripted", scripts: { dev: "node server.js" } }),
);
writeFileSync(
  path.join(scriptDir, "server.js"),
  "require('node:http').createServer((q, s) => s.end('ok')).listen(Number(process.env.PORT), '127.0.0.1');\n",
);

/** A long-lived process whose working folder is the project, so ADE can recognise it. */
function alive(cwd = projectDir) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    cwd,
    stdio: "ignore",
  });
  return child;
}

const processes = [
  {
    id: "p-preview",
    projectId: "p-1",
    sessionId: "s-1",
    name: "Development server",
    command: "npm run dev",
    port: 45871,
    status: "running",
    pid: alive().pid,
    startedAt: 10,
    output: ["line one", "line two", "line three"],
  },
  {
    id: "p-watcher",
    projectId: "p-1",
    sessionId: "s-2",
    name: "Test watcher",
    command: "node --test --watch",
    port: 0,
    status: "running",
    pid: alive().pid,
    startedAt: 20,
    output: ["watch one"],
  },
  {
    id: "p-other",
    projectId: "p-2",
    name: "Other project server",
    command: "npm run dev",
    port: 45872,
    status: "running",
    pid: alive(otherDir).pid,
    startedAt: 30,
    output: [],
  },
];

writeFileSync(
  path.join(home, ".ade", "workspace.json"),
  JSON.stringify({
    projects: [
      {
        id: "p-1",
        name: "project",
        path: projectDir,
        branch: "not a git repository",
        ahead: 0,
        uncommittedFiles: [],
        defaultAgent: "codex",
        addedAt: 1,
      },
      {
        id: "p-script",
        name: "scripted",
        path: scriptDir,
        branch: "not a git repository",
        ahead: 0,
        uncommittedFiles: [],
        defaultAgent: "codex",
        addedAt: 1,
      },
      {
        id: "p-2",
        name: "other",
        path: otherDir,
        branch: "not a git repository",
        ahead: 0,
        uncommittedFiles: [],
        defaultAgent: "codex",
        addedAt: 1,
      },
    ],
    sessions: [
      {
        id: "s-1",
        projectId: "p-1",
        agentId: "codex",
        createdBy: "codex",
        request: "start the app",
        criteria: "",
        status: "ready",
        messages: [],
        changes: [],
        checks: [],
        logs: [],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "s-script",
        projectId: "p-script",
        agentId: "codex",
        createdBy: "codex",
        request: "start the scripted app",
        criteria: "",
        status: "ready",
        messages: [],
        changes: [],
        checks: [],
        logs: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    processes,
  }),
);
writeFileSync(
  path.join(home, ".ade", "agents-status.json"),
  JSON.stringify({ fetchedAt: Date.now(), agents: [] }),
);

const { callApi } = await import("./api-request.test-helper.mjs");
const { handle, start, _setProcessStatusForTest, stop } = await import("./ade-local.mjs");
await start();
const url = (suffix) => `http://127.0.0.1:3100${suffix}`;
const json = async (response) => ({ status: response.status, body: await response.json() });

test("lists this project's processes with their addresses and line counts", async () => {
  const { status, body } = await json(
    await callApi(handle, { url: url("/api/projects/p-1/processes") }),
  );
  assert.equal(status, 200);
  assert.deepEqual(body.ade, { app: null, unmanaged: [] }, "no listen address in this harness");
  assert.deepEqual(
    body.processes.map((proc) => proc.id),
    ["p-preview", "p-watcher"],
  );
  const preview = body.processes[0];
  assert.equal(preview.address, "http://127.0.0.1:45871/");
  assert.deepEqual(preview.addresses, ["http://127.0.0.1:45871/"]);
  assert.equal(preview.lineCount, 3);
  assert.equal(preview.sessionId, "s-1");
  assert.equal(body.processes[1].address, null);
});

test("pages output by line count and resets when the reader is ahead", async () => {
  const page = await json(
    await callApi(handle, { url: url("/api/processes/p-preview/output?after=1") }),
  );
  assert.equal(page.status, 200);
  assert.deepEqual(
    page.body.lines.map((line) => [line.n, line.text]),
    [
      [2, "line two"],
      [3, "line three"],
    ],
  );
  assert.equal(page.body.next, 3);
  assert.equal(page.body.reset, false);

  const ahead = await json(
    await callApi(handle, { url: url("/api/processes/p-preview/output?after=99") }),
  );
  assert.equal(ahead.body.reset, true);
  assert.equal(ahead.body.lines.length, 3);
});

test("marking a process as good clears Needs checking", async () => {
  assert.equal(_setProcessStatusForTest("p-preview", "unverified"), true);
  const marked = await json(
    await callApi(handle, { url: url("/api/processes/p-preview/ack"), method: "POST" }),
  );
  assert.equal(marked.status, 200);
  assert.equal(marked.body.process.status, "running");
  assert.ok(marked.body.process.verifiedAt);
});

test("stopping one process records the stop and drops its address", async () => {
  const stopped = await json(
    await callApi(handle, { url: url("/api/processes/p-preview/stop"), method: "POST" }),
  );
  assert.equal(stopped.status, 200);
  const list = await json(await callApi(handle, { url: url("/api/projects/p-1/processes") }));
  const preview = list.body.processes.find((proc) => proc.id === "p-preview");
  assert.equal(preview.status, "stopped");
  assert.equal(preview.address, null);
  assert.ok(preview.stoppedAt);
});

test("stop all stops every process in the project and reports failures", async () => {
  const result = await json(
    await callApi(handle, {
      url: url("/api/projects/p-1/processes/stop-all"),
      method: "POST",
    }),
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.failed, []);
  assert.deepEqual(result.body.stopped.sort(), ["p-preview", "p-watcher"]);
  const list = await json(await callApi(handle, { url: url("/api/projects/p-1/processes") }));
  assert.ok(list.body.processes.every((proc) => proc.status === "stopped"));
});

test("a start through the dev route records the conversation that asked for it", async () => {
  const started = await json(
    await callApi(handle, {
      url: url("/api/projects/p-script/dev/start"),
      method: "POST",
      body: { sessionId: "s-script" },
    }),
  );
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.status, "running");
  const list = await json(await callApi(handle, { url: url("/api/projects/p-script/processes") }));
  const record = list.body.processes[0];
  assert.equal(record.sessionId, "s-script");
  assert.equal(record.source, "package_script");
  assert.ok(record.address);
  const stopResult = await json(
    await callApi(handle, { url: url("/api/projects/p-script/dev/stop"), method: "POST" }),
  );
  assert.equal(stopResult.status, 200);
});

test("a running process whose port stops answering becomes Needs checking", async () => {
  const child = alive();
  const proc = {
    id: "p-liveness",
    projectId: "p-1",
    name: "Watcher",
    command: "node --test --watch",
    port: 45999,
    status: "running",
    pid: child.pid,
    output: [],
  };
  const state = {
    projects: [{ id: "p-1", path: projectDir }],
    processes: [proc],
  };
  const devServers = createDevServers({ state, save: async () => {} });
  await devServers.checkProcesses();
  assert.equal(proc.status, "running", "one dropped probe is not enough");
  await devServers.checkProcesses();
  assert.equal(proc.status, "unverified");
  devServers.markGood(proc);
  assert.equal(proc.status, "running");
  child.kill("SIGTERM");
});

test.after(async () => {
  for (const proc of processes) {
    if (!proc.pid) continue;
    try {
      process.kill(proc.pid, "SIGTERM");
    } catch {
      /* already stopped by the test */
    }
  }
  await stop();
});
