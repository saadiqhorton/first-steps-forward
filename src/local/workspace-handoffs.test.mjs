import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceHandoffs } from "./workspace-handoffs.mjs";

function harness({ sessions = [], onStart } = {}) {
  let clock = 1000;
  const state = {
    projects: [
      { id: "web", name: "Web", path: "/tmp/web", defaultAgent: "codex" },
      { id: "api", name: "API", path: "/tmp/api", defaultAgent: "codex" },
    ],
    sessions,
    assistantThreads: [{ id: "chat", title: "Catch up", status: "idle" }],
    assistantMessages: [],
    handoffs: [],
  };
  const started = [];
  const service = createWorkspaceHandoffs({
    state,
    save: async () => {},
    id: (() => {
      let n = 0;
      return () => `id${++n}`;
    })(),
    now: () => clock,
    projectStart: async (input) => {
      started.push(input);
      if (onStart) return onStart(input, state, clock);
      const session = {
        id: `s${started.length}`,
        projectId: input.projectId,
        permission: input.permission,
        status: "working",
        messages: [{ id: "m1", role: "user", text: input.request, at: clock }],
        queuedMessages: [],
      };
      state.sessions.push(session);
      return session;
    },
    sendToSession: async (session, text, meta) => {
      const message = {
        id: `msg${session.messages.length + 1}`,
        role: "user",
        text,
        at: clock,
        ...meta,
      };
      session.messages.push(message);
      if (session.busy) (session.queuedMessages ??= []).push(text);
      else session.status = "working";
      return message;
    },
    isBusy: (session) => !!session.busy,
    getAppAddress: () => "http://127.0.0.1:1",
  });
  return { state, service, started, tick: (ms) => (clock += ms) };
}

test("an assistant request to a build target waits for the owner, then starts one session", async () => {
  const { state, service, started } = harness();
  const result = await service.dispatch({
    source: { kind: "assistant", id: "chat" },
    targets: [{ projectId: "web", request: "Check the login form against the API diff" }],
    deliveryKey: "k1",
  });
  const handoff = result.handoffs[0];
  assert.equal(handoff.status, "approval_pending");
  assert.equal(started.length, 0);

  const sent = await service.decide(handoff.id, { decision: "send" });
  assert.equal(sent.handoff.status, "delivered");
  assert.equal(started.length, 1);
  assert.equal(started[0].handoffId, handoff.id);
  assert.equal(started[0].permission, "build");
  assert.equal(state.handoffs[0].status, "delivered");
});

test("a reply from the destination turn comes back to the assistant chat", async () => {
  const { state, service, tick } = harness({
    onStart: (input, state, clock) => {
      const session = {
        id: "target",
        projectId: input.projectId,
        status: "working",
        messages: [{ id: "m1", role: "user", text: input.request, at: clock }],
      };
      state.sessions.push(session);
      return session;
    },
  });
  const { handoffs } = await service.dispatch({
    source: { kind: "assistant", id: "chat" },
    targets: [{ projectId: "web", request: "Check the login form" }],
    deliveryKey: "k1",
  });
  const id = handoffs[0].id;
  await service.decide(id, { decision: "send" });
  const target = state.sessions[0];
  target.busy = false;
  tick(50);
  target.messages.push({ id: "a1", role: "agent", text: "The login form still works.", at: 1050 });
  target.status = "ready";
  await service.list({ sourceThreadId: "chat" });

  assert.equal(state.handoffs[0].status, "replied");
  assert.equal(state.handoffs[0].answer, "The login form still works.");
  assert.equal(state.assistantMessages.length, 1);
  assert.match(state.assistantMessages[0].text, /Web replied/);
  assert.match(state.assistantMessages[0].text, /still works/);
  assert.equal(state.assistantMessages[0].handoffId, id);
});

test("an earlier turn finishing after the request was queued does not count as the answer", async () => {
  const session = {
    id: "busy",
    projectId: "web",
    status: "working",
    busy: true,
    messages: [{ id: "u0", role: "user", text: "Old work", at: 1 }],
    queuedMessages: ["old follow-up"],
  };
  const { state, service, tick } = harness({ sessions: [session] });
  const { handoffs } = await service.dispatch({
    source: { kind: "assistant", id: "chat" },
    targets: [{ sessionId: "busy", request: "Ask how it is going" }],
    deliveryKey: "k2",
    confirmed: true,
  });
  const record = state.handoffs.find((item) => item.id === handoffs[0].id);
  assert.equal(record.status, "queued");
  assert.equal(record.pendingQueue, true);

  // The old turn ends and leaves a reply; the queued message has not run yet.
  session.messages.push({ id: "a0", role: "agent", text: "Old answer", at: 1010 });
  session.status = "ready";
  session.busy = false;
  tick(20);
  await service.list({});
  assert.equal(record.status, "queued");
  assert.equal(record.answer, undefined);

  // The target consumes the queued follow-up and answers it.
  session.queuedMessages = ["old follow-up"];
  session.busy = true;
  session.status = "working";
  tick(10);
  await service.list({});
  assert.equal(record.status, "delivered");

  session.busy = false;
  session.status = "ready";
  tick(10);
  session.messages.push({ id: "a1", role: "agent", text: "It is going well.", at: 1060 });
  await service.list({});
  assert.equal(record.status, "replied");
  assert.equal(record.answer, "It is going well.");
});

test("a delivery key cannot create duplicate work", async () => {
  const { service, started } = harness();
  const input = {
    source: { kind: "assistant", id: "chat" },
    targets: [{ projectId: "web", request: "Same request" }],
    deliveryKey: "same",
    confirmed: true,
  };
  const first = await service.dispatch(input);
  const second = await service.dispatch(input);
  assert.equal(started.length, 1);
  assert.equal(first.handoffs[0].id, second.handoffs[0].id);
});

