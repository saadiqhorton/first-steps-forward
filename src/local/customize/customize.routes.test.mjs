// /api/customize end to end through ade-local's router, with a scripted codex
// stand-in on PATH, a seeded private copy and HOME in a temp dir.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir, git, makeStockRepo } from "./fixture.test-helper.mjs";

const skip = process.platform === "win32" ? "the fake CLIs are POSIX shell shims" : false;
const FAKE = fileURLToPath(new URL("../cli-fake-agent.test-helper.mjs", import.meta.url));
const home = tempDir("ade-customize-routes-");
mkdirSync(path.join(home, ".ade"), { mode: 0o700 });
const binDir = path.join(home, "bin");
mkdirSync(binDir);
for (const name of ["codex", "opencode", "pi"]) {
  writeFileSync(
    path.join(binDir, name),
    `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" ${name} "$@"\n`,
  );
  chmodSync(path.join(binDir, name), 0o755);
}
const agentRow = (id, name) => ({
  id,
  name,
  short: name,
  tools: `${name} tools`,
  authMethod: "x",
  authNote: "x",
  installHint: "x",
  installed: true,
  version: "1.0.0",
  signedIn: true,
  carriesConversation: true,
  installMethod: "npm",
  harness: { install: "x", update: "x" },
});
const agents = [agentRow("codex", "OpenAI Codex")];
writeFileSync(
  path.join(home, ".ade", "agents-status.json"),
  JSON.stringify({ fetchedAt: Date.now(), agents }),
);
// A normal project, plus a ready private copy (a clone of a fixture checkout).
const normal = path.join(home, "normal");
mkdirSync(normal);
writeFileSync(path.join(normal, "package.json"), JSON.stringify({ name: "normal" }));
writeFileSync(
  path.join(home, ".ade", "workspace.json"),
  JSON.stringify({
    projects: [
      {
        id: "normal",
        name: "normal",
        path: normal,
        branch: "not a git repository",
        ahead: 0,
        uncommittedFiles: [],
        defaultAgent: "codex",
        addedAt: 1,
      },
    ],
    sessions: [],
    processes: [],
  }),
);
const stock = makeStockRepo();
const source = path.join(home, ".ade", "self", "source");
mkdirSync(path.dirname(source), { recursive: true });
git(path.dirname(source), "clone", "-q", stock, source);
git(source, "branch", "stock");
git(source, "checkout", "-q", "-b", "mine");
writeFileSync(
  path.join(home, ".ade", "self", "state.json"),
  JSON.stringify({ version: 1, setup: { status: "ready" }, changes: [] }),
);

process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

const {
  handle,
  start: startAde,
  setListenAddress,
  _setAgentsForTest,
} = await import("../ade-local.mjs");
const { callApi } = await import("../api-request.test-helper.mjs");
_setAgentsForTest(agents);
await startAde();
setListenAddress({ address: "127.0.0.1", family: "IPv4", port: 3000 });

