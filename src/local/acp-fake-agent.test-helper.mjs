#!/usr/bin/env node
// Scripted ACP agent for acp.test.mjs and ade-local.acp.test.mjs (not shipped
// behaviour). Environment: FAKE_ACP_SCENARIO picks what session/prompt does;
// FAKE_ACP_LOG appends every message received, one JSON per line;
// FAKE_ACP_PROTOCOL, FAKE_ACP_LOAD=1, FAKE_ACP_RESUME=1 and FAKE_ACP_AUTH=1
// shape the handshake. Scenario "tools" runs a spread of tool calls the way real
// agents report them (see toolsScenario), "claude-writes" the order in which Claude Code reports
// an Edit or a Write, and "malformed" updates no agent should send. It also answers `--version` and `auth status`, so it
// can stand in for `claude` on PATH as well.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("0.99.0");
  process.exit(0);
}
if (args[0] === "--cli" || args[0] === "auth") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }));
  process.exit(0);
}

const env = process.env;
const scenario = env.FAKE_ACP_SCENARIO ?? "text";
// Which Claude Code the bridge was told to run (a line with no method).
if (env.FAKE_ACP_LOG)
  appendFileSync(
    env.FAKE_ACP_LOG,
    `${JSON.stringify({ startup: { CLAUDE_CODE_EXECUTABLE: env.CLAUDE_CODE_EXECUTABLE ?? null } })}\n`,
  );
const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const update = (sessionId, body) =>
  send({ method: "session/update", params: { sessionId, update: body } });
const chunk = (sessionId, text) =>
  update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
let nextId = 1000;
const waiting = new Map();
// The helper is spawned detached, so if the test runner dies mid-request the
// reply never comes and this helper would wait forever. Give up then: when
// re-parented, or after a minute with no reply.
const parent = process.ppid;
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    send({ id, method, params });
    const started = Date.now();
    const watch = setInterval(() => {
      if (!waiting.has(id)) {
        clearInterval(watch);
        return;
      }
      if (process.ppid !== parent || Date.now() - started > 60_000) process.exit(3);
    }, 1000);
  });
const modes = (currentModeId) => ({
  currentModeId,
  availableModes: [
    { id: "default", name: "Default" },
    { id: "acceptEdits", name: "Accept edits" },
    { id: "plan", name: "Plan" },
  ],
});
const models = (currentValue) => [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue,
    options: [
      { value: "default", name: "Default" },
      { value: "opus", name: "Opus", description: "Most capable" },
    ],
  },
];

/**
 * Tool calls the way Claude Code reports them: a call, refinements, then a status
 * with the result as content (code-fenced text, diffs). Each step's id says what it covers.
 */
