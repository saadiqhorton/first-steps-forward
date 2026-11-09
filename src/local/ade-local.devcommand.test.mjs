// Agent-proposed dev commands through ADE's API (docs/adr/0005): the agent proposes, the user
// approves once in the session, and ADE runs the command itself. Real spawns, real ports.
import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

// A throwaway HOME before ade-local is imported, so start() loads only this workspace.
const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "ade-devcmd-")));
process.once("exit", () => rmSync(home, { recursive: true, force: true }));
mkdirSync(path.join(home, ".ade"), { mode: 0o700 });
process.env.HOME = home;
process.env.USERPROFILE = home;

const posixOnly = process.platform === "win32" ? "uses POSIX shims and symlinks" : false;
const node = JSON.stringify(process.execPath);
// Records how it was launched into launched.json in its working folder, then serves on the
// port from --listen <n>, or PORT.
const recorder = path.join(home, "recorder.cjs");
writeFileSync(
  recorder,
  `const fs = require("node:fs");
const args = process.argv.slice(2);
fs.writeFileSync("launched.json", JSON.stringify({ argv: args, PORT: process.env.PORT, HOST: process.env.HOST, PATH: process.env.PATH, cwd: process.cwd() }));
const at = args.indexOf("--listen");
const port = at >= 0 ? Number(args[at + 1]) : Number(process.env.PORT);
require("node:http").createServer((q, s) => s.end("ok")).listen(port, "127.0.0.1");
`,
);

const projects = [];
const sessions = [];
/** A project folder (with a session asking in it) seeded into the workspace. */
function seed(name, files = {}) {
  const dir = path.join(home, name);
  mkdirSync(dir);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  projects.push({
    id: `p-${name}`,
    name,
    path: dir,
    branch: "not a git repository",
    ahead: 0,
    uncommittedFiles: [],
    defaultAgent: "codex",
    addedAt: 1,
  });
  sessions.push({
    id: `s-${name}`,
    projectId: `p-${name}`,
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
  });
  return dir;
}
/** A console script in a virtualenv's bin folder that runs the recorder. */
function venvScript(dir, name) {
  const bin = path.join(dir, ".venv", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${recorder}" "$@"\n`);
  chmodSync(path.join(bin, name), 0o755);
}

const approveDir = seed("approve", { "ui/.keep": "" });
if (!posixOnly) {
  venvScript(path.join(approveDir, "ui"), "fakeserve");
  mkdirSync(path.join(approveDir, ".venv", "bin"), { recursive: true });
}
seed("deny");
const validateDir = seed("validate", { "ui/.keep": "", "notes.txt": "" });
const fixedDir = seed("fixed");
seed("script", {
  "package.json": JSON.stringify({ name: "x", scripts: { dev: "node server.js" } }),
  "server.js":
    "require('node:http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.PORT));\n",
});
const nosessionDir = seed("nosession");
seed("wait");
seed("e2e", {
  "server.js":
    "require('node:http').createServer((q,s)=>s.end('hello from the app')).listen(Number(process.env.PORT), '127.0.0.1');\n",
});

writeFileSync(
  path.join(home, ".ade", "agents-status.json"),
  JSON.stringify({ fetchedAt: Date.now(), agents: [] }),
);
writeFileSync(
  path.join(home, ".ade", "workspace.json"),
  JSON.stringify({ projects, sessions, processes: [] }),
);

const {
  handle,
  start,
  setListenAddress,
  computerContext,
  _getSessionForTest,
  _setDevApprovalWaitForTest,
} = await import("./ade-local.mjs");
const { callApi } = await import("./api-request.test-helper.mjs");
await start();

const call = async (urlPath, body) => {
  const res = await callApi(handle, { url: `http://127.0.0.1:3000${urlPath}`, body });
  return { status: res.status, json: await res.json() };
};
const startDev = (name, body) => call(`/api/projects/p-${name}/dev/start`, body);
const stopDev = (name) => call(`/api/projects/p-${name}/dev/stop`, {});
const asked = (name) => _getSessionForTest(`s-${name}`).pendingDevCommand;
const answer = (name, request, decision) =>
  call(`/api/projects/p-${name}/dev/command/answer`, {
    requestId: request.id,
    decision,
  });
async function waitFor(check, what) {
  for (let i = 0; i < 400; i += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}
const bootstrapProject = async (name) =>
  (await call("/api/bootstrap")).json.projects.find((p) => p.id === `p-${name}`);
const freePort = () =>
  new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
      server.close(() => resolve(port));
    });
  });

