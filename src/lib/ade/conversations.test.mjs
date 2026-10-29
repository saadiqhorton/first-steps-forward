import test from "node:test";
import assert from "node:assert/strict";
import { filterSessions, isUnread } from "./conversations.mjs";

function session(partial) {
  return {
    id: "s1",
    projectId: "p1",
    agentId: "codex",
    createdBy: "codex",
    request: "Fix the login button",
    criteria: "",
    status: "ready",
    messages: [],
    changes: [],
    checks: [],
    logs: [],
    createdAt: 1000,
    updatedAt: 2000,
    ...partial,
  };
}

test("isUnread: true when updatedAt is after viewed time", () => {
  const s = session({ id: "a", updatedAt: 5000, createdAt: 1000 });
  assert.equal(isUnread(s, { a: 4000 }), true);
  assert.equal(isUnread(s, { a: 5000 }), false);
  assert.equal(isUnread(s, { a: 6000 }), false);
});

test("isUnread: falls back to createdAt when never viewed", () => {
  const s = session({ id: "b", updatedAt: 2000, createdAt: 1000 });
  assert.equal(isUnread(s, {}), true);
  const untouched = session({ id: "c", updatedAt: 1000, createdAt: 1000 });
  assert.equal(isUnread(untouched, {}), false);
});

test("filterSessions: needs = ready|blocked|waiting on a permission answer", () => {
  const sessions = [
    session({ id: "1", status: "ready", updatedAt: 3 }),
    session({ id: "2", status: "blocked", updatedAt: 2 }),
    session({ id: "3", status: "working", updatedAt: 4 }),
    session({ id: "4", status: "complete", updatedAt: 5 }),
    session({ id: "5", status: "working", updatedAt: 1, pendingPermissions: [{ id: "q" }] }),
  ];
  const out = filterSessions(sessions, {
    filter: "needs",
    query: "",
    showCompleted: false,
    viewed: {},
  });
  assert.deepEqual(
    out.map((s) => s.id),
    ["1", "2", "5"],
  );
});

test("filterSessions: working = working|verifying", () => {
  const sessions = [
    session({ id: "1", status: "working", updatedAt: 3 }),
    session({ id: "2", status: "verifying", updatedAt: 2 }),
    session({ id: "3", status: "ready", updatedAt: 4 }),
  ];
  const out = filterSessions(sessions, {
    filter: "working",
    query: "",
    showCompleted: false,
    viewed: {},
  });
  assert.deepEqual(
    out.map((s) => s.id),
    ["1", "2"],
  );
});

test("filterSessions: unread filter", () => {
  const sessions = [
    session({ id: "1", updatedAt: 5000, createdAt: 1000 }),
    session({ id: "2", updatedAt: 3000, createdAt: 1000 }),
    session({ id: "3", updatedAt: 2000, createdAt: 2000 }),
  ];
  const out = filterSessions(sessions, {
    filter: "unread",
    query: "",
    showCompleted: false,
    viewed: { 1: 4000, 2: 3000 },
  });
  assert.deepEqual(
    out.map((s) => s.id),
    ["1"],
  );
});

test("filterSessions: query matches request, summary, and message text (case-insensitive)", () => {
  const sessions = [
    session({ id: "1", request: "Refactor Auth", updatedAt: 5 }),
    session({ id: "2", request: "Other", summary: "auth tokens", updatedAt: 4 }),
    session({
      id: "3",
      request: "Other",
      messages: [{ id: "m", role: "user", text: "please AUTH now", at: 1 }],
      updatedAt: 3,
    }),
    session({ id: "4", request: "Unrelated", updatedAt: 2 }),
  ];
  const out = filterSessions(sessions, {
    filter: "all",
    query: "auth",
    showCompleted: false,
    viewed: {},
  });
  assert.deepEqual(
    out.map((s) => s.id),
    ["1", "2", "3"],
  );
});

test("filterSessions: hides complete unless showCompleted", () => {
  const sessions = [
    session({ id: "1", status: "ready", updatedAt: 3 }),
    session({ id: "2", status: "complete", updatedAt: 4 }),
    session({ id: "3", status: "stopped", updatedAt: 2 }),
  ];
  const hidden = filterSessions(sessions, {
    filter: "all",
    query: "",
    showCompleted: false,
    viewed: {},
  });
  assert.deepEqual(
    hidden.map((s) => s.id),
    ["1", "3"],
  );
  const shown = filterSessions(sessions, {
    filter: "all",
    query: "",
    showCompleted: true,
    viewed: {},
  });
  assert.deepEqual(
    shown.map((s) => s.id),
    ["2", "1", "3"],
  );
});

test("filterSessions: sorts by updatedAt descending", () => {
  const sessions = [
    session({ id: "old", updatedAt: 10 }),
    session({ id: "new", updatedAt: 30 }),
    session({ id: "mid", updatedAt: 20 }),
  ];
  const out = filterSessions(sessions, {
    filter: "all",
    query: "",
    showCompleted: false,
    viewed: {},
  });
  assert.deepEqual(
    out.map((s) => s.id),
    ["new", "mid", "old"],
  );
});
