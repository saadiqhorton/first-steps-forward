import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// vite.config.ts imports ade-local.mjs for every Vite command, `npm run build`
// included, so importing it must not touch ~/.ade or start anything.
const home = mkdtempSync(path.join(os.tmpdir(), "ade-import-"));
process.once("exit", () => rmSync(home, { recursive: true, force: true }));
process.env.HOME = home;
process.env.USERPROFILE = home;
const emptyHome = mkdtempSync(path.join(os.tmpdir(), "ade-import-empty-"));
process.once("exit", () => rmSync(emptyHome, { recursive: true, force: true }));
// A workspace that loading rewrites: its recorded dev server is not running.
const workspaceFile = path.join(home, ".ade", "workspace.json");
mkdirSync(path.dirname(workspaceFile));
const seeded = JSON.stringify({
  projects: [{ id: "p1", name: "p1", path: home }],
  sessions: [],
  processes: [{ id: "dev", projectId: "p1", status: "running", pid: 2 ** 22 + 7 }],
});
writeFileSync(workspaceFile, seeded);

/** Handles that would mean a probe, timer, child process or listener started. */
const active = () =>
  process
    .getActiveResourcesInfo()
    .filter((type) => /Timeout|Immediate|Process|TCP|Pipe|FSEvent|StatWatcher/.test(type));

test("importing ade-local touches no files and starts nothing; start() loads", async () => {
  const before = active();
  // A HOME without ~/.ade stays empty.
  process.env.HOME = process.env.USERPROFILE = emptyHome;
  const empty = await import("./ade-local.mjs?empty-home");
  process.env.HOME = process.env.USERPROFILE = home;
  const module = await import("./ade-local.mjs");
  await import("./server.mjs");
  // Let anything an import scheduled get going.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(readdirSync(emptyHome), []);
  assert.deepEqual(readdirSync(path.join(home, ".ade")), ["workspace.json"]);
  assert.equal(readFileSync(workspaceFile, "utf8"), seeded);
  assert.deepEqual(active(), before);
  assert.ok(empty.start);

  // start() is the explicit step, and it is idempotent.
  assert.equal(module.start(), module.start());
  await module.start();
  const saved = JSON.parse(readFileSync(workspaceFile, "utf8"));
  assert.equal(saved.processes[0].status, "stopped");
});