test(
  "approve once: ADE runs the parsed argv with {port}, PORT/HOST and the venv on PATH, then reuses it",
  { skip: posixOnly },
  async () => {
    const ui = path.join(approveDir, "ui");
    const command = 'fakeserve --port {port} "two words"';
    try {
      // Proposing waits for the user and spawns nothing; the session needs you.
      const proposing = startDev("approve", { command, cwd: "ui/", sessionId: "s-approve" });
      const request = await waitFor(() => asked("approve"), "the dev command request");
      assert.deepEqual(
        { kind: request.kind, command: request.command, cwd: request.cwd },
        { kind: "dev_command", command, cwd: "ui" },
      );
      assert.equal(existsSync(path.join(ui, "launched.json")), false);
      const summary = (await call("/api/bootstrap")).json.sessions.find(
        (s) => s.id === "s-approve",
      );
      assert.equal(summary.pendingDevCommand?.command, command);
      assert.equal(summary.pendingPermissions, undefined);

      const allowed = await answer("approve", request, "allow");
      assert.equal(allowed.status, 200);
      const up = await proposing;
      assert.equal(up.status, 200, JSON.stringify(up.json));
      assert.equal(up.json.status, "running");
      assert.equal(up.json.approved, true);
      assert.equal(up.json.source, "approved_command");
      assert.equal(up.json.command, command);
      assert.ok(up.json.port > 0);
      assert.equal(asked("approve"), undefined);

      const launched = JSON.parse(readFileSync(path.join(ui, "launched.json"), "utf8"));
      assert.deepEqual(launched.argv, ["--port", String(up.json.port), "two words"]);
      assert.equal(launched.PORT, String(up.json.port));
      assert.equal(launched.HOST, "127.0.0.1");
      assert.equal(launched.cwd, ui);
      const [first, second] = launched.PATH.split(path.delimiter);
      assert.equal(first, path.join(ui, ".venv", "bin"));
      assert.equal(second, path.join(approveDir, ".venv", "bin"));

      const project = await bootstrapProject("approve");
      assert.equal(project.devCommand.command, command);
      assert.equal(project.devCommand.cwd, "ui");
      assert.ok(project.devCommand.approvedAt > 0);
      const status = await call("/api/projects/p-approve/dev");
      assert.equal(status.json.status, "running");
      assert.match(
        status.json.summary,
        /approved dev command `fakeserve --port \{port\} "two words"` in ui/,
      );
      assert.equal((await stopDev("approve")).json.status, "stopped");

      // Reused with no new approval: no arguments, or the same command and folder.
      rmSync(path.join(ui, "launched.json"));
      const again = await startDev("approve", {});
      assert.equal(again.json.status, "running");
      assert.equal(asked("approve"), undefined);
      await stopDev("approve");
      const same = await startDev("approve", { command, cwd: "./ui", sessionId: "s-approve" });
      assert.equal(same.json.status, "running");
      assert.equal(asked("approve"), undefined);
      await stopDev("approve");

      // A different command needs its own approval; declining it keeps the approved one.
      const other = startDev("approve", {
        command: "fakeserve --other",
        cwd: "ui",
        sessionId: "s-approve",
      });
      const proposedOther = await waitFor(() => asked("approve"), "the second request");
      assert.equal(proposedOther.command, "fakeserve --other");
      await answer("approve", proposedOther, "deny");
      const declined = await other;
      assert.equal(declined.status, 403);
      assert.equal((await bootstrapProject("approve")).devCommand.command, command);
    } finally {
      await stopDev("approve").catch(() => {});
    }
  },
);

test("deny: an error that says not to work around it, and nothing is spawned or stored", async () => {
  const proposing = startDev("deny", {
    command: `${node} server.js`,
    sessionId: "s-deny",
  });
  const request = await waitFor(() => asked("deny"), "the request");
  await answer("deny", request, "deny");
  const denied = await proposing;
  assert.equal(denied.status, 403);
  assert.equal(
    denied.json.error,
    `The user declined to run \`${node} server.js\`. Don't start it another way; tell the user.`,
  );
  assert.equal(asked("deny"), undefined);
  assert.equal((await bootstrapProject("deny")).devCommand, undefined);
  const status = await call("/api/projects/p-deny/dev");
  assert.equal(status.json.found, false);
  assert.equal(
    status.json.summary,
    "no dev command yet: propose one with dev_server_start({ command, cwd })",
  );
  // No command and nothing approved: guidance to propose one, never to start it yourself.
  const miss = await startDev("deny", {});
  assert.equal(miss.status, 404);
  assert.match(miss.json.guidance, /dev_server_start with `command`/);
  assert.match(miss.json.guidance, /`cwd`/);
  assert.match(miss.json.guidance, /Never start a server yourself/);
});

