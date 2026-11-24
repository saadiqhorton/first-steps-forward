// How a running turn reaches open pages: replies as they are written, and log lines without
// refetching the conversation.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { runAcpTurn } from "./acp.mjs";
import { adapters } from "./adapters/index.mjs";
import { createSessionTurns } from "./session-turns.mjs";
import { createWorkspaceAssistant } from "./workspace-assistant.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dir = mkdtempSync(path.join(os.tmpdir(), "ade-streaming-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const agent = { id: "fake", name: "Fake", installed: true, signedIn: true };

async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await wait(10);
  }
  assert.fail("timed out");
}

function sessionTurns(runTurn) {
  const seen = { scopes: [], deltas: [], saves: 0 };
  const state = { sessions: [], projects: [{ id: "p", name: "P", path: dir }], agents: [agent] };
  const turns = createSessionTurns({
    state,
    save: async () => void seen.saves++,
    saveSoon: () => {},
    push: (event, key, build) => {
      const data = build();
      if (data) seen.deltas.push({ event, ...data });
    },
    adapters: { fake: { id: "fake", runTurn } },
    dataDir: dir,
    turnContext: () => ({
      computer: null,
      devServer: "",
      agentBrowser: { available: false, note: "" },
    }),
    logs: { append: async () => {}, flush: async () => {} },
    emit: (scope) => seen.scopes.push(scope),
  });
  const start = () =>
    turns.start({
      project: state.projects[0],
      agentId: "fake",
      request: "do it",
      criteria: "",
      text: "do it",
      files: [],
      options: {},
    });
  return { seen, state, start };
}

test("log lines announce only the log", async () => {
  const { seen, state, start } = sessionTurns(async (_input, io) => {
    await wait(5);
    seen.scopes.length = 0;
    for (let i = 0; i < 20; i++) io.emit({ type: "log", line: `line ${i}` });
    seen.during = [...seen.scopes];
    io.emit({ type: "text", text: "Done." });
    return { ok: true };
  });
  await start();
  await until(() => state.sessions[0].status === "ready");
  assert.deepEqual([...new Set(seen.during)], [`logs:${state.sessions[0].id}`]);
});

test("a slow streamed reply stays one message and is pushed as it grows", async (t) => {
  let clock = Date.now();
  t.mock.method(Date, "now", () => (clock += 2000));
  const { seen, state, start } = sessionTurns(async (_input, io) => {
    io.emit({ type: "text", text: "One" });
    io.emit({ type: "text", text: " two", continues: true });
    io.emit({ type: "text", text: " ", continues: true });
    io.emit({ type: "text", text: "three", continues: true });
    return { ok: true };
  });
  await start();
  await until(() => state.sessions[0].status === "ready");
  const replies = state.sessions[0].messages.filter((m) => m.role === "agent");
  assert.deepEqual(
    replies.map((m) => m.text),
    ["One two three"],
  );
  assert.equal(seen.deltas.map((d) => d.append).join(""), "One two three");
  assert.ok(
    seen.deltas.every((d) => d.event === "message-delta" && d.message.id === replies[0].id),
  );
});

test("Luna's streamed reply is one message, saved in the background rather than per piece", async () => {
  let saves = 0;
  let soon = 0;
  const deltas = [];
  const state = { agents: [agent], projects: [], sessions: [] };
  const assistant = createWorkspaceAssistant({
    state,
    save: async () => void saves++,
    saveSoon: () => void soon++,
    push: (_event, _key, build) => deltas.push(build()),
    adapters: {
      fake: {
        id: "fake",
        async runTurn(_input, io) {
          const before = saves;
          io.emit({ type: "text", text: "Hi" });
          for (let i = 0; i < 100; i++) io.emit({ type: "text", text: ".", continues: true });
          for (let i = 0; i < 100; i++) io.emit({ type: "log", line: `line ${i}` });
          assert.equal(saves, before, "a running turn must not save per event");
          return { ok: true };
        },
      },
    },
    dataDir: dir,
  });
  const { thread } = await assistant.startThread({ agentId: "fake", text: "hello" });
  await until(() => state.assistantThreads[0].status === "idle");
  const replies = state.assistantMessages.filter((m) => m.role === "assistant");
  assert.equal(replies.length, 1);
  assert.equal(replies[0].text, `Hi${".".repeat(100)}`);
  assert.ok(soon > 0);
  assert.equal(deltas.filter(Boolean)[0].parentId, thread.id);
});

