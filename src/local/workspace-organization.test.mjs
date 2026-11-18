import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkspaceOrganization } from "./workspace-organization.mjs";

test("organization inbox preserves read, pin, snooze and bulk completion safeguards", async () => {
  const state = {
    projects: [{ id: "p", name: "P", path: "/tmp/p" }],
    sessions: [
      {
        id: "pending",
        projectId: "p",
        request: "Decision",
        status: "ready",
        updatedAt: 20,
        pendingPermissions: [{ id: "q" }],
        messages: [],
      },
      {
        id: "done",
        projectId: "p",
        request: "Finished",
        status: "complete",
        updatedAt: 10,
        messages: [],
      },
    ],
  };
  let clock = 100;
  const saved = [];
  const org = createWorkspaceOrganization({
    state,
    id: () => "id",
    now: () => clock,
    save: async () => saved.push(true),
    turns: {
      isBusy: () => false,
      complete: async (s) => ({ ...s, status: "complete" }),
      reopen: async (s) => ({ ...s, status: "ready" }),
    },
    devApprovals: { forSession: () => null },
  });
  await org.markRead("done", 9);
  await org.bulk([
    { sessionId: "pending", action: "complete" },
    { sessionId: "done", action: "pin" },
  ]);
  assert.equal(state.sessions[0].status, "ready");
  assert.equal((await org.inbox()).groups.pinned[0].id, "done");
  await org.snooze("done", 150, "custom");
  assert.equal(
    (await org.inbox({ includeCompleted: "false", includeSnoozed: "false" })).groups.completed
      .length,
    0,
  );
  assert.equal((await org.inbox({ includeSnoozed: true })).groups.snoozed[0].id, "done");
  clock = 151;
  await org.reconcile();
  assert.equal(state.workspaceOrganization.snoozes.done.returnedAt, 151);
  assert.ok(saved.length >= 4);
});

test("project discovery returns canonical folder paths and settings reject stale revisions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ade-discover-"));
  try {
    await mkdir(path.join(root, "repo"));
    const state = {
      projects: [{ id: "p", name: "Repo", path: path.join(root, "repo"), defaultAgent: "codex" }],
      sessions: [],
      workflows: [],
    };
    const org = createWorkspaceOrganization({
      state,
      id: () => "id",
      now: () => 100,
      save: async () => {},
      turns: { isBusy: () => false },
    });
    assert.deepEqual(
      (await org.discoverProjects(root)).projects.map((x) => [x.name, x.alreadyRegistered]),
      [["repo", true]],
    );
    const changed = await org.updateProjectSettings("p", {
      expectedRevision: 0,
      instructions: "Keep changes safe",
      color: "#123456",
      icon: "🌿",
    });
    assert.equal(changed.revision, 1);
    assert.equal(changed.project.workspaceInstructions, "Keep changes safe");
    assert.equal(changed.versions.length, 1);
    await org.updateProjectSettings("p", { expectedRevision: 0, instructions: "stale" }).then(
      () => assert.fail(),
      (e) => assert.equal(e.status, 409),
    );
    await org.updateProjectSettings("missing", { expectedRevision: 0, instructions: "x" }).then(
      () => assert.fail(),
      (e) => assert.equal(e.status, 404),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workflow usage increments only after the host project start succeeds", async () => {
  let now = 1000,
    starts = 0;
  const state = {
    projects: [{ id: "p", name: "P", defaultAgent: "codex" }],
    sessions: [],
    workflows: [
      { id: "wf", name: "Review", prompt: "Review the latest changes", permission: "plan" },
    ],
  };
  const org = createWorkspaceOrganization({
    state,
    id: () => `s${++starts}`,
    now: () => now,
    save: async () => {},
    turns: { isBusy: () => false },
    projectStart: async (input) => {
      if (input.request === "fail") throw new Error("not started");
      return { id: `s${starts + 1}`, request: input.request };
    },
  });
  await org.launchWorkflow("wf", { projectId: "p" });
  await org.launchWorkflow("wf", { projectId: "p" });
  assert.equal(org.frequent()[0].count, 2);
  await org.launchWorkflow("wf", { projectId: "p", request: "fail" }).then(
    () => assert.fail(),
    (e) => assert.equal(e.message, "not started"),
  );
  assert.equal(org.frequent()[0].count, 2);
});

test("a partial saved organization initializes every map before the inbox uses it", async () => {
  for (const workspaceOrganization of [{}, { reads: {} }]) {
    const state = {
      workspaceOrganization,
      projects: [{ id: "p", name: "P", path: "/tmp/p" }],
      sessions: [
        {
          id: "s",
          projectId: "p",
          request: "Task",
          status: "ready",
          updatedAt: 1,
          messages: [],
        },
      ],
    };
    const org = createWorkspaceOrganization({
      state,
      id: () => "id",
      now: () => 2,
      save: async () => {},
      turns: { isBusy: () => false, complete: async (s) => s, reopen: async (s) => s },
      devApprovals: { forSession: () => null, unattached: () => null },
    });
    const inbox = await org.inbox();
    assert.equal(inbox.groups.ready[0].id, "s");
    assert.deepEqual(org.frequent(), []);
    await org.snooze("s", 100, "custom");
    await org.bulk([{ sessionId: "s", action: "unread" }]);
    await org.markRead("s", 3);
    await org.unsnooze("s");
    assert.equal(state.workspaceOrganization.snoozes.s, undefined);
    assert.equal(state.workspaceOrganization.unread.s, undefined);
  }
});