test("a folder outside the project is refused before anyone is asked", async () => {
  const outside = mkdtempSync(path.join(os.tmpdir(), "ade-outside-"));
  try {
    if (!posixOnly) symlinkSync(outside, path.join(validateDir, "out"));
    const cases = [
      ["../", /stay inside the project/],
      ["ui/../..", /stay inside the project/],
      [outside, /not an absolute path/],
      ["missing", /does not exist/],
      ["notes.txt", /not a folder/],
      ...(posixOnly ? [] : [["out", /resolves outside it/]]),
    ];
    for (const [cwd, error] of cases) {
      const res = await startDev("validate", { command: "serve", cwd, sessionId: "s-validate" });
      assert.equal(res.status, 400, cwd);
      assert.match(res.json.error, error, cwd);
    }
    assert.equal(asked("validate"), undefined);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("shell syntax is refused with a hint to pass one program and its arguments", async () => {
  for (const command of [
    "npm run build && npm start",
    "serve || true",
    "serve | tee log",
    "serve; echo done",
    "serve > log.txt",
    "serve < input",
    "serve &",
    "echo `id`",
    "echo $(id)",
    "serve --port $PORT",
    "PORT=8000 serve",
  ]) {
    const res = await startDev("validate", { command, sessionId: "s-validate" });
    assert.equal(res.status, 400, command);
    assert.match(res.json.error, /without a shell/, command);
    assert.match(res.json.error, /one program and its arguments/, command);
  }
  for (const [command, error] of [
    ["serve\nother", /single line/],
    [`serve ${"x".repeat(500)}`, /at most 500 characters/],
    ["   ", /non-empty/],
    ['serve "open', /unclosed/],
  ]) {
    const res = await startDev("validate", { command });
    assert.equal(res.status, 400, command);
    assert.match(res.json.error, error, command);
  }
  assert.equal(asked("validate"), undefined);
});

test("a fixed port is probed instead of an allocated one, and refused while taken", async () => {
  writeFileSync(path.join(fixedDir, "recorder.cjs"), readFileSync(recorder));
  const fixedPort = await freePort();
  const command = `${node} recorder.cjs --listen ${fixedPort}`;
  try {
    const proposing = startDev("fixed", { command, port: fixedPort, sessionId: "s-fixed" });
    const request = await waitFor(() => asked("fixed"), "the request");
    assert.equal(request.port, fixedPort);
    await answer("fixed", request, "allow");
    const up = await proposing;
    assert.equal(up.json.status, "running", JSON.stringify(up.json));
    assert.equal(up.json.port, fixedPort);
    const launched = JSON.parse(readFileSync(path.join(fixedDir, "launched.json"), "utf8"));
    assert.equal(launched.PORT, String(fixedPort));
    await stopDev("fixed");
    await waitFor(async () => {
      const probe = createServer();
      return new Promise((resolve) => {
        probe.once("error", () => resolve(false));
        probe.listen(fixedPort, "127.0.0.1", () => probe.close(() => resolve(true)));
      });
    }, "the fixed port to be free");

    // Something else holds the port: ADE says so and starts nothing.
    rmSync(path.join(fixedDir, "launched.json"));
    const squatter = createServer().listen(fixedPort, "127.0.0.1");
    try {
      const taken = await startDev("fixed", {});
      assert.equal(taken.json.status, "stopped");
      assert.match(
        taken.json.outputTail.join("\n"),
        new RegExp(`Port ${fixedPort} is already in use`),
      );
      assert.equal(existsSync(path.join(fixedDir, "launched.json")), false);
    } finally {
      squatter.close();
    }
  } finally {
    await stopDev("fixed").catch(() => {});
  }
});

test("a package.json dev script wins, and a passed command is ignored with a note", async () => {
  try {
    const up = await startDev("script", { command: "something-else", sessionId: "s-script" });
    assert.equal(up.status, 200);
    assert.equal(up.json.status, "running");
    assert.equal(up.json.command, "npm run dev");
    assert.equal(up.json.source, "package_script");
    assert.match(up.json.note, /ignored the command you passed/);
    assert.equal(asked("script"), undefined);
    const status = await call("/api/projects/p-script/dev");
    assert.match(status.json.summary, /package\.json dev script \(npm run dev\)/);
  } finally {
    await stopDev("script");
  }
});

test("without a session the request shows on the project; Forget clears the approval", async () => {
  const command = `${node} server.js`;
  writeFileSync(
    path.join(nosessionDir, "server.js"),
    "require('node:http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.PORT), '127.0.0.1');\n",
  );
  try {
    const proposing = startDev("nosession", { command });
    const pending = await waitFor(
      async () => (await bootstrapProject("nosession")).pendingDevCommand,
      "the project's pending request",
    );
    assert.equal(pending.command, command);
    assert.equal(asked("nosession"), undefined);
    const bad = await call("/api/projects/p-nosession/dev/command/answer", {
      requestId: pending.id,
      decision: "maybe",
    });
    assert.equal(bad.status, 400);
    const allowed = await call("/api/projects/p-nosession/dev/command/answer", {
      requestId: pending.id,
      decision: "allow",
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.json.devCommand.command, command);
    assert.equal((await proposing).json.status, "running");
    assert.equal((await bootstrapProject("nosession")).pendingDevCommand, undefined);
    const stale = await call("/api/projects/p-nosession/dev/command/answer", {
      requestId: pending.id,
      decision: "allow",
    });
    assert.equal(stale.status, 409);

    // Forget does not stop the running server; the next start needs approval again.
    const forgot = await call("/api/projects/p-nosession/dev/command/forget", {});
    assert.equal(forgot.status, 200);
    assert.equal((await bootstrapProject("nosession")).devCommand, undefined);
    assert.equal((await call("/api/projects/p-nosession/dev")).json.status, "running");
    await stopDev("nosession");
    assert.equal((await startDev("nosession", {})).status, 404);
  } finally {
    await stopDev("nosession").catch(() => {});
  }
});

test("waiting: a timeout leaves the request open, a repeat joins it, a new command replaces it", async () => {
  const first = `${node} first.js`;
  try {
    _setDevApprovalWaitForTest(150);
    const waited = await startDev("wait", { command: first, sessionId: "s-wait" });
    assert.equal(waited.status, 202);
    assert.equal(waited.json.status, "awaiting_approval");
    assert.match(waited.json.message, /Still waiting for the user to approve/);
    assert.match(waited.json.message, /Call dev_server_start again with the same command/);
    const request = asked("wait");
    assert.equal(request.command, first);
    const repeat = await startDev("wait", { command: first, sessionId: "s-wait" });
    assert.equal(repeat.status, 202);
    assert.equal(asked("wait").id, request.id, "the identical call joined the open request");

    _setDevApprovalWaitForTest(10_000);
    const firstCall = startDev("wait", { command: first, sessionId: "s-wait" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const secondCall = startDev("wait", { command: `${node} second.js`, sessionId: "s-wait" });
    const replaced = await firstCall;
    assert.equal(replaced.status, 409);
    assert.match(replaced.json.error, /replaced/);
    const second = await waitFor(
      () => asked("wait")?.command.endsWith("second.js") && asked("wait"),
      "the replacement",
    );
    assert.notEqual(second.id, request.id);
    assert.equal(_getSessionForTest("s-wait").pendingDevCommand?.id, second.id);
    assert.equal(_getSessionForTest("s-wait").pendingPermissions, undefined);
    await answer("wait", second, "deny");
    assert.equal((await secondCall).status, 403);
  } finally {
    _setDevApprovalWaitForTest(5 * 60_000);
  }
});

test("end to end: an approved `node server.js` really serves the app", async () => {
  try {
    const proposing = startDev("e2e", {
      command: `${node} server.js`,
      cwd: ".",
      sessionId: "s-e2e",
    });
    const request = await waitFor(() => asked("e2e"), "the request");
    await answer("e2e", request, "allow");
    const up = await proposing;
    assert.equal(up.json.status, "running", JSON.stringify(up.json));
    const page = await fetch(`http://127.0.0.1:${up.json.port}/`);
    assert.equal(await page.text(), "hello from the app");
    const record = (await call("/api/bootstrap")).json.processes.find(
      (p) => p.projectId === "p-e2e",
    );
    assert.equal(record.command, `${node} server.js`);
    assert.equal(record.source, "approved");
  } finally {
    await stopDev("e2e");
  }
});

test("the agent's tools learn which session asks", () => {
  setListenAddress({ address: "127.0.0.1", family: "IPv4", port: 3000 });
  const project = projects[0];
  assert.equal(computerContext(project, "s-approve").env.ADE_SESSION_ID, "s-approve");
  assert.equal("ADE_SESSION_ID" in computerContext(project).env, false);
});