/** An agent that says `chunks`, `gap` ms apart, answering the ACP handshake. */
function acpAgent(chunks, gap) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  const send = (message) =>
    child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  child.stdin.on("data", async (data) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      const { id, method } = JSON.parse(line);
      if (id === undefined) continue;
      if (method === "initialize")
        send({ id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
      else if (method === "session/new") send({ id, result: { sessionId: "s" } });
      else if (method === "session/prompt") {
        for (const text of chunks) {
          send({
            method: "session/update",
            params: {
              sessionId: "s",
              update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
            },
          });
          await wait(gap);
        }
        send({ id, result: { stopReason: "end_turn" } });
      } else send({ id, result: {} });
    }
  });
  return child;
}

async function acpTexts(chunks, gap) {
  const texts = [];
  await runAcpTurn({
    child: acpAgent(chunks, gap),
    name: "Fake",
    cwd: dir,
    prompt: "go",
    modes: {},
    on: {
      sessionId() {},
      text: (text, continues) => texts.push([text, !!continues]),
      log() {},
      notice() {},
      permission: async () => ({ outcome: "cancelled" }),
    },
  });
  return texts;
}

test("an ACP reply is shown while it is written, not when the turn ends", async () => {
  const texts = await acpTexts(["One", " two", " three"], 120);
  assert.ok(texts.length >= 2, `arrived in ${texts.length} piece(s)`);
  assert.equal(texts.map(([text]) => text).join(""), "One two three");
  assert.deepEqual(
    texts.map(([, continues]) => continues),
    texts.map((_, index) => index > 0),
  );
});

test("ACP pieces that arrive together go out together", async () => {
  assert.deepEqual(await acpTexts(["One", " two"], 0), [["One two", false]]);
});

/** A child process that answers JSON-RPC with `answer(method, params, send)`; undefined exits it. */
function rpcChild(answer) {
  const child = Object.assign(new EventEmitter(), {
    pid: 0,
    exitCode: null,
    signalCode: null,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  const exit = (code) => {
    if (child.exitCode !== null) return;
    child.exitCode = code;
    setImmediate(() => child.emit("close", code, null));
  };
  const send = (message) => child.stdout.write(`${JSON.stringify(message)}\n`);
  child.stdin.on("data", async (data) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      const { id, method, params, result } = JSON.parse(line);
      const reply = await answer(method, params, send, result);
      if (reply === "exit") return exit(2);
      if (id === undefined || !method) continue;
      send(reply?.error ? { id, error: reply.error } : { id, result: reply ?? {} });
    }
  });
  child.stdin.on("finish", () => exit(0));
  return child;
}

/** Run one turn of a real adapter against scripted processes, one per spawn. */
async function adapterTurn(adapter, input, children) {
  const events = [];
  const spawned = [];
  const end = await adapter.runTurn(
    {
      projectPath: dir,
      prompt: "go",
      session: { id: "s" },
      continuing: false,
      dataDir: dir,
      attachments: [],
      computer: null,
      connectors: [],
      ...input,
    },
    {
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
      ask: async () => assert.fail("an unattended turn must not ask"),
      spawn(bin, args) {
        spawned.push([bin, ...args]);
        return children.shift()();
      },
    },
  );
  const texts = events.filter((event) => event.type === "text");
  const logs = events.filter((event) => event.type === "log").map((event) => event.line);
  return { end, events, texts, logs, spawned };
}

const THREAD = "thread-1";
const note = (send, method, params) => send({ method, params: { threadId: THREAD, ...params } });
/** A Codex app server that replies in pieces; `turn` overrides how the turn goes. */
const codexServer = (seen, { opened = {}, turn } = {}) =>
  rpcChild(async (method, params, send, result) => {
    if (!method) return void seen.answers?.push(result);
    seen.calls.push([method, params]);
    if (method === "thread/start" || method === "thread/resume")
      return {
        thread: { id: THREAD },
        sandbox: { type: "workspaceWrite" },
        approvalPolicy: "never",
        ...opened,
      };
    if (method !== "turn/start") return {};
    setImmediate(async () => {
      if (turn) return turn(send);
      const item = { type: "agentMessage", id: "m1", text: "" };
      note(send, "item/started", { item });
      note(send, "item/agentMessage/delta", { itemId: "m1", delta: "Hel" });
      // Another thread (a sub-agent) is not this conversation.
      send({ method: "item/agentMessage/delta", params: { threadId: "other", delta: "LEAK" } });
      note(send, "item/agentMessage/delta", { itemId: "m1", delta: "lo" });
      note(send, "item/completed", { item: { ...item, text: "Hello" } });
      note(send, "item/completed", {
        item: {
          type: "commandExecution",
          id: "c1",
          command: "pwd",
          status: "completed",
          exitCode: 0,
          aggregatedOutput: "/p",
        },
      });
      note(send, "turn/completed", { turn: { id: "t", status: "completed", error: null } });
    });
    return { turn: { id: "t" } };
  });

