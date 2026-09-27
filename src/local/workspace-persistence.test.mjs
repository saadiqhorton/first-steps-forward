import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { reconcileWorkspaceMessages, saveWorkspace } from "./workspace-persistence.mjs";

const message = (id, at) => ({ id, role: "user", text: id, at });
const snapshot = (messages) => ({
  projects: [{ id: "p" }],
  sessions: [{ id: "s", projectId: "p", messages, updatedAt: 1 }],
  processes: [],
});

test("concurrent stale workspace snapshots cannot erase a sent prompt", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ade-persistence-"));
  const file = path.join(dir, "workspace.json");
  try {
    const newer = snapshot([message("first", 1), message("sent prompt", 2)]);
    const stale = snapshot([message("first", 1)]);
    newer.sessions[0].updatedAt = 2;
    newer.sessions[0].status = "working";
    stale.sessions[0].status = "ready";
    await saveWorkspace(file, newer);
    await saveWorkspace(file, stale);
    await Promise.all([saveWorkspace(file, stale), saveWorkspace(file, newer)]);
    const persisted = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(
      persisted.sessions[0].messages.map((m) => m.id),
      ["first", "sent prompt"],
    );
    assert.equal(persisted.sessions[0].status, "working");
    const otherInstance = snapshot([message("first", 1)]);
    await reconcileWorkspaceMessages(file, otherInstance);
    assert.equal(otherInstance.sessions[0].messages[1].id, "sent prompt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reconciliation does not restore sessions for removed projects", async () => {
  const current = { projects: [], sessions: [], processes: [] };
  const saved = snapshot([message("first", 1)]);
  const dir = await mkdtemp(path.join(os.tmpdir(), "ade-persistence-"));
  const file = path.join(dir, "workspace.json");
  try {
    await saveWorkspace(file, saved);
    await reconcileWorkspaceMessages(file, current);
    assert.equal(current.sessions.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