function toolsScenario(sessionId) {
  const call = (body) => update(sessionId, { sessionUpdate: "tool_call", ...body });
  const change = (body) => update(sessionId, { sessionUpdate: "tool_call_update", ...body });
  const text = (value) => ({ type: "content", content: { type: "text", text: value } });
  // A file read: the call names no input yet, a refinement adds it, the result is the file.
  call({ toolCallId: "read1", title: "Read File", kind: "read", status: "pending", rawInput: {} });
  change({
    toolCallId: "read1",
    title: "Read src/a.ts",
    kind: "read",
    rawInput: { file_path: "/p/src/a.ts" },
    locations: [{ path: "/p/src/a.ts", line: 1 }],
  });
  change({ toolCallId: "read1", status: "in_progress" });
  const file = Array.from({ length: 95 }, (_, i) => `${i + 1}\tconst secret${i} = "TOP-SECRET";`);
  change({
    toolCallId: "read1",
    status: "completed",
    content: [text(["```", ...file, "```"].join("\n"))],
  });
  // The same result twice is still one result.
  change({ toolCallId: "read1", status: "completed" });
  // An edit with a diff: two lines change among unchanged context.
  call({
    toolCallId: "edit1",
    title: "Edit src/a.ts",
    kind: "edit",
    status: "pending",
    rawInput: { file_path: "/p/src/a.ts", old_string: "OLD-SECRET", new_string: "NEW-SECRET" },
    content: [
      {
        type: "diff",
        path: "/p/src/a.ts",
        oldText: "keep 1\nold 2\nkeep 3\nold 4\nkeep 5",
        newText: "keep 1\nnew 2\nkeep 3\nnew 4\nkeep 5\nnew 6",
      },
    ],
    locations: [{ path: "/p/src/a.ts" }],
  });
  change({ toolCallId: "edit1", status: "completed" });
  // A new file arrives as one diff with no old text; the bridge may send the call finished.
  call({
    toolCallId: "write1",
    title: "Write src/new.ts",
    kind: "edit",
    status: "completed",
    content: [{ type: "diff", path: "/p/src/new.ts", oldText: null, newText: "one\ntwo\nthree\n" }],
  });
  // A command: its title is the command, the result is code-fenced output.
  call({
    toolCallId: "run1",
    title: "Terminal",
    kind: "execute",
    status: "pending",
    rawInput: {},
  });
  change({
    toolCallId: "run1",
    title: "npm test",
    kind: "execute",
    rawInput: { command: "npm test" },
  });
  change({
    toolCallId: "run1",
    status: "completed",
    content: [text("```console\n> test\nTests 12 passed\n```")],
  });
  // A command that fails: Claude Code's error text opens with the exit code.
  call({
    toolCallId: "run2",
    title: "cat missing.txt",
    kind: "execute",
    status: "pending",
    rawInput: { command: "cat missing.txt" },
  });
  change({
    toolCallId: "run2",
    status: "failed",
    content: [text("```\nExit code 1\ncat: missing.txt: No such file or directory\n```")],
  });
  // An update for a call this turn never announced.
  change({ toolCallId: "ghost1", status: "failed", content: [text("Tool use aborted")] });
  // A search, and a tool that reports itself as a mode switch.
  call({
    toolCallId: "find1",
    title: 'grep -n "TODO" src',
    kind: "search",
    rawInput: { pattern: "TODO" },
  });
  change({ toolCallId: "find1", status: "completed", content: [text("src/a.ts:3: TODO")] });
  call({ toolCallId: "mode1", title: "Ready to code?", kind: "switch_mode", status: "pending" });
  change({ toolCallId: "mode1", status: "failed" });
}

/**
 * Edits and writes the way claude-agent-acp 0.99 reports them to a client with no diff-patch
 * support. The tool call shows the input as a diff, and a Write always as a new file (no old
 * text). The PostToolUse report carries the real diff (its structuredPatch as hunks with
 * context) and normally comes after the completed status; in "hook first" it comes before.
 */