test("Codex streams its reply, and Activity gets the events codex exec prints", async () => {
  const seen = { calls: [] };
  const { end, texts, logs, events, spawned } = await adapterTurn(
    adapters.codex,
    { version: "stream-1", permission: "build", model: "gpt-x", effort: "low" },
    [() => codexServer(seen)],
  );
  assert.deepEqual(end, { ok: true });
  assert.deepEqual(texts, [
    { type: "text", text: "Hel" },
    { type: "text", text: "lo", continues: true },
  ]);
  assert.deepEqual(spawned[0].slice(0, 2), ["codex", "app-server"]);
  const start = seen.calls.find(([method]) => method === "thread/start")[1];
  assert.equal(start.sandbox, "workspace-write");
  assert.equal(start.approvalPolicy, "never");
  assert.equal(start.model, "gpt-x");
  assert.equal(seen.calls.find(([method]) => method === "turn/start")[1].effort, "low");
  assert.ok(events.some((event) => event.type === "conversation" && event.id === THREAD));
  assert.deepEqual(
    logs.map((line) => JSON.parse(line)).find((event) => event.item?.type === "command_execution"),
    {
      type: "item.completed",
      item: {
        id: "c1",
        type: "command_execution",
        status: "completed",
        command: "pwd",
        aggregated_output: "/p",
        exit_code: 0,
      },
    },
  );
});

test("Codex follow-ups reopen the conversation with the chosen permissions", async () => {
  for (const [permission, opened, wanted] of [
    ["plan", { sandbox: { type: "readOnly" } }, ["read-only", "never", undefined]],
    ["approve", { approvalPolicy: "on-request" }, ["workspace-write", "on-request", "auto_review"]],
    ["full", { sandbox: { type: "dangerFullAccess" } }, ["danger-full-access", "never", undefined]],
  ]) {
    const seen = { calls: [] };
    await adapterTurn(
      adapters.codex,
      {
        version: "stream-2",
        permission,
        continuing: true,
        session: { id: "s", agentSessionId: THREAD },
      },
      [() => codexServer(seen, { opened })],
    );
    const resume = seen.calls.find(([method]) => method === "thread/resume")[1];
    assert.equal(resume.threadId, THREAD);
    assert.deepEqual([resume.sandbox, resume.approvalPolicy, resume.approvalsReviewer], wanted);
  }
});

/** A CLI that prints JSON lines and exits. */
const printing = (events) => () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  setImmediate(() => {
    for (const event of events) child.stdout.write(`${JSON.stringify(event)}\n`);
    setImmediate(() => child.emit("close", 0, null));
  });
  return child;
};
const execPrints = printing([
  { type: "thread.started", thread_id: "exec-1" },
  { type: "item.completed", item: { type: "agent_message", text: "From exec" } },
]);

test("Codex never runs with other access than was chosen: a mismatch goes to codex exec", async () => {
  const seen = { calls: [] };
  const { end, spawned, texts } = await adapterTurn(
    adapters.codex,
    { version: "stream-3", permission: "plan" },
    [() => codexServer(seen, { opened: { sandbox: { type: "dangerFullAccess" } } }), execPrints],
  );
  assert.ok(!seen.calls.some(([method]) => method === "turn/start"), "no prompt was sent");
  assert.deepEqual(spawned[1].slice(0, 2), ["codex", "exec"]);
  assert.ok(spawned[1].includes("read-only"));
  assert.deepEqual(end, { ok: true });
  assert.equal(texts[0].text, "From exec");
});

test("a Codex without an app server is asked once, then runs codex exec directly", async () => {
  const gone = () => rpcChild(async () => "exit");
  const first = await adapterTurn(adapters.codex, { version: "stream-4" }, [gone, execPrints]);
  assert.deepEqual(
    first.spawned.map((args) => args[1]),
    ["app-server", "exec"],
  );
  const second = await adapterTurn(adapters.codex, { version: "stream-4" }, [execPrints]);
  assert.deepEqual(
    second.spawned.map((args) => args[1]),
    ["exec"],
  );
});

test("a Codex turn that fails says why, once", async () => {
  const { end, events } = await adapterTurn(adapters.codex, { version: "stream-5" }, [
    () =>
      codexServer(
        { calls: [] },
        {
          turn: (send) =>
            note(send, "turn/completed", {
              turn: { id: "t", status: "failed", error: { message: "usage limit reached" } },
            }),
        },
      ),
  ]);
  assert.deepEqual(end, { ok: false, reason: "reported" });
  assert.deepEqual(
    events.filter((event) => event.type === "error").map((event) => event.text),
    ["usage limit reached"],
  );
});

