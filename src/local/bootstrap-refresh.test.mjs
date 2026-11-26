import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(os.tmpdir(), "ade-bootstrap-refresh-"));
process.once("exit", () => rmSync(home, { recursive: true, force: true }));
const projectPath = path.join(home, "project");
mkdirSync(path.join(home, ".ade"), { recursive: true });
mkdirSync(projectPath, { recursive: true });
execFileSync("git", ["init", "-q", "-b", "main", projectPath]);
writeFileSync(path.join(projectPath, "readme.txt"), "base\n");
execFileSync("git", ["-C", projectPath, "add", "readme.txt"]);
execFileSync("git", [
  "-C",
  projectPath,
  "-c",
  "user.name=Test",
  "-c",
  "user.email=test@example.invalid",
  "commit",
  "-qm",
  "base",
]);
writeFileSync(path.join(projectPath, "readme.txt"), "changed\n");

const createdAt = Date.now() - 5_000;
writeFileSync(
  path.join(home, ".ade", "workspace.json"),
  JSON.stringify({
    projects: [
      {
        id: "p1",
        name: "Refresh project",
        path: projectPath,
        branch: "main",
        ahead: 0,
        uncommittedFiles: [],
        defaultAgent: "codex",
        addedAt: createdAt,
      },
    ],
    sessions: [
      {
        id: "s1",
        projectId: "p1",
        agentId: "codex",
        createdBy: "codex",
        request: "edit readme",
        criteria: "",
        status: "working",
        messages: [],
        changes: [],
        checks: [],
        logs: [],
        createdAt,
        updatedAt: createdAt,
      },
    ],
    processes: [],
  }),
);

process.env.HOME = home;
process.env.USERPROFILE = home;

const {
  start,
  handle,
  _getSessionForTest,
  _getProjectForTest,
  _refreshBootstrapInBackgroundForTest,
  _eventHubForTest,
} = await import("./ade-local.mjs");
const { callApi } = await import("./api-request.test-helper.mjs");
await start();

test("background refresh skips getDiff when nothing watches that project", async () => {
  const session = _getSessionForTest("s1");
  assert.ok(session);
  session.changes = [];
  const project = _getProjectForTest("p1");
  assert.ok(project);
  project.uncommittedFiles = [];

  await _refreshBootstrapInBackgroundForTest(["p1"]);

  assert.deepEqual(_getSessionForTest("s1").changes, []);
  assert.ok(_getProjectForTest("p1").uncommittedFiles.includes("readme.txt"));
});

test("background refresh runs getDiff when the project is watched", async () => {
  const hub = _eventHubForTest();
  hub.watchDiff("p1");
  try {
    const session = _getSessionForTest("s1");
    session.changes = [];
    await _refreshBootstrapInBackgroundForTest(["p1"]);
    assert.ok(_getSessionForTest("s1").changes.length > 0);
    assert.equal(_getSessionForTest("s1").changes[0].path, "readme.txt");
  } finally {
    hub.unwatchDiff("p1");
  }
});

test("POST interest with diff true watches and runs getDiff immediately", async () => {
  const session = _getSessionForTest("s1");
  session.changes = [];
  const response = await callApi(handle, {
    url: "http://127.0.0.1:3000/api/events/interest",
    body: { projectId: "p1", diff: true },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.watching, ["p1"]);
  assert.ok(_getSessionForTest("s1").changes.length > 0);
  const clear = await callApi(handle, {
    url: "http://127.0.0.1:3000/api/events/interest",
    body: { projectId: "p1", diff: false },
  });
  assert.equal(clear.status, 200);
  assert.deepEqual((await clear.json()).watching, []);
});
