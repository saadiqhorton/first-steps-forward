import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(os.tmpdir(), "ade-nested-git-test-"));
const projectPath = path.join(home, "project");
const repoPath = path.join(projectPath, "code");
mkdirSync(path.join(home, ".ade"));
mkdirSync(path.join(repoPath, "src"), { recursive: true });
mkdirSync(path.join(repoPath, "tests"));
execFileSync("git", ["init", "-q", "-b", "main", repoPath]);
writeFileSync(path.join(repoPath, "src", "ui.py"), "before\n");
execFileSync("git", ["-C", repoPath, "add", "src/ui.py"]);
execFileSync("git", [
  "-C",
  repoPath,
  "-c",
  "user.name=Test",
  "-c",
  "user.email=test@example.invalid",
  "commit",
  "-qm",
  "base",
]);
const createdAt = Date.now() - 5_000;
writeFileSync(path.join(repoPath, "src", "ui.py"), "after\n");
writeFileSync(path.join(repoPath, "tests", "test_ui.py"), "def test_ui(): pass\n");
const completedAt = Date.now();
writeFileSync(
  path.join(home, ".ade", "workspace.json"),
  JSON.stringify({
    projects: [
      {
        id: "p1",
        name: "Nested project",
        path: projectPath,
        branch: "not a git repository",
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
        request: "Update UI",
        criteria: "",
        status: "complete",
        messages: [],
        changes: [],
        checks: [],
        logs: [],
        createdAt,
        updatedAt: completedAt,
        completedAt,
      },
    ],
    processes: [],
  }),
);
process.env.HOME = home;
// os.homedir() reads USERPROFILE on Windows, not HOME; without this the
// tests would write into the real ~/.ade workspace.
process.env.USERPROFILE = home;
const { handle, start } = await import("./ade-local.mjs");
const { callApi } = await import("./api-request.test-helper.mjs");
await start();

async function get(urlPath) {
  const response = await callApi(handle, { url: `http://127.0.0.1:3000${urlPath}` });
  return { status: response.status, body: await response.json() };
}

test("a nested Git repository supplies changes and repairs an empty completed-session count", async () => {
  const diff = await get("/api/projects/p1/diff");
  assert.equal(diff.status, 200);
  assert.deepEqual(diff.body.changes.map((change) => change.path).sort(), [
    "code/src/ui.py",
    "code/tests/test_ui.py",
  ]);
  const bootstrap = await get("/api/bootstrap");
  assert.equal(bootstrap.status, 200);
  const session = bootstrap.body.sessions.find((item) => item.id === "s1");
  assert.ok(session);
  assert.equal("changes" in session, false);
  const detail = await get("/api/sessions/s1");
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.session.changes.map((change) => change.path).sort(), [
    "code/src/ui.py",
    "code/tests/test_ui.py",
  ]);
});

// On exit, not in test.after(): ADE's last workspace save can land after the tests end.
process.once("exit", () => rmSync(home, { recursive: true, force: true }));