const call = async (urlPath, body, method) => {
  const res = await callApi(handle, {
    url: `http://127.0.0.1:3000${urlPath}`,
    body,
    method,
    remoteAddress: "::ffff:127.0.0.1",
  });
  return { status: res.status, json: await res.json() };
};
async function waitFor(check, what, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const gateFile = path.join(home, "gate");
process.env.FAKE_CLI_GATE = gateFile;
// A failed test must not leave a gated fake agent holding the process open.
test.after(() => writeFileSync(gateFile, ""));
const reach = (id, status) =>
  waitFor(async () => {
    const found = (await call("/api/customize")).json.changes.find((c) => c.id === id);
    return found?.status === status ? found : null;
  }, `change ${status}`);

test("GET /api/customize reports a ready setup and no changes", { skip }, async () => {
  const { status, json } = await call("/api/customize");
  assert.equal(status, 200);
  assert.equal(json.available, true);
  assert.equal(json.setup.status, "ready");
  assert.deepEqual(json.changes, []);
  assert.deepEqual(json.current, { stock: true, sha: null });
  assert.equal(json.switch.launcher, false);
  assert.equal(json.update, null);
  assert.match(json.version, /^\d+\.\d+\.\d+/);
});

test("the hidden project is registered but absent from bootstrap", { skip }, async () => {
  const boot = (await call("/api/bootstrap")).json;
  assert.deepEqual(
    boot.projects.map((p) => p.id),
    ["normal"],
  );
});

test("bad requests, setup when ready, and preview", { skip }, async () => {
  assert.equal((await call("/api/customize/changes", { request: "Do it" })).status, 400);
  const setup = await call("/api/customize/setup", {});
  assert.equal(setup.status, 202);
  assert.equal(setup.json.setup.status, "ready");
  assert.equal((await call("/api/customize/changes/x/preview", { action: "start" })).status, 404);
  assert.equal((await call("/api/customize/changes/x/preview", { action: "stop" })).status, 404);
  assert.equal((await call("/api/customize/changes/x/keep", {})).status, 404);
  assert.equal((await call("/api/customize/nothing")).status, 404);
});

test(
  "a change runs to ready, hides its session, blocks a second change, and is kept",
  { skip },
  async () => {
    process.env.FAKE_CLI_SCENARIO = "gate";
    const created = await call("/api/customize/changes", {
      request: "Add a fourth line to the feature file",
      agentId: "codex",
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const { change } = created.json;
    assert.equal(change.status, "working");

    const second = await call("/api/customize/changes", {
      request: "Another idea",
      agentId: "codex",
    });
    assert.equal(second.status, 409);
    // The agent is still working: nothing to try yet.
    const early = await call(`/api/customize/changes/${change.id}/preview`, { action: "start" });
    assert.equal(early.status, 409);

    const boot = (await call("/api/bootstrap")).json;
    assert.ok(!boot.projects.some((p) => p.id === "ade-self"));
    assert.ok(!boot.sessions.some((s) => s.id === change.sessionId));
    const inbox = await call("/api/workspace/inbox?includeCompleted=1&includeSnoozed=1");
    assert.equal(inbox.status, 200);
    assert.ok(!JSON.stringify(inbox.json).includes(change.sessionId));
    assert.deepEqual((await call("/api/sessions?q=fourth%20line")).json.ids, []);
    const direct = await call(`/api/sessions/${change.sessionId}`);
    assert.equal(direct.status, 200);
    const first = direct.json.session.messages[0];
    assert.match(first.text, /Work only inside this folder/);
    assert.equal(first.presentation.text, "Add a fourth line to the feature file");

    writeFileSync(path.join(source, "src", "feature.txt"), "one\ntwo\nthree\nfour\n");
    writeFileSync(gateFile, "");
    const ready = await reach(change.id, "ready");
    assert.equal(ready.files[0].path, "src/feature.txt");
    assert.ok(ready.checks.every((c) => ["passed", "skipped"].includes(c.status)));

    // Try it: the change's ADE answers on its own port, then stops.
    const preview = (action) => call(`/api/customize/changes/${change.id}/preview`, { action });
    assert.equal((await preview("open")).status, 400);
    const starting = await preview("start");
    assert.equal(starting.status, 202, JSON.stringify(starting.json));
    assert.equal(starting.json.change.preview.status, "starting");
    const running = await waitFor(async () => {
      const found = (await call("/api/customize")).json.changes.find((c) => c.id === change.id);
      if (found.preview.status === "failed") throw new Error(JSON.stringify(found.preview));
      return found.preview.status === "running" ? found.preview : null;
    }, "preview running");
    assert.notEqual(new URL(running.url).port, "3100");
    const answer = await (await fetch(`${running.url}api/bootstrap`)).json();
    assert.ok(answer.home.startsWith(path.join(home, ".ade", "self", "homes", "preview-")));
    const stopped = await preview("stop");
    assert.equal(stopped.status, 200);
    assert.equal(stopped.json.change.preview.status, "stopped");
    await assert.rejects(fetch(running.url));

    const kept = await call(`/api/customize/changes/${change.id}/keep`, {});
    assert.equal(kept.status, 200);
    assert.equal(kept.json.change.status, "kept");
    assert.equal((await call(`/api/customize/changes/${change.id}/undo`, {})).status, 409);
    assert.equal((await preview("start")).status, 409);
    const pending = await waitFor(async () => {
      const sw = (await call("/api/customize")).json.switch;
      return sw.status === "pending" ? sw : null;
    }, "the kept version to be prepared");
    assert.equal(pending.launcher, false);
    const restart = await call("/api/customize/restart", {});
    assert.equal(restart.status, 409);
    assert.match(restart.json.error, /run `ade`/);
  },
);

test("a turn that changes nothing needs you; undo clears it", { skip }, async () => {
  process.env.FAKE_CLI_SCENARIO = "text";
  const created = await call("/api/customize/changes", {
    request: "Think about a feature",
    agentId: "codex",
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const needs = await reach(created.json.change.id, "needs-you");
  assert.equal(needs.reason, "The agent finished without changing anything.");
  const undone = await call(`/api/customize/changes/${needs.id}/undo`, {});
  assert.equal(undone.status, 200);
  const list = (await call("/api/customize")).json.changes;
  assert.ok(!list.some((c) => c.id === needs.id));
});