test("a child session inherits the project initiator's permission ceiling", async () => {
  const source = {
    id: "origin",
    projectId: "api",
    permission: "plan",
    status: "working",
    messages: [],
  };
  const { service, started } = harness({ sessions: [source] });
  const result = await service.dispatch({
    source: { kind: "session", id: "origin" },
    targets: [{ projectId: "web", request: "Look at the login form", permission: "build" }],
    deliveryKey: "ceiling",
  });
  assert.equal(result.handoffs[0].status, "delivered");
  assert.equal(started[0].permission, "plan");
});

test("a missing destination is reported and a deliberate retry links two attempts", async () => {
  const { state, service, started } = harness();
  const { handoffs } = await service.dispatch({
    source: { kind: "assistant", id: "chat" },
    targets: [{ projectId: "web", request: "Check it" }],
    deliveryKey: "k3",
    confirmed: true,
  });
  const record = state.handoffs.find((item) => item.id === handoffs[0].id);
  state.sessions.length = 0;
  await service.list({});
  assert.equal(record.status, "missing_target");
  const retried = await service.retry(record.id);
  assert.equal(retried.handoff.attempt, 2);
  assert.equal(retried.handoff.previousId, record.id);
  assert.equal(started.length, 2);
});

test("a queued request answered before the UI polls is still correlated", async () => {
  const session = {
    id: "busy",
    projectId: "web",
    status: "working",
    busy: true,
    messages: [{ id: "u0", role: "user", text: "Old work", at: 1 }],
    queuedMessages: ["old follow-up"],
    turnStartedAt: 900,
  };
  const { state, service, tick } = harness({ sessions: [session] });
  const { handoffs } = await service.dispatch({
    source: { kind: "assistant", id: "chat" },
    targets: [{ sessionId: "busy", request: "Ask how it is going" }],
    deliveryKey: "fast-reply",
    confirmed: true,
  });
  const record = state.handoffs.find((item) => item.id === handoffs[0].id);
  assert.equal(record.status, "queued");

  // The target consumes the queue and answers in one quick turn, all before
  // the next handoff poll. The reply time is after the new turn started but
  // before reconcile runs.
  session.queuedMessages = [];
  session.turnStartedAt = 1005;
  session.status = "working";
  session.messages.push({ id: "a1", role: "agent", text: "It is going well.", at: 1006 });
  session.busy = false;
  session.status = "ready";
  tick(50);
  await service.list({});
  assert.equal(record.status, "replied");
  assert.equal(record.answer, "It is going well.");
});

test("a repeated retry request starts one attempt, not two", async () => {
  const { state, service, started } = harness();
  const { handoffs } = await service.dispatch({
    source: { kind: "assistant", id: "chat" },
    targets: [{ projectId: "web", request: "Check it" }],
    deliveryKey: "retry-once",
    confirmed: true,
  });
  const record = state.handoffs.find((item) => item.id === handoffs[0].id);
  state.sessions.length = 0;
  await service.list({});
  assert.equal(record.status, "missing_target");

  const [first, second] = await Promise.all([service.retry(record.id), service.retry(record.id)]);
  assert.equal(first.handoff.id, second.handoff.id);
  assert.equal(started.length, 2);
  assert.equal(state.handoffs.filter((item) => item.previousId === record.id).length, 1);
});

test("a project tool call requires the active turn and stays inside that session's capability", async () => {
  const session = {
    id: "live",
    projectId: "web",
    permission: "build",
    status: "working",
    busy: true,
    messages: [],
  };
  const { state, service } = harness({ sessions: [session] });
  const capability = service.sessionCapability(session);
  assert.ok(capability?.token);
  const tools = await service.callSessionTool(
    "live",
    capability.token,
    "workspace_list_projects",
    {},
  );
  assert.deepEqual(
    tools.map((p) => p.id),
    ["web", "api"],
  );
  await assert.rejects(
    service.callSessionTool("live", "wrong", "workspace_list_projects", {}),
    /capability expired/,
  );
  session.busy = false;
  await assert.rejects(
    service.callSessionTool("live", capability.token, "workspace_list_projects", {}),
    /capability expired/,
  );
  // A tool that starts work in another project is tracked as a handoff.
  session.busy = true;
  const started = await service.callSessionTool(
    "live",
    capability.token,
    "workspace_start_project",
    {
      projectId: "api",
      request: "Check the API diff",
    },
  );
  assert.equal(started.status, "delivered");
  assert.equal(state.handoffs.length, 1);
});

test("a long agent-to-agent chain asks the user to continue it", async () => {
  const source = {
    id: "origin",
    projectId: "api",
    permission: "build",
    status: "working",
    lastUserMessageAt: 5,
    messages: Array.from({ length: 20 }, (_, index) => ({
      id: `a${index}`,
      role: "agent",
      text: "Worked on it.",
      at: 10 + index,
    })),
  };
  const { service, started } = harness({ sessions: [source] });
  const result = await service.dispatch({
    source: { kind: "session", id: "origin" },
    targets: [{ projectId: "web", request: "Keep going" }],
    deliveryKey: "chain",
  });
  assert.equal(result.handoffs[0].status, "approval_pending");
  assert.equal(result.handoffs[0].approval.reason, "chain");
  assert.equal(started.length, 0);

  const sent = await service.decide(result.handoffs[0].id, { decision: "send" });
  assert.equal(sent.handoff.status, "delivered");
  assert.equal(started.length, 1);
});
