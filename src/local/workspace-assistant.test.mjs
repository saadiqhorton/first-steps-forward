import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWorkspaceAssistant as createAssistantService } from "./workspace-assistant.mjs";
import { saveAttachment } from "./attachments.mjs";

// Every assistant gets its own temp data dir: Luna now writes under
// <dataDir>/luna, and a test must never touch the real one.
const dataDirs = [];
const createWorkspaceAssistant = (options = {}) => {
  const dataDir = options.dataDir ?? mkdtempSync(path.join(os.tmpdir(), "ade-luna-"));
  dataDirs.push(dataDir);
  return createAssistantService({ dataDir, ...options });
};
after(() => {
  for (const dir of dataDirs) rmSync(dir, { recursive: true, force: true });
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(thread) {
  for (
    let i = 0;
    i < 50 && (thread.status === "thinking" || thread.status === "awaiting_input");
    i++
  )
    await tick();
}

test("workspace chats persist a real adapter turn and retain reply attribution", async () => {
  const state = {
    agents: [{ id: "fake", installed: true, signedIn: true }],
    sessions: [],
    projects: [],
  };
  let writes = 0;
  const service = createWorkspaceAssistant({
    state,
    save: async () => {
      writes++;
    },
    id: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
    now: () => 10,
    adapters: {
      fake: {
        runTurn: async (_input, io) => {
          io.emit({ type: "text", text: "Real adapter reply." });
          return { ok: true };
        },
      },
    },
    resolveSessionOptions: async () => ({ ok: true, value: {} }),
  });
  const { thread, runId } = await service.startThread({
    agentId: "fake",
    text: "Summarize my workspace.",
  });
  assert.ok(runId);
  for (let i = 0; i < 20 && thread.status === "thinking"; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  const result = service.getThread(thread.id);
  assert.equal(result.messages.at(-1).text, "Real adapter reply.");
  assert.equal(result.messages.at(-1).agentId, "fake");
  assert.equal(thread.status, "idle");
  assert.ok(writes >= 3);
});

test("workspace tool calls require the active turn's capability", async () => {
  const state = {
    agents: [{ id: "fake", installed: true, signedIn: true }],
    sessions: [],
    projects: [],
  };
  let finish;
  const service = createWorkspaceAssistant({
    state,
    save: async () => {},
    id: () => "stable",
    adapters: {
      fake: {
        protocol: "acp",
        runTurn: async () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    },
    resolveSessionOptions: async () => ({ ok: true, value: {} }),
  });
  const { thread } = await service.startThread({ agentId: "fake", text: "Run" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(
    service.callTool(thread.id, "wrong", "workspace_list_projects", {}),
    /capability expired/,
  );
  finish?.({ ok: true });
});

test("attachment ids resolve and are stored on the user message", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ade-wa-att-"));
  try {
    const meta = await saveAttachment(dataDir, {
      name: "notes.txt",
      mime: "text/plain",
      bytes: Buffer.from("hello attachment"),
    });
    const absPath = path.join(dataDir, "attachments", meta.id, "file");
    const state = {
      agents: [{ id: "fake", installed: true, signedIn: true }],
      sessions: [],
      projects: [],
    };
    const captured = {};
    const service = createWorkspaceAssistant({
      state,
      save: async () => {},
      dataDir,
      id: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
      now: () => 10,
      adapters: {
        fake: {
          runTurn: async (input, io) => {
            captured.prompt = input.prompt;
            captured.attachments = input.attachments;
            io.emit({ type: "text", text: "done" });
            return { ok: true };
          },
        },
      },
      resolveSessionOptions: async () => ({ ok: true, value: {} }),
    });
    const { thread } = await service.startThread({
      agentId: "fake",
      text: "Read this file",
      attachmentIds: [meta.id],
    });
    await settle(thread);
    const userMessage = service.getThread(thread.id).messages.find((m) => m.role === "user");
    assert.deepEqual(userMessage.attachments, [
      { id: meta.id, name: "notes.txt", mime: "text/plain", size: meta.size, kind: "file" },
    ]);
    // Native files handed to the adapter (recordings excluded; this is a plain file).
    assert.equal(captured.attachments.length, 1);
    assert.equal(captured.attachments[0].path, absPath);
    assert.equal(captured.attachments[0].kind, "file");
    assert.equal(captured.attachments[0].name, "notes.txt");
    assert.equal(captured.attachments[0].mime, "text/plain");
    // The prompt carries the path reference so the agent can read the file.
    // Luna's brief comes first; the user text follows it.
    assert.ok(captured.prompt.includes("Read this file"));
    assert.ok(captured.prompt.includes(absPath));
    assert.ok(captured.prompt.includes("notes.txt"));

    // A follow-up message stores its own attachment metadata too.
    const image = await saveAttachment(dataDir, {
      name: "shot.png",
      mime: "image/png",
      bytes: Buffer.from("pngbytes"),
    });
    await service.sendMessage(thread.id, { text: "Also this image", attachmentIds: [image.id] });
    await settle(thread);
    const users = service.getThread(thread.id).messages.filter((m) => m.role === "user");
    assert.equal(users.length, 2);
    assert.deepEqual(users[1].attachments, [
      { id: image.id, name: "shot.png", mime: "image/png", size: image.size, kind: "image" },
    ]);
    assert.equal(captured.attachments[0].kind, "image");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("invalid attachment ids are rejected with a 400 and no thread is created", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ade-wa-att-"));
  try {
    const state = {
      agents: [{ id: "fake", installed: true, signedIn: true }],
      sessions: [],
      projects: [],
    };
    const service = createWorkspaceAssistant({
      state,
      save: async () => {},
      dataDir,
      adapters: { fake: { runTurn: async () => ({ ok: true }) } },
      resolveSessionOptions: async () => ({ ok: true, value: {} }),
    });
    await assert.rejects(
      () =>
        service.startThread({ agentId: "fake", text: "x", attachmentIds: ["not-a-valid-uuid"] }),
      (e) => e.status === 400 && /Invalid attachment id/.test(e.message),
    );
    assert.equal(state.assistantThreads.length, 0);
    assert.equal(state.assistantMessages.length, 0);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("listAgents reports workspace tool support honestly", () => {
  const state = {
    agents: [
      { id: "claude" },
      { id: "codex" },
      { id: "opencode" },
      { id: "pi" },
      { id: "mystery" },
    ],
    sessions: [],
    projects: [],
  };
  const service = createWorkspaceAssistant({
    state,
    save: async () => {},
    adapters: {
      claude: { id: "claude", protocol: "acp" },
      codex: { id: "codex" },
      opencode: { id: "opencode" },
      pi: { id: "pi" },
    },
  });
  const byId = Object.fromEntries(service.listAgents().map((a) => [a.id, a.workspaceAssistant]));
  assert.equal(byId.claude, "tools");
  assert.equal(byId.codex, "tools");
  assert.equal(byId.opencode, "tools");
  assert.equal(byId.pi, "tools");
  assert.equal(byId.mystery, "chat_only");
});

test("workspace tool capability reaches CLI adapters when a base URL is known", async () => {
  const captured = {};
  const state = {
    agents: [{ id: "codex", installed: true, signedIn: true }],
    sessions: [],
    projects: [],
  };
  const service = createWorkspaceAssistant({
    state,
    save: async () => {},
    getAppAddress: () => "http://127.0.0.1:4321",
    adapters: {
      codex: {
        id: "codex",
        runTurn: async (input) => {
          captured.workspaceAssistant = input.workspaceAssistant;
          return { ok: true };
        },
      },
    },
    resolveSessionOptions: async () => ({ ok: true, value: {} }),
  });
  const { thread } = await service.startThread({ agentId: "codex", text: "hi" });
  await settle(thread);
  assert.ok(captured.workspaceAssistant, "codex receives the capability");
  assert.equal(
    captured.workspaceAssistant.url,
    "http://127.0.0.1:4321/api/workspace/assistant/tool-call",
  );
  assert.equal(captured.workspaceAssistant.threadId, thread.id);
  assert.ok(captured.workspaceAssistant.token);
});

test("catch-up reports evidence across projects and advances its cursor", async () => {
  const state = {
    agents: [],
    projects: [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" },
    ],
    sessions: [
      {
        id: "s1",
        projectId: "p1",
        status: "ready",
        request: "Build feature",
        summary: "Implemented the thing",
        messages: [{ id: "m1", role: "agent", text: "Implemented the thing", at: 10 }],
        checks: [{ name: "Project checks", status: "not_run" }],
        updatedAt: 10,
        createdAt: 5,
      },
      {
        id: "s2",
        projectId: "p2",
        status: "ready",
        request: "Run checks",
        messages: [],
        checks: [{ name: "Lint", status: "failed", detail: "npm run lint · exit 1" }],
        updatedAt: 20,
        createdAt: 15,
      },
      {
        id: "s3",
        projectId: "p1",
        status: "working",
        request: "Deploy?",
        messages: [],
        updatedAt: 30,
        createdAt: 25,
        pendingPermissions: [{ id: "pp1", title: "Approve deploy", kind: "allow", options: [] }],
      },
      {
        id: "s4",
        projectId: "p2",
        status: "stopped",
        request: "Long task",
        messages: [],
        updatedAt: 40,
        createdAt: 35,
      },
      {
        id: "s5",
        projectId: "p2",
        status: "working",
        request: "Investigate",
        messages: [],
        updatedAt: 12,
        createdAt: 12,
        createdBy: "workspace-assistant",
      },
    ],
    handoffs: [
      {
        id: "h1",
        source: { kind: "assistant", id: "thread-1" },
        status: "replied",
        answer: "All done",
        targetProjectId: "p2",
        targetProjectName: "Beta",
        targetSessionId: "s9",
        returnedAt: 45,
        updatedAt: 45,
      },
    ],
  };
  let clock = 100;
  const service = createWorkspaceAssistant({ state, save: async () => {}, now: () => clock });
  const first = await service.catchup("thread-1", {});
  const kinds = Object.fromEntries(first.items.map((i) => [i.kind, i]));

  assert.ok(kinds.failed, "reports the failed check");
  assert.match(kinds.failed.text, /Lint/);
  assert.match(kinds.failed.text, /exit 1/);
  assert.equal(kinds.failed.href, "/p/p2/conversations/s2");

  assert.ok(kinds.permission, "reports the pending approval");
  assert.match(kinds.permission.text, /Approve deploy/);

  assert.ok(kinds.ready, "reports the completed reply");
  assert.match(kinds.ready.text, /Implemented the thing/);
  assert.equal(kinds.ready.href, "/p/p1/conversations/s1");

  assert.ok(kinds.stopped, "reports the stopped session");
  assert.ok(kinds.handoff, "reports the handoff-created session");
  assert.equal(kinds.handoff.href, "/p/p2/conversations/s5");

  assert.ok(kinds.reply, "reports the returned handoff answer");
  assert.match(kinds.reply.text, /All done/);
  assert.equal(kinds.reply.href, "/p/p2/conversations/s9");

  // Newest first, and every item carries a source label.
  assert.deepEqual(
    first.items.map((i) => i.kind),
    ["reply", "stopped", "permission", "failed", "handoff", "ready"],
  );
  assert.equal(kinds.ready.source.label, "Alpha");
  assert.equal(kinds.failed.source.label, "Beta");
  assert.equal(first.cursor, 100);
  assert.equal(state.workspaceAssistant.catchupAt, 100);

  // The cursor advanced: a second call reports nothing new.
  const second = await service.catchup("thread-1", {});
  assert.deepEqual(second.items, []);
});

test("streamed assistant text events merge into one message", async () => {
  const state = {
    agents: [{ id: "fake", installed: true, signedIn: true }],
    sessions: [],
    projects: [],
  };
  let clock = 0;
  const service = createWorkspaceAssistant({
    state,
    save: async () => {},
    now: () => clock,
    adapters: {
      fake: {
        runTurn: async (_input, io) => {
          io.emit({ type: "text", text: "Hello " });
          clock = 500;
          io.emit({ type: "text", text: "world" });
          return { ok: true };
        },
      },
    },
    resolveSessionOptions: async () => ({ ok: true, value: {} }),
  });
  const { thread } = await service.startThread({ agentId: "fake", text: "Go" });
  await settle(thread);
  const assistant = service.getThread(thread.id).messages.filter((m) => m.role === "assistant");
  assert.equal(assistant.length, 1);
  assert.equal(assistant[0].text, "Hello world");
  assert.equal(assistant[0].agentId, "fake");
});

test("threads expose a clipped preview and unread flag without mutating read state", async () => {
  let clock = 1000;
  const state = {
    agents: [{ id: "fake", installed: true, signedIn: true }],
    sessions: [],
    projects: [],
  };
  const reply = "A".repeat(200);
  const service = createWorkspaceAssistant({
    state,
    save: async () => {},
    now: () => clock,
    id: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
    adapters: {
      fake: {
        runTurn: async (_input, io) => {
          io.emit({ type: "text", text: reply });
          return { ok: true };
        },
      },
    },
    resolveSessionOptions: async () => ({ ok: true, value: {} }),
  });
  const { thread } = await service.startThread({ agentId: "fake" });
  assert.equal(thread.readAt, 1000);
  let listed = service.listThreads();
  assert.equal(listed[0].id, thread.id);
  assert.equal(listed[0].unread, false);
  assert.equal(listed[0].preview, undefined);
  assert.equal(thread.readAt, 1000); // listing does not mutate read state

  clock = 2000;
  await service.sendMessage(thread.id, { text: "Do the thing" });
  await settle(thread);
  const detail = service.getThread(thread.id);
  assert.equal(detail.thread.unread, true);
  assert.equal(detail.thread.preview, reply.slice(0, 140));
  assert.equal(thread.readAt, 1000); // reading does not mutate read state

  await service.markRead(thread.id, 3000);
  assert.equal(service.listThreads()[0].unread, false);
});

test("a missing adapter fails the chat instead of rejecting in the background", async () => {
  const state = {
    agents: [{ id: "fake", name: "Fake", installed: true, signedIn: true }],
    sessions: [],
    projects: [],
  };
  const service = createWorkspaceAssistant({
    state,
    save: async () => {},
    id: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
    adapters: {},
    resolveSessionOptions: async () => ({ ok: true, value: {} }),
  });
  const { thread } = await service.startThread({ agentId: "fake", text: "Hello" });
  for (let i = 0; i < 20 && thread.status === "idle"; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(thread.status, "failed");
  assert.match(state.assistantActivity.at(-1).text, /unavailable/);
});

test("batch deletion removes the chats and cancels their drafts", async () => {
  const state = {
    agents: [{ id: "fake", installed: true, signedIn: true }],
    sessions: [],
    projects: [],
  };
  const cancelled = [];
  const service = createWorkspaceAssistant({
    state,
    save: async () => {},
    id: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
    onDeleteThread: async (threadId) => cancelled.push(threadId),
  });
  const first = await service.startThread({ text: "" });
  const second = await service.startThread({ text: "" });
  state.assistantMessages.push(
    { id: "m1", threadId: first.thread.id, role: "user", text: "One", at: 1 },
    { id: "m2", threadId: second.thread.id, role: "user", text: "Two", at: 2 },
  );
  const result = await service.deleteThreads([first.thread.id, second.thread.id, "missing"]);
  assert.equal(result.results.filter((row) => row.deleted).length, 2);
  assert.equal(result.results.at(-1).error, "Assistant chat not found.");
  assert.deepEqual(cancelled.sort(), [first.thread.id, second.thread.id].sort());
  assert.equal(state.assistantThreads.length, 0);
  assert.equal(state.assistantMessages.length, 0);
});

test("changing Luna's agent or model updates the chat and its next turn", async () => {
  const state = {
    agents: [
      { id: "a", name: "A", installed: true, signedIn: true },
      { id: "b", name: "B", installed: true, signedIn: true },
    ],
    sessions: [],
    projects: [],
  };
  const checked = [];
  const service = createWorkspaceAssistant({
    state,
    save: async () => {},
    id: () => "thread",
    adapters: {},
    resolveSessionOptions: async (agentId, model, options) => {
      checked.push([agentId, model, options]);
      return { ok: true, value: { effort: options?.effort } };
    },
  });
  const { thread } = await service.startThread({ agentId: "a", text: "" });
  thread.defaultModel = "stale-agent-default";
  const changed = await service.updateThread(thread.id, {
    agentId: "b",
    model: "m1",
    effort: "low",
  });
  assert.equal(changed.thread.agentId, "b");
  assert.equal(changed.thread.model, "m1");
  assert.equal(changed.thread.effort, "low");
  assert.equal(changed.thread.defaultModel, undefined);
  // Permission rides along with every option check; the new agent resets to plan.
  assert.deepEqual(checked.at(-1), ["b", "m1", { effort: "low", permission: "plan" }]);
  await service.updateThread(thread.id, { model: "" });
  assert.equal(thread.model, undefined);
  await assert.rejects(service.updateThread("missing", { model: "m" }), /not found/);
});

test("renaming an assistant chat is saved and does not mark it unread", async () => {
  const state = {
    agents: [{ id: "fake", installed: true, signedIn: true }],
    sessions: [],
    projects: [],
  };
  let writes = 0;
  const service = createWorkspaceAssistant({
    state,
    save: async () => {
      writes++;
    },
    id: () => "thread",
    now: () => 100,
  });
  const { thread } = await service.startThread({ text: "" });
  const before = writes;
  const renamed = await service.renameThread(thread.id, "Release checklist");
  assert.equal(renamed.thread.title, "Release checklist");
  assert.equal(thread.title, "Release checklist");
  assert.equal(writes, before + 1);
  assert.equal(service.listThreads()[0].unread, false);
  await assert.rejects(service.renameThread("missing", "x"), /not found/);
});

test("agent and model changes are refused while the chat is running", async () => {
  let finish;
  const state = {
    agents: [
      { id: "a", installed: true, signedIn: true },
      { id: "b", installed: true, signedIn: true },
    ],
    sessions: [],
    projects: [],
  };
  const service = createWorkspaceAssistant({
    state,
    save: async () => {},
    id: () => "thread",
    adapters: {
      a: {
        runTurn: async () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    },
    resolveSessionOptions: async () => ({ ok: true, value: {} }),
  });
  const { thread } = await service.startThread({ agentId: "a", text: "Run" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(service.updateThread(thread.id, { agentId: "b" }), /already running/);
  await assert.rejects(service.updateThread(thread.id, { model: "m1" }), /already running/);
  // Renaming stays available while work runs.
  await service.renameThread(thread.id, "Running chat");
  assert.equal(thread.title, "Running chat");
  finish?.({ ok: true });
  await settle(thread);
});

test("threads list newest first with a preview and unread state", async () => {
  let clock = 100;
  const state = {
    agents: [{ id: "fake", installed: true, signedIn: true }],
    sessions: [],
    projects: [],
  };
  const replies = ["First reply", "Second reply"];
  let next = 0;
  const service = createWorkspaceAssistant({
    state,
    save: async () => {},
    id: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
    now: () => clock,
    adapters: {
      fake: {
        runTurn: async (_input, io) => {
          clock += 50;
          io.emit({ type: "text", text: replies[next++] });
          return { ok: true };
        },
      },
    },
    resolveSessionOptions: async () => ({ ok: true, value: {} }),
  });
  const first = await service.startThread({ agentId: "fake", text: "One" });
  await settle(first.thread);
  clock = 300;
  const second = await service.startThread({ agentId: "fake", text: "Two" });
  await settle(second.thread);

  let listed = service.listThreads();
  assert.deepEqual(
    listed.map((thread) => thread.id),
    [second.thread.id, first.thread.id],
  );
  assert.equal(listed[0].preview, "Second reply");
  assert.equal(listed[0].unread, true);
  assert.equal(listed[1].unread, true);

  await service.markRead(first.thread.id, clock);
  listed = service.listThreads();
  assert.equal(listed.find((thread) => thread.id === first.thread.id).unread, false);
});

test("voice preferences hold only the dictation chime", async () => {
  const state = { agents: [], sessions: [], projects: [] };
  const service = createWorkspaceAssistant({ state, save: async () => {} });
  assert.deepEqual(service.voice(), { chimeDuringDictation: true });
  const updated = await service.updateVoice({ chimeDuringDictation: false, muted: true });
  assert.deepEqual(updated.voice, { chimeDuringDictation: false });
  assert.deepEqual(state.voice, { chimeDuringDictation: false });
  await service.updateVoice({ chimeDuringDictation: "yes" });
  assert.equal(state.voice.chimeDuringDictation, false);
});

test("legacy muted and speakReplies voice state never leaks out and is dropped on update", async () => {
  const state = {
    agents: [],
    sessions: [],
    projects: [],
    voice: { muted: true, speakReplies: false, chimeDuringDictation: false },
  };
  const service = createWorkspaceAssistant({ state, save: async () => {} });
  assert.deepEqual(service.voice(), { chimeDuringDictation: false });
  await service.updateVoice({ chimeDuringDictation: true });
  assert.deepEqual(state.voice, { chimeDuringDictation: true });
  state.voice = { muted: true, speakReplies: false, chimeDuringDictation: false };
  await service.updateVoice({});
  assert.deepEqual(state.voice, { chimeDuringDictation: false });
});

test("a chat turn runs in the Luna root and a work turn in its own folder", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ade-luna-modes-"));
  const spawned = [];
  const turnPaths = [];
  const state = {
    agents: [{ id: "fake", installed: true, signedIn: true }],
    sessions: [],
    projects: [],
  };
  const service = createWorkspaceAssistant({
    state,
    save: async () => {},
    dataDir,
    adapters: {
      fake: {
        runTurn: async (input, io) => {
          turnPaths.push(input.projectPath);
          io.spawn("fake-bin", [], {});
          io.emit({ type: "text", text: "ok" });
          return { ok: true };
        },
      },
    },
    spawn: (_bin, _args, options) => {
      spawned.push(options.cwd);
      return { kill() {} };
    },
    resolveSessionOptions: async (_agent, _model, options) => ({
      ok: true,
      value: options?.permission ? { permission: options.permission } : {},
    }),
  });

  const chat = await service.startThread({ agentId: "fake", text: "hello" });
  await settle(chat.thread);
  assert.equal(chat.thread.mode, "chat");
  assert.equal(chat.thread.permission, "plan");
  assert.equal(spawned.at(-1), path.join(dataDir, "luna"));
  assert.equal(turnPaths.at(-1), path.join(dataDir, "luna"));
  assert.ok(existsSync(path.join(dataDir, "luna")));
  assert.equal(existsSync(path.join(dataDir, "luna", chat.thread.id)), false);

  const work = await service.startThread({
    agentId: "fake",
    text: "make something",
    mode: "work",
  });
  await settle(work.thread);
  assert.equal(work.thread.mode, "work");
  assert.equal(work.thread.permission, "build");
  assert.equal(spawned.at(-1), path.join(dataDir, "luna", work.thread.id));
  assert.equal(turnPaths.at(-1), path.join(dataDir, "luna", work.thread.id));
  assert.ok(existsSync(path.join(dataDir, "luna", work.thread.id)));
});

test("a continuing Luna turn keeps the folder and only re-briefs on a mode change", async () => {
  const prompts = [];
  const state = {
    agents: [{ id: "fake", installed: true, signedIn: true }],
    sessions: [],
    projects: [],
  };
  const service = createWorkspaceAssistant({
    state,
    save: async () => {},
    adapters: {
      fake: {
        runTurn: async (input, io) => {
          prompts.push(input.prompt);
          io.emit({ type: "conversation", id: "agent-session" });
          io.spawn("fake-bin", [], {});
          io.emit({ type: "text", text: "ok" });
          return { ok: true };
        },
      },
    },
    spawn: () => ({ kill() {} }),
    resolveSessionOptions: async (_agent, _model, options) => ({
      ok: true,
      value: options?.permission ? { permission: options.permission } : {},
    }),
  });

  const { thread } = await service.startThread({ agentId: "fake", text: "first" });
  await settle(thread);
  assert.match(prompts[0], /^You are Luna/);

  await service.sendMessage(thread.id, { text: "second" });
  await settle(thread);
  assert.equal(prompts[1].startsWith("You are Luna"), false);

  await service.updateThread(thread.id, { mode: "work" });
  assert.equal(thread.permission, "build");
  await service.sendMessage(thread.id, { text: "third" });
  await settle(thread);
  assert.match(prompts[2], /^You are Luna/);
  assert.match(prompts[2], /create and edit files/);
});

test("threads written before modes existed read and run as read-only chats", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ade-luna-legacy-"));
  const turnPaths = [];
  const state = {
    agents: [{ id: "fake", installed: true, signedIn: true }],
    sessions: [],
    projects: [],
  };
  state.assistantThreads = [
    {
      id: "old",
      agentId: "fake",
      title: "Old",
      status: "idle",
      createdAt: 1,
      updatedAt: 1,
      readAt: 1,
    },
  ];
  const service = createWorkspaceAssistant({
    state,
    save: async () => {},
    dataDir,
    adapters: {
      fake: {
        runTurn: async (input, io) => {
          turnPaths.push(input.projectPath);
          io.emit({ type: "text", text: "ok" });
          return { ok: true };
        },
      },
    },
    resolveSessionOptions: async () => ({ ok: true, value: {} }),
  });

  const detail = service.getThread("old");
  assert.equal(detail.thread.mode, "chat");
  assert.equal(detail.thread.permission, "plan");
  assert.equal(detail.thread.workspacePath, path.join(dataDir, "luna", "old"));

  await service.sendMessage("old", { text: "still works" });
  await settle(state.assistantThreads[0]);
  assert.equal(turnPaths.at(-1), path.join(dataDir, "luna"));
});

test("deleting a chat removes only its own real folder", async () => {
  const outside = mkdtempSync(path.join(os.tmpdir(), "ade-luna-outside-"));
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ade-luna-delete-"));
  const state = { agents: [], sessions: [], projects: [] };
  const service = createWorkspaceAssistant({ state, save: async () => {}, dataDir });

  mkdirSync(path.join(dataDir, "luna", "doomed"), { recursive: true });
  mkdirSync(path.join(dataDir, "luna", "keep"), { recursive: true });
  symlinkSync(outside, path.join(dataDir, "luna", "linked"));

  await service.deleteThread("doomed");
  await service.deleteThread("linked");

  assert.equal(existsSync(path.join(dataDir, "luna", "doomed")), false);
  assert.equal(existsSync(path.join(dataDir, "luna", "keep")), true);
  assert.equal(existsSync(path.join(dataDir, "luna", "linked")), true);
  assert.equal(existsSync(outside), true);
  rmSync(outside, { recursive: true, force: true });
});

test("mode and permission stay consistent and unsupported permissions are rejected", async () => {
  const state = {
    agents: [{ id: "fake", installed: true, signedIn: true }],
    sessions: [],
    projects: [],
  };
  const service = createWorkspaceAssistant({
    state,
    save: async () => {},
    adapters: {},
    resolveSessionOptions: async (_agent, _model, options) => {
      if (options?.permission === "full")
        return { ok: false, error: 'permission "full" is not available for this agent/model.' };
      return { ok: true, value: options?.permission ? { permission: options.permission } : {} };
    },
  });
  const { thread } = await service.startThread({ agentId: "fake", text: "" });

  await service.updateThread(thread.id, { mode: "work" });
  assert.equal(thread.mode, "work");
  assert.equal(thread.permission, "build");

  await service.updateThread(thread.id, { permission: "plan" });
  assert.equal(thread.mode, "chat");
  assert.equal(thread.permission, "plan");

  await assert.rejects(
    service.updateThread(thread.id, { permission: "full" }),
    /not available for this agent\/model/,
  );
  assert.equal(thread.permission, "plan");
  assert.equal(thread.mode, "chat");
});

test("the service ignores a client-supplied workspacePath", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ade-luna-path-"));
  const state = {
    agents: [{ id: "fake", installed: true, signedIn: true }],
    sessions: [],
    projects: [],
  };
  const service = createWorkspaceAssistant({
    state,
    save: async () => {},
    dataDir,
    adapters: {},
    resolveSessionOptions: async () => ({ ok: true, value: {} }),
  });
  const { thread } = await service.startThread({ agentId: "fake", text: "" });
  await service.updateThread(thread.id, { workspacePath: "/etc" });
  assert.equal(thread.workspacePath, path.join(dataDir, "luna", thread.id));
});
