import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  mergeWorkspaceRecords,
  reconcileWorkspaceMessages,
  saveWorkspace,
} from "./workspace-persistence.mjs";

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

test("live pending map wins over a stale session snapshot after reconcile", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ade-persistence-"));
  const file = path.join(dir, "workspace.json");
  try {
    const settled = {
      projects: [{ id: "p" }],
      sessions: [
        {
          id: "s",
          projectId: "p",
          messages: [message("first", 1)],
          updatedAt: 1,
          pendingDevCommand: {
            id: "stale",
            kind: "dev_command",
            command: "gone",
            cwd: ".",
            requestedAt: 1,
          },
        },
      ],
      processes: [],
    };
    await saveWorkspace(file, settled, { livePendingDevCommands: () => new Map() });
    assert.equal(settled.sessions[0].pendingDevCommand, undefined);
    const persisted = JSON.parse(await readFile(file, "utf8"));
    assert.equal(persisted.sessions[0].pendingDevCommand, undefined);
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

test("a stale process cannot restore a removed project or its sessions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ade-persistence-"));
  const file = path.join(dir, "workspace.json");
  try {
    const removed = { projects: [], sessions: [], processes: [], deletedProjects: { p: 5 } };
    await saveWorkspace(file, removed);
    const stale = snapshot([message("first", 1)]);
    await saveWorkspace(file, stale);
    const persisted = JSON.parse(await readFile(file, "utf8"));
    assert.equal(persisted.projects.length, 0);
    assert.equal(persisted.sessions.length, 0);
    assert.equal(persisted.deletedProjects.p, 5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unsnoozing survives another process's stale snooze", () => {
  const current = {
    workspaceOrganization: {
      snoozes: {},
      snoozeTombstones: { s: 20 },
      projectPins: [],
      pinTombstones: { p: 30 },
    },
  };
  mergeWorkspaceRecords(current, {
    workspaceOrganization: {
      snoozes: { s: { until: 99_999, createdAt: 10 } },
      projectPins: [{ projectId: "p", position: 0, updatedAt: 10 }],
    },
  });
  assert.equal(current.workspaceOrganization.snoozes.s, undefined);
  assert.equal(current.workspaceOrganization.projectPins.length, 0);
});

test("voice choices and session tombstones survive a stale process save", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ade-persistence-"));
  const file = path.join(dir, "workspace.json");
  try {
    const current = {
      projects: [{ id: "p" }],
      sessions: [],
      processes: [],
      voice: { chimeDuringDictation: false },
      deletedSessions: { s: 5 },
    };
    // This process never loaded the voice block; its save must not erase it.
    const stale = {
      projects: [{ id: "p" }],
      sessions: [{ id: "s", projectId: "p", messages: [], updatedAt: 1 }],
      processes: [],
    };
    await saveWorkspace(file, current);
    await saveWorkspace(file, stale);
    const persisted = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(persisted.voice, { chimeDuringDictation: false });
    assert.equal(persisted.sessions.length, 0);
    assert.equal(persisted.deletedSessions.s, 5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mark unread survives another process's stale read and clears on read", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ade-persistence-"));
  const file = path.join(dir, "workspace.json");
  const snapshot = (organization) => ({
    projects: [{ id: "p" }],
    sessions: [{ id: "s", projectId: "p", messages: [], updatedAt: 1 }],
    processes: [],
    workspaceOrganization: organization,
  });
  try {
    await saveWorkspace(file, snapshot({ reads: { s: 50 }, unread: {} }));
    // Mark unread at 60, after the last read at 50.
    await saveWorkspace(file, snapshot({ reads: { s: 50 }, unread: { s: 60 } }));
    // Another process still has the older read cursor and saves a stale snapshot.
    await saveWorkspace(file, snapshot({ reads: { s: 40 }, unread: {} }));
    let persisted = JSON.parse(await readFile(file, "utf8"));
    assert.equal(persisted.workspaceOrganization.unread.s, 60);
    assert.equal(persisted.workspaceOrganization.reads.s, 50);

    // Reading at 70 clears the marker; a stale process that still carries the
    // older marker cannot bring it back.
    await saveWorkspace(file, snapshot({ reads: { s: 70 }, unread: {} }));
    await saveWorkspace(file, snapshot({ reads: { s: 40 }, unread: { s: 60 } }));
    persisted = JSON.parse(await readFile(file, "utf8"));
    assert.equal(persisted.workspaceOrganization.unread.s, undefined);
    assert.equal(persisted.workspaceOrganization.reads.s, 70);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("voice choices survive a merge with another process's older snapshot", () => {
  const current = { voice: { chimeDuringDictation: false } };
  mergeWorkspaceRecords(current, { voice: { chimeDuringDictation: true } });
  assert.deepEqual(current.voice, { chimeDuringDictation: false });
});

test("an untouched file is not read back, and another process's write still is", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ade-persistence-"));
  const file = path.join(dir, "workspace.json");
  try {
    const mine = snapshot([message("first", 1)]);
    await saveWorkspace(file, mine);
    // Removing it in memory sticks only if the save did not merge the old file back in.
    mine.sessions[0].messages = [];
    await saveWorkspace(file, mine);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")).sessions[0].messages, []);
    const other = snapshot([message("theirs", 3)]);
    other.sessions[0].updatedAt = 3;
    await saveWorkspace(file, other);
    mine.sessions[0].messages.push(message("mine", 4));
    await saveWorkspace(file, mine);
    assert.deepEqual(
      JSON.parse(await readFile(file, "utf8")).sessions[0].messages.map((m) => m.id),
      ["theirs", "mine"],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a deletion is applied even when the file is not read back", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ade-persistence-"));
  const file = path.join(dir, "workspace.json");
  try {
    const mine = snapshot([message("first", 1)]);
    await saveWorkspace(file, mine);
    mine.deletedSessions = { s: 5 };
    await saveWorkspace(file, mine);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")).sessions, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