test("agent replies newer than the read marker land in the unread group", async () => {
  const state = {
    projects: [{ id: "p", name: "P" }],
    sessions: [
      {
        id: "s",
        projectId: "p",
        request: "Task",
        status: "ready",
        updatedAt: 200,
        messages: [{ id: "m1", role: "agent", text: "Finished it", at: 150 }],
      },
    ],
    workspaceOrganization: { reads: { s: 100 } },
  };
  const org = createWorkspaceOrganization({
    state,
    id: () => "id",
    now: () => 300,
    save: async () => {},
    turns: { isBusy: () => false },
  });
  const inbox = await org.inbox();
  assert.equal(inbox.groups.unread[0].id, "s");
  assert.equal(inbox.groups.ready.length, 0);
});

test("mark unread is durable until the session is read again", async () => {
  let clock = 600;
  const state = {
    projects: [{ id: "p", name: "P" }],
    sessions: [
      {
        id: "s",
        projectId: "p",
        request: "Task",
        status: "ready",
        updatedAt: 200,
        messages: [{ id: "m1", role: "agent", text: "Finished it", at: 150 }],
      },
    ],
    workspaceOrganization: { reads: { s: 500 } },
  };
  const org = createWorkspaceOrganization({
    state,
    id: () => "id",
    now: () => clock,
    save: async () => {},
    turns: { isBusy: () => false },
  });
  await org.bulk([{ sessionId: "s", action: "unread" }]);
  // The marker wins over a newer read cursor and shows readAt 0.
  assert.equal(state.workspaceOrganization.unread.s, 600);
  let inbox = await org.inbox();
  assert.equal(inbox.groups.unread[0].id, "s");
  assert.equal(inbox.groups.unread[0].readAt, 0);
  assert.equal(inbox.groups.unread[0].manualUnread, true);

  // A new agent reply after the marker is still unread.
  clock = 650;
  state.sessions[0].updatedAt = 650;
  inbox = await org.inbox();
  assert.equal(inbox.groups.unread[0].id, "s");

  clock = 700;
  await org.markRead("s", clock);
  assert.equal(state.workspaceOrganization.unread.s, undefined);
  assert.equal(state.workspaceOrganization.reads.s, 700);
  inbox = await org.inbox();
  assert.equal(inbox.groups.unread.length, 0);
  assert.equal(inbox.groups.ready[0].id, "s");
  assert.equal(inbox.groups.ready[0].manualUnread, false);
});

test("project-scoped dev command approvals remain visible in the pending inbox", async () => {
  const state = { projects: [{ id: "p", name: "Web", path: "/tmp/web" }], sessions: [] };
  const org = createWorkspaceOrganization({
    state,
    id: () => "x",
    now: () => 1,
    save: async () => {},
    turns: { isBusy: () => false },
    devApprovals: { unattached: () => ({ command: "npm run dev", createdAt: 1 }) },
  });
  const result = await org.inbox();
  assert.equal(result.groups.pending[0].kind, "project-dev-command");
  assert.equal(result.groups.pending[0].sessionId, null);
  assert.match(result.groups.pending[0].request, /npm run dev/);
});

test("snoozes wake on a new user message or an agent decision and stay unread until opened", async () => {
  let clock = 100,
    busy = true;
  const state = {
    projects: [{ id: "p", name: "Web" }],
    sessions: [
      { id: "s", projectId: "p", request: "Task", status: "working", updatedAt: 50, messages: [] },
    ],
  };
  const org = createWorkspaceOrganization({
    state,
    id: () => "x",
    now: () => clock,
    save: async () => {},
    turns: { isBusy: () => busy },
  });
  await org.snooze("s", "finished");
  assert.equal((await org.inbox({ includeSnoozed: true })).groups.snoozed.length, 1);
  state.sessions[0].messages.push({ role: "user", text: "One more thing", at: 101 });
  state.sessions[0].updatedAt = 101;
  clock = 101;
  let snapshot = await org.inbox({ includeSnoozed: true });
  assert.equal(snapshot.groups.snoozed.length, 0);
  assert.equal(snapshot.groups.unread[0].id, "s");
  await org.snooze("s", "finished");
  state.sessions[0].pendingPermissions = [{ id: "ask" }];
  clock = 102;
  snapshot = await org.inbox({ includeSnoozed: true });
  assert.equal(snapshot.groups.pending[0].id, "s");
  assert.equal(snapshot.groups.snoozed.length, 0);
  await org.markRead("s");
  assert.equal(state.workspaceOrganization.snoozes.s, undefined);
});

test("concurrent project setting edits use the revision to prevent lost updates", async () => {
  const state = { projects: [{ id: "p", name: "P" }], sessions: [] };
  let release;
  const save = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const org = createWorkspaceOrganization({
    state,
    id: () => "x",
    now: () => 1,
    save,
    turns: { isBusy: () => false },
  });
  const first = org.updateProjectSettings("p", { expectedRevision: 0, color: "#112233" });
  const second = org.updateProjectSettings("p", { expectedRevision: 0, color: "#445566" });
  await second.then(
    () => assert.fail(),
    (error) => assert.equal(error.status, 409),
  );
  release();
  const changed = await first;
  assert.equal(changed.color, "#112233");
  assert.equal(changed.revision, 1);
});