function claudeWritesScenario(sessionId) {
  const call = (body) =>
    update(sessionId, {
      sessionUpdate: "tool_call",
      status: "pending",
      kind: "edit",
      _meta: { claudeCode: { toolName: body.name } },
      ...body,
    });
  const change = (body) => update(sessionId, { sessionUpdate: "tool_call_update", ...body });
  const diff = (path, oldText, newText) => ({ type: "diff", path, oldText, newText });
  const report = (toolCallId, name, toolResponse, content) =>
    change({
      toolCallId,
      _meta: { claudeCode: { toolName: name, toolResponse } },
      ...(content ? { content, locations: [{ path: toolResponse.filePath }] } : {}),
    });
  const rewritten = Array.from({ length: 40 }, (_, i) => `line ${i}`);
  const rewrite = rewritten.map((line, i) => (i === 10 ? "changed 10" : line));
  // A Write over an existing file: the call says "new file" (40 additions). The completed
  // status comes first and the report, a one-line change among context, second.
  call({
    toolCallId: "over1",
    name: "Write",
    title: "Write src/a.ts",
    rawInput: { file_path: "/p/src/a.ts" },
    content: [diff("/p/src/a.ts", null, rewrite.join("\n"))],
  });
  change({ toolCallId: "over1", status: "completed" });
  report(
    "over1",
    "Write",
    { type: "update", filePath: "/p/src/a.ts", structuredPatch: [{ newStart: 8 }] },
    [
      diff(
        "/p/src/a.ts",
        "line 8\nline 9\nline 10\nline 11\nline 12",
        "line 8\nline 9\nchanged 10\nline 11\nline 12",
      ),
    ],
  );
  // The same, with the report first.
  call({
    toolCallId: "over2",
    name: "Write",
    title: "Write src/b.ts",
    rawInput: { file_path: "/p/src/b.ts" },
    content: [diff("/p/src/b.ts", null, rewrite.join("\n"))],
  });
  report(
    "over2",
    "Write",
    { type: "update", filePath: "/p/src/b.ts", structuredPatch: [{ newStart: 9 }] },
    [diff("/p/src/b.ts", "line 9\nline 10\nline 11", "line 9\nchanged 10\nextra\nline 11")],
  );
  change({ toolCallId: "over2", status: "completed" });
  // A new file, reported after the result: nothing to correct, the report has no diff.
  call({
    toolCallId: "new1",
    name: "Write",
    title: "Write src/new.ts",
    rawInput: { file_path: "/p/src/new.ts" },
    content: [diff("/p/src/new.ts", null, "one\ntwo\nthree\n")],
  });
  change({ toolCallId: "new1", status: "completed" });
  report("new1", "Write", { type: "create", filePath: "/p/src/new.ts", structuredPatch: [] });
  // A new file, reported before the result.
  call({
    toolCallId: "new2",
    name: "Write",
    title: "Write src/new2.ts",
    rawInput: { file_path: "/p/src/new2.ts" },
    content: [diff("/p/src/new2.ts", null, "one\ntwo\n")],
  });
  report("new2", "Write", { type: "create", filePath: "/p/src/new2.ts", structuredPatch: [] });
  change({ toolCallId: "new2", status: "completed" });
  // A Write whose report never comes: its counts are unknown, so none are claimed.
  call({
    toolCallId: "lost1",
    name: "Write",
    title: "Write src/lost.ts",
    rawInput: { file_path: "/p/src/lost.ts" },
    content: [diff("/p/src/lost.ts", null, "a\nb\nc")],
  });
  change({ toolCallId: "lost1", status: "completed" });
  // An Edit shows only its snippet. One site: the snippet is right and the report agrees.
  call({
    toolCallId: "edit1",
    name: "Edit",
    title: "Edit src/c.ts",
    rawInput: { file_path: "/p/src/c.ts", old_string: "a", new_string: "b" },
    content: [diff("/p/src/c.ts", "a", "b")],
  });
  change({ toolCallId: "edit1", status: "completed" });
  report("edit1", "Edit", { filePath: "/p/src/c.ts", structuredPatch: [{ newStart: 1 }] }, [
    diff("/p/src/c.ts", "x\na\ny", "x\nb\ny"),
  ]);
  // replace_all: the snippet shows one site and the report all three.
  call({
    toolCallId: "edit2",
    name: "Edit",
    title: "Edit src/d.ts",
    rawInput: { file_path: "/p/src/d.ts", old_string: "a", new_string: "b", replace_all: true },
    content: [diff("/p/src/d.ts", "a", "b")],
  });
  change({ toolCallId: "edit2", status: "completed" });
  report(
    "edit2",
    "Edit",
    {
      filePath: "/p/src/d.ts",
      structuredPatch: [{ newStart: 1 }, { newStart: 20 }, { newStart: 40 }],
    },
    [
      diff("/p/src/d.ts", "x\na\ny", "x\nb\ny"),
      diff("/p/src/d.ts", "x\na\ny", "x\nb\ny"),
      diff("/p/src/d.ts", "x\na\ny", "x\nb\ny"),
    ],
  );
  // A progress beat after the result is not the report.
  change({
    toolCallId: "edit2",
    status: "in_progress",
    _meta: { claudeCode: { toolResponse: { elapsedTimeSeconds: 2 } } },
  });
}

/**
 * Updates no agent should send: wrong types, nulls, missing ids, huge strings, a command typed
 * out one character at a time. The turn has to come through, and then a normal call is logged.
 */