test("Codex approval requests are declined, never granted", async () => {
  const seen = { calls: [], answers: [] };
  await adapterTurn(adapters.codex, { version: "stream-6" }, [
    () =>
      codexServer(seen, {
        turn: async (send) => {
          send({ id: 900, method: "item/commandExecution/requestApproval", params: {} });
          send({ id: 901, method: "item/permissions/requestApproval", params: {} });
          await wait(20);
          note(send, "turn/completed", { turn: { id: "t", status: "completed" } });
        },
      }),
  ]);
  assert.deepEqual(seen.answers, [{ decision: "decline" }, { permissions: {}, scope: "turn" }]);
});

/** An OpenCode ACP server: modes are a config option, as OpenCode 2 reports them. */
const opencodeServer = (seen, { mode = "build" } = {}) =>
  rpcChild(async (method, params, send, result) => {
    if (!method) return void seen.answers.push(result);
    seen.calls.push([method, params]);
    if (method === "initialize")
      return { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {} } } };
    if (method === "session/new" || method === "session/resume")
      return {
        sessionId: "ses_1",
        configOptions: [
          {
            id: "mode",
            category: "mode",
            type: "select",
            currentValue: mode,
            options: [{ value: "build" }, { value: "plan" }],
          },
        ],
      };
    if (method !== "session/prompt") return {};
    const update = (body) =>
      send({ method: "session/update", params: { sessionId: "ses_1", update: body } });
    const say = (text) =>
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
    send({
      id: 900,
      method: "session/request_permission",
      params: {
        sessionId: "ses_1",
        toolCall: { toolCallId: "t", title: "rm -rf build", kind: "execute" },
        options: [
          { optionId: "once", kind: "allow_once", name: "Allow" },
          { optionId: "no", kind: "reject_once", name: "Reject" },
        ],
      },
    });
    await wait(20);
    say("One");
    await wait(90);
    say(" two");
    return { stopReason: "end_turn" };
  });

test("OpenCode 2 streams over ACP and still rejects permission requests out loud", async () => {
  const seen = { calls: [], answers: [] };
  const { end, texts, events, spawned } = await adapterTurn(
    adapters.opencode,
    { version: "2.0.1", permission: "build" },
    [() => opencodeServer(seen)],
  );
  assert.deepEqual(end, { ok: true });
  assert.deepEqual(spawned, [["opencode", "acp"]]);
  assert.equal(texts.map((event) => event.text).join(""), "One two");
  assert.ok(texts.length > 1);
  assert.deepEqual(seen.answers, [{ outcome: { outcome: "selected", optionId: "no" } }]);
  assert.match(events.find((event) => event.type === "notice").text, /rm -rf build.*rejected/);
  assert.ok(!seen.calls.some(([method]) => method === "session/set_config_option"));
});

test("OpenCode enters plan mode, and leaves it for build", async () => {
  for (const [permission, mode, wanted] of [
    ["plan", "build", ["plan"]],
    ["build", "plan", ["build"]],
    ["build", "my-agent", []],
  ]) {
    const seen = { calls: [], answers: [] };
    await adapterTurn(adapters.opencode, { version: "2.0.2", permission }, [
      () => opencodeServer(seen, { mode }),
    ]);
    assert.deepEqual(
      seen.calls
        .filter(([method]) => method === "session/set_config_option")
        .map(([, params]) => params.value),
      wanted,
      `${mode} for ${permission}`,
    );
  }
});

test("OpenCode runs the plain way when it is old, has other files, or ACP will not start", async () => {
  const runPrints = printing([{ type: "text", sessionID: "ses_2", part: { text: "From run" } }]);
  for (const [input, children] of [
    [{ version: "1.14.2" }, [runPrints]],
    [{ version: "2.0.3", attachments: [{ path: "/a.pdf", kind: "file" }] }, [runPrints]],
    [{ version: "2.0.4" }, [() => rpcChild(async () => "exit"), runPrints]],
  ]) {
    const { end, texts, spawned, events } = await adapterTurn(adapters.opencode, input, children);
    assert.deepEqual(end, { ok: true });
    assert.equal(texts[0].text, "From run");
    assert.equal(spawned.at(-1)[1], "run");
    assert.ok(!events.some((event) => event.type === "error"), "a fallback is not an error");
  }
});

test("every agent ADE offers streams", () => {
  assert.deepEqual(Object.keys(adapters), ["codex", "opencode", "pi", "claude"]);
});