function malformedScenario(sessionId) {
  const huge = "x".repeat(200_000);
  // An update at the wrong level, which `update()` would not write.
  const raw = (params) =>
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params })}\n`,
    );
  const odd = (body) => update(sessionId, body);
  raw({ sessionId });
  raw({ sessionId, update: null });
  raw({ sessionId, update: "tool_call" });
  raw({ sessionId, update: [] });
  raw(null);
  for (const toolCallId of [42, null, {}, [], true, ""])
    odd({ sessionUpdate: "tool_call", toolCallId, title: 5, kind: {}, status: "completed" });
  const contents = [
    null,
    "text",
    5,
    {},
    [null, 5, "x", [], {}],
    [{ type: "content", content: null }],
    [{ type: "content", content: { type: "text", text: 123 } }],
    [{ type: "content", content: { type: "text", text: { not: "a string" } } }],
    [{ type: "diff" }],
    [{ type: "diff", path: 7, oldText: {}, newText: [] }],
    [{ type: "diff", path: huge, oldText: huge, newText: `${huge}\nmore` }],
    [{ type: "terminal", terminalId: 9 }],
    [{ type: "content", content: { type: "text", text: huge } }],
  ];
  const statuses = ["completed", "failed", "pending", 3, null, {}];
  let n = 0;
  for (const content of contents)
    for (const kind of ["read", "edit", "execute", {}]) {
      const toolCallId = `odd${n++}`;
      odd({
        sessionUpdate: "tool_call",
        toolCallId,
        title: n % 5 ? 5 : huge,
        kind,
        status: "pending",
        rawInput: n % 3 ? [1, "x"] : "text",
        content,
        locations: "abc",
        _meta: "meta",
        _meta2: huge,
      });
      odd({
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: statuses[n % statuses.length],
        rawOutput: n % 7 ? [null] : [huge],
        content,
        locations: [null, { path: 5 }],
        _meta: { claudeCode: "x", terminal_exit: n % 2 ? 5 : { exit_code: "no" } },
      });
    }
  for (const status of ["completed", "failed"])
    for (const rawOutput of [
      null,
      5,
      "text",
      [],
      { error: 5 },
      { message: "m" },
      { exit_code: "x" },
    ])
      odd({
        sessionUpdate: "tool_call",
        toolCallId: `raw-${status}-${n++}`,
        kind: "execute",
        status,
        rawOutput,
        rawInput: { command: 5, cmd: huge },
      });
  odd({ sessionUpdate: "plan", entries: "oops" });
  odd({ sessionUpdate: "plan", entries: { length: 3 } });
  odd({ sessionUpdate: "plan", entries: [null, 5, { content: huge, status: {} }] });
  odd({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: 5 } });
  odd({ sessionUpdate: "agent_message_chunk", content: null });
  // Many updates with no id at all.
  for (let i = 0; i < 300; i++) odd({ sessionUpdate: "tool_call_update", status: "completed" });
  // A command typed out one character at a time.
  odd({
    sessionUpdate: "tool_call",
    toolCallId: "typed",
    kind: "execute",
    status: "pending",
    title: "Terminal",
  });
  for (let i = 1; i <= 250; i++)
    odd({
      sessionUpdate: "tool_call_update",
      toolCallId: "typed",
      rawInput: { command: "npm run build".padEnd(i, "!") },
    });
  odd({
    sessionUpdate: "tool_call_update",
    toolCallId: "typed",
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: "built" } }],
  });
  // And after all that, a normal call.
  odd({
    sessionUpdate: "tool_call",
    toolCallId: "fine",
    kind: "read",
    title: "Read src/a.ts",
    status: "pending",
    rawInput: { file_path: "/p/src/a.ts" },
  });
  odd({
    sessionUpdate: "tool_call_update",
    toolCallId: "fine",
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: "a\nb" } }],
  });
  chunk(sessionId, "Still here.");
}

async function prompt(sessionId, params) {
  switch (scenario) {
    case "claude-writes":
      claudeWritesScenario(sessionId);
      chunk(sessionId, "Done.");
      return { stopReason: "end_turn" };
    case "malformed":
      malformedScenario(sessionId);
      return { stopReason: "end_turn" };
    case "tools":
      toolsScenario(sessionId);
      chunk(sessionId, "All done.");
      return { stopReason: "end_turn" };
    case "text":
      chunk(sessionId, "Hel");
      chunk(sessionId, "lo");
      update(sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "Read a.ts",
        kind: "read",
        status: "pending",
        rawInput: { file_path: "/p/a.ts", content: "x".repeat(5000) },
        _meta: { claudeCode: { toolName: "Read" } },
      });
      update(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
      });
      update(sessionId, {
        sessionUpdate: "plan",
        entries: [{ content: "Check the readme", priority: "high", status: "in_progress" }],
      });
      chunk("another-session", "LEAK");
      chunk(sessionId, "Done.");
      return { stopReason: "end_turn" };
    case "permission":
    case "edit-permission": {
      const shell = scenario === "permission";
      const answer = await ask("session/request_permission", {
        sessionId,
        toolCall: {
          toolCallId: "t2",
          title: shell ? "rm -rf build" : "Edit a.ts",
          kind: shell ? "execute" : "edit",
          rawInput: shell ? { command: "rm -rf build" } : { file_path: "/p/a.ts" },
        },
        options: [
          { optionId: "a1", name: "Allow", kind: "allow_once" },
          { optionId: "a2", name: "Always allow", kind: "allow_always" },
          { optionId: "r1", name: "Reject", kind: "reject_once" },
        ],
      });
      chunk(sessionId, `answer:${JSON.stringify(answer.result?.outcome ?? answer.error)}`);
      return { stopReason: "end_turn" };
    }
    case "fs": {
      const answer = await ask("fs/read_text_file", { sessionId, path: "/etc/hostname" });
      chunk(sessionId, `fs:${answer.error?.code}`);
      return { stopReason: "end_turn" };
    }
    case "blocks":
      chunk(sessionId, `blocks:${params.prompt.map((block) => block.type).join(",")}`);
      return { stopReason: "end_turn" };
    case "exit-plan": {
      // Like Claude Code: the plan rides in ExitPlanMode's input, and a
      // rejection interrupts the turn, which then ends "cancelled".
      chunk(sessionId, "I have a plan.");
      const answer = await ask("session/request_permission", {
        sessionId,
        toolCall: {
          toolCallId: "t3",
          title: "Ready to code?",
          kind: "switch_mode",
          rawInput: { plan: "1. Add hello.txt\n2. Write hi" },
        },
        options: [
          { optionId: "acceptEdits", name: "Yes, and auto-accept edits", kind: "allow_always" },
          { optionId: "default", name: "Yes, and manually approve edits", kind: "allow_once" },
          { optionId: "reject", name: "No, keep planning", kind: "reject_once" },
        ],
      });
      return {
        stopReason: answer.result?.outcome?.optionId === "reject" ? "cancelled" : "end_turn",
      };
    }
    case "refusal":
      return { stopReason: "refusal" };
    case "crash":
      process.exit(3);
      break;
    default:
      return { stopReason: "end_turn" };
  }
}

async function handle(message) {
  if (env.FAKE_ACP_LOG) appendFileSync(env.FAKE_ACP_LOG, `${JSON.stringify(message)}\n`);
  if (message.method === undefined) {
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
    return;
  }
  const { id, method, params } = message;
  const reply = (result) => send({ id, result });
  const fail = (code, text) => send({ id, error: { code, message: text } });
  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: Number(env.FAKE_ACP_PROTOCOL ?? 1),
        agentCapabilities: {
          loadSession: env.FAKE_ACP_LOAD === "1",
          promptCapabilities: { image: true },
          sessionCapabilities: env.FAKE_ACP_RESUME === "1" ? { resume: {} } : {},
        },
        authMethods: [],
      });
    case "session/new":
      if (env.FAKE_ACP_AUTH === "1") return fail(-32000, "Authentication required");
      return reply({
        sessionId: "s-new",
        modes: modes("default"),
        configOptions: models("default"),
      });
    case "session/resume":
      if (params.sessionId === "gone") return fail(-32002, "Resource not found");
      return reply({ modes: modes("acceptEdits"), configOptions: models("opus") });
    case "session/load":
      update(params.sessionId, {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "OLD PROMPT" },
      });
      chunk(params.sessionId, "OLD REPLY");
      return reply({ modes: modes("default"), configOptions: models("default") });
    case "session/set_mode":
    case "session/set_config_option":
      return reply({});
    case "session/prompt":
      return reply(await prompt(params.sessionId, params));
    default:
      return fail(-32601, `Method not found: ${method}`);
  }
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (line.trim()) void handle(JSON.parse(line));
});
lines.on("close", () => process.exit(0));
