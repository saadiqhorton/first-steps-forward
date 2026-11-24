import test from "node:test";
import assert from "node:assert/strict";
import {
  currentActivity,
  decodeLogEvent,
  formatLogLine,
  formatSessionLogs,
  summarizeTool,
  truncate,
} from "./formatLogs.mjs";

test("truncate shortens long strings", () => {
  assert.equal(truncate("abc", 10), "abc");
  assert.equal(truncate("a".repeat(20), 10).endsWith("…"), true);
});

test("summarizeTool unwraps OpenCode status/input state", () => {
  const row = summarizeTool("read", {
    status: "completed",
    input: { filePath: "/home/dezignerdrugz/agentic/codeatlas/ai_investigator.py" },
  });
  assert.equal(row.title, "Used read");
  assert.match(row.body ?? "", /ai_investigator\.py/);
  assert.ok(!(row.body ?? "").includes("{"));
});

test("summarizeTool formats bash commands without JSON", () => {
  const row = summarizeTool("bash", {
    status: "completed",
    input: { command: "ls -la /home/dezignerdrugz/agentic/CodeAtlas" },
  });
  assert.equal(row.title, "Used bash");
  assert.match(row.body ?? "", /ls -la/);
  assert.ok(!(row.body ?? "").includes('"status"'));
});

test("summarizeTool names the connector and the tool for an MCP call", () => {
  const row = summarizeTool("mcp__parallel__web_search", { query: "insforge" });
  assert.equal(row.title, "Used parallel web search");
  assert.equal(row.body, "insforge");
  // A tool part still decides the step kind, so the pane picks the search icon.
  const call = formatLogLine(
    JSON.stringify({
      type: "tool_execution_start",
      toolCallId: "c1",
      toolName: "mcp__parallel__web_search",
      args: { query: "insforge" },
    }),
  );
  // A web search is an outside lookup, so it takes the existing fetch wording
  // ("Looked up", "looked something up") rather than project-search wording.
  assert.equal(call?.kind, "fetch");
  assert.equal(call?.title, "Used parallel web search");
  assert.equal(call?.body, "insforge");
  const parallel = summarizeTool("mcp__parallel__web_search", {
    objective: "Find what InsForge is",
    search_queries: ["InsForge", "InsForge backend"],
  });
  assert.equal(parallel.title, "Used parallel web search");
  assert.equal(parallel.body, "Find what InsForge is");
});

test("formatLogLine summarizes OpenCode tool_use JSON", () => {
  const line = JSON.stringify({
    type: "tool_use",
    tool: "bash",
    input: { command: "ls -la" },
  });
  const row = formatLogLine(line);
  assert.equal(row?.tone, "tool");
  assert.equal(row?.title, "Used bash");
  assert.match(row?.body ?? "", /ls -la/);
});

test("formatLogLine keeps steps and text; humanizes tool part.state", () => {
  assert.equal(formatLogLine(JSON.stringify({ type: "step_start" }))?.title, "Step started");
  assert.equal(
    formatLogLine(JSON.stringify({ type: "text", part: { text: "hello" } }))?.title,
    "Agent wrote a reply",
  );
  const line = JSON.stringify({
    type: "tool",
    part: {
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "/home/x/proj/src/app.ts" },
        output: "export function App() {}",
      },
    },
  });
  const row = formatLogLine(line);
  assert.equal(row?.title, "Used read");
  assert.match(row?.body ?? "", /app\.ts/);
  assert.ok(!(row?.body ?? "").includes("{"));
});

test("formatLogLine skips empty OpenCode text parts", () => {
  assert.equal(formatLogLine(JSON.stringify({ type: "text", part: { text: "" } })), null);
});

test("formatLogLine summarizes Codex command items", () => {
  const line = JSON.stringify({
    type: "item.completed",
    item: { type: "command_execution", command: "npm test" },
  });
  const row = formatLogLine(line);
  assert.equal(row?.tone, "tool");
  assert.match(row?.body ?? "", /npm test/);
});

test("formatLogLine keeps plain ADE system lines", () => {
  const row = formatLogLine("Stopped by user. Existing worktree changes are kept.");
  assert.equal(row?.tone, "system");
  assert.match(row?.title ?? "", /Stopped by user/);
});

test("currentActivity uses the latest step in plain language", () => {
  assert.equal(currentActivity([]), "Starting");
  assert.equal(
    currentActivity([
      JSON.stringify({
        type: "item.started",
        item: { type: "command_execution", command: "rg -n logout public/js/app.js" },
      }),
    ]),
    "Reading the project",
  );
  assert.equal(
    currentActivity([
      JSON.stringify({
        type: "item.completed",
        item: { type: "command_execution", command: "rg -n logout public/js/app.js" },
      }),
    ]),
    "Still working on the next step",
  );
  assert.equal(
    currentActivity([
      JSON.stringify({
        type: "item.started",
        item: {
          type: "file_change",
          changes: [
            { path: "/mnt/c/Users/admin/remote-hub/public/artifacts/logout-warning/index.html" },
          ],
        },
      }),
    ]),
    "Updating the workshop page",
  );
  assert.equal(
    currentActivity([
      JSON.stringify({ type: "item.completed", item: { type: "agent_message" } }),
      "Switching to your message.",
    ]),
    "Switching to your message",
  );
});

test("formatSessionLogs collapses repeated empty info titles", () => {
  const lines = [
    JSON.stringify({ type: "step_start" }),
    JSON.stringify({ type: "step_start" }),
    JSON.stringify({ type: "tool_use", tool: "read", input: { path: "a.ts" } }),
  ];
  const rows = formatSessionLogs(lines);
  assert.equal(rows.filter((r) => r.title === "Step started").length, 1);
  assert.equal(
    rows.some((r) => r.title === "Used read"),
    true,
  );
});

test("ACP plan and permission lines read as plain steps", () => {
  const plan = formatLogLine(
    JSON.stringify({
      type: "plan",
      entries: [
        { content: "Read the readme", status: "completed" },
        { content: "Tighten the intro", status: "in_progress" },
      ],
    }),
  );
  assert.equal(plan.title, "Updated its plan");
  assert.equal(plan.body, "Tighten the intro");
  const asked = formatLogLine(
    JSON.stringify({ type: "permission", decision: "asked", title: "npm test" }),
  );
  assert.equal(asked.tone, "system");
  assert.equal(asked.title, "Asked for your permission");
  assert.equal(asked.body, "npm test");
  const allowed = formatLogLine(
    JSON.stringify({ type: "permission", decision: "allowed", title: "npm test", option: "Allow" }),
  );
  assert.equal(allowed.title, "You allowed");
  assert.equal(allowed.body, "npm test — Allow");
  assert.equal(
    formatLogLine(JSON.stringify({ type: "permission", decision: "declined", title: "Edit a" }))
      .title,
    "Declined by ADE (Plan is read-only)",
  );
  assert.equal(
    currentActivity([JSON.stringify({ type: "permission", decision: "asked", title: "x" })]),
    "Waiting for your answer",
  );
  assert.equal(
    currentActivity([JSON.stringify({ type: "plan", entries: [] })]),
    "Planning the work",
  );
});

test("ACP tool lines reuse the shared tool summaries", () => {
  const line = formatLogLine(
    JSON.stringify({ type: "tool_call", toolName: "Bash", input: { command: "npm test" } }),
  );
  assert.equal(line.title, "Used Bash");
  assert.equal(line.body, "npm test");
  assert.equal(
    currentActivity([JSON.stringify({ type: "tool_call", toolName: "browser_click", input: {} })]),
    "Looking at the page",
  );
});

test("rows say what they are, for grouping", () => {
  const kind = (event) => formatLogLine(JSON.stringify(event))?.kind;
  assert.equal(kind({ type: "turn_start" }), "lifecycle");
  assert.equal(kind({ type: "agent_start" }), "lifecycle");
  assert.equal(kind({ type: "some_new_event" }), "lifecycle");
  assert.equal(kind({ type: "text", part: { text: "hi" } }), "message");
  assert.equal(kind({ type: "plan", entries: [] }), "plan");
  assert.equal(kind({ type: "permission", decision: "asked" }), "permission");
  assert.equal(kind({ type: "error", message: "boom" }), "error");
  assert.equal(kind({ type: "tool_result", toolName: "read" }), "result");
  assert.equal(kind({ type: "tool_result", toolName: "read", isError: true }), "error");
  const tool = (toolName) => kind({ type: "tool_call", toolName, input: {} });
  assert.equal(tool("Edit"), "edit");
  assert.equal(tool("write"), "edit");
  assert.equal(tool("Read"), "read");
  assert.equal(tool("Grep"), "search");
  assert.equal(tool("find"), "search");
  assert.equal(tool("Bash"), "run");
  assert.equal(tool("dev_server_start"), "preview");
  assert.equal(tool("computer_click"), "browse");
  assert.equal(tool("browser_snapshot"), "browse");
  assert.equal(tool("WebFetch"), "tool");
  assert.equal(formatLogLine("Context manifest: 3 candidate files")?.kind, "turn");
  assert.equal(
    formatLogLine("Stopped by user. Existing worktree changes are kept.")?.kind,
    "notice",
  );
  assert.equal(formatLogLine("$ npm test")?.kind, "notice");
  assert.equal(formatLogLine("Error: invalid api key")?.kind, "error");
  assert.equal(formatLogLine("Compiling...")?.kind, "output");
  assert.equal(formatLogLine("x".repeat(200))?.kind, "output");
});

test("Pi tool calls and results carry toolCallId", () => {
  const call = formatLogLine(
    JSON.stringify({
      type: "tool_execution_start",
      toolCallId: "call_1",
      toolName: "edit",
      args: { path: "src/a.ts" },
    }),
  );
  assert.equal(call?.callId, "call_1");
  assert.equal(call?.tool, "edit");
  assert.equal(call?.kind, "edit");
  assert.equal(call?.state, "running");
  const diff = "  1 a\n- 2 b\n+ 2 c\n+ 3 d";
  const result = formatLogLine(
    JSON.stringify({
      type: "tool_execution_end",
      toolCallId: "call_1",
      toolName: "edit",
      result: { content: [{ type: "text", text: "ok" }], details: { diff } },
      isError: false,
    }),
  );
  assert.equal(result?.callId, "call_1");
  assert.equal(result?.kind, "result");
  assert.equal(result?.additions, 2);
  assert.equal(result?.deletions, 1);
  const failed = formatLogLine(
    JSON.stringify({
      type: "tool_execution_end",
      toolCallId: "call_2",
      toolName: "read",
      result: { content: [{ type: "text", text: "ENOENT" }] },
      isError: true,
    }),
  );
  assert.equal(failed?.callId, "call_2");
  assert.equal(failed?.kind, "error");
  assert.equal(failed?.title, "read failed");
});

test("OpenCode and Codex ids are read; ACP lines have none", () => {
  const opencode = formatLogLine(
    JSON.stringify({
      type: "tool_use",
      part: {
        id: "prt_1",
        callID: "call_9",
        tool: "bash",
        state: { status: "completed", input: {} },
      },
    }),
  );
  assert.equal(opencode?.callId, "call_9");
  assert.equal(opencode?.state, "done");
  const partOnly = formatLogLine(
    JSON.stringify({ type: "tool", part: { id: "prt_2", tool: "read", state: { input: {} } } }),
  );
  assert.equal(partOnly?.callId, "prt_2");
  const codex = formatLogLine(
    JSON.stringify({
      type: "item.completed",
      item: { id: "item_4", type: "command_execution", command: "ls", status: "failed" },
    }),
  );
  assert.equal(codex?.callId, "item_4");
  assert.equal(codex?.state, "failed");
  const acp = formatLogLine(JSON.stringify({ type: "tool_call", toolName: "Bash", input: {} }));
  assert.equal(acp?.callId, undefined);
});

test("a diff cut by the log's length limit gives no counts", () => {
  const row = formatLogLine(
    JSON.stringify({
      type: "tool_execution_end",
      toolCallId: "c",
      toolName: "edit",
      result: { content: [], details: { diff: `+ 1 ${"x".repeat(500)}…[+900 chars]` } },
    }),
  );
  assert.equal(row?.additions, undefined);
  assert.equal(row?.deletions, undefined);
});

test("formatSessionLogs says which input line each row came from", () => {
  const rows = formatSessionLogs([
    "",
    JSON.stringify({ type: "message_update" }),
    JSON.stringify({ type: "tool_call", toolName: "Bash", input: { command: "ls" } }),
    "done",
  ]);
  assert.deepEqual(
    rows.map((row) => row.line),
    [2, 3],
  );
});

test("ADE's own lines are notices, and their tone is unchanged", () => {
  for (const line of [
    "agent switch: Pi → Codex (conversation not carried)",
    "Switching to your message.",
    "Follow-up queued until the current CLI turn exits.",
    "Sending the waiting message.",
  ]) {
    const row = formatLogLine(line);
    assert.equal(row?.kind, "notice", line);
    assert.equal(row?.tone, "output", line);
    assert.equal(row?.title, line, line);
  }
});

test("failures that Pi and Codex report are rows of their own", () => {
  const retry = formatLogLine(
    JSON.stringify({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      errorMessage: '{"error":{"code":400,"message":"Model is unavailable."}}',
    }),
  );
  assert.equal(retry?.kind, "notice");
  assert.equal(retry?.body, "Attempt 1 of 3 · Model is unavailable.");
  assert.equal(
    formatLogLine(JSON.stringify({ type: "auto_retry_end", success: true }))?.kind,
    "lifecycle",
  );
  const gaveUp = formatLogLine(
    JSON.stringify({ type: "auto_retry_end", success: false, finalError: "no" }),
  );
  assert.equal(gaveUp?.kind, "error");
  assert.equal(gaveUp?.body, "no");
  const failed = formatLogLine(
    JSON.stringify({ type: "turn.failed", error: { message: "Too long" } }),
  );
  assert.equal(failed?.kind, "error");
  assert.equal(failed?.title, "turn failed");
  assert.equal(failed?.body, "Too long");
  assert.equal(formatLogLine(JSON.stringify({ type: "compaction_end" }))?.kind, "lifecycle");
});

test("a Codex file change names its files", () => {
  const row = formatLogLine(
    JSON.stringify({
      type: "item.completed",
      item: { id: "f", type: "file_change", changes: { "src/a.ts": {}, "src/b.ts": {} } },
    }),
  );
  assert.equal(row?.title, "Updated files");
  assert.equal(row?.body, "2 files");
  assert.deepEqual(row?.files, ["src/a.ts", "src/b.ts"]);
});

const acpCall = (extra) =>
  formatLogLine(JSON.stringify({ type: "tool_call", toolName: "tool", input: {}, ...extra }));

test("ACP tool calls carry their id, and the agent's own kind decides what they are", () => {
  const row = acpCall({
    callId: "c1",
    toolName: "Bash",
    kind: "execute",
    input: { command: "ls" },
  });
  assert.equal(row?.callId, "c1");
  assert.equal(row?.tool, "Bash");
  assert.equal(row?.kind, "run");
  assert.equal(row?.title, "Used Bash");
  assert.equal(row?.body, "ls");
  const kinds = {
    read: "read",
    edit: "edit",
    delete: "edit",
    move: "edit",
    search: "search",
    execute: "run",
    fetch: "fetch",
    think: "tool",
    switch_mode: "lifecycle",
    other: "tool",
  };
  // The tool's name says nothing here ("tool"), so the kind is all there is to go on.
  for (const [kind, expected] of Object.entries(kinds))
    assert.equal(acpCall({ kind })?.kind, expected, kind);
  // No kind, or one ACP does not define, falls back to the name.
  assert.equal(acpCall({ toolName: "Grep" })?.kind, "search");
  assert.equal(acpCall({ toolName: "Grep", kind: "invented" })?.kind, "search");
  // The agent's kind wins over the name, except for ADE's own preview and browser tools.
  assert.equal(acpCall({ toolName: "Write", kind: "other" })?.kind, "edit");
  assert.equal(acpCall({ toolName: "Task", kind: "read" })?.kind, "read");
  assert.equal(acpCall({ toolName: "browser_click", kind: "other" })?.kind, "browse");
  assert.equal(acpCall({ toolName: "dev_server_start", kind: "execute" })?.kind, "preview");
});

test("an ACP call with no input to show falls back to the agent's own title", () => {
  const titled = acpCall({ toolName: "Fetch", kind: "fetch", title: "Fetch https://x.test/docs" });
  assert.equal(titled?.body, "Fetch https://x.test/docs");
  // An address is what a web request acted on.
  const web = acpCall({
    kind: "fetch",
    title: "Fetch https://x.test/docs",
    input: { url: "https://x.test/docs" },
  });
  assert.equal(web?.body, "https://x.test/docs");
  // A path or a command is better than a title.
  const read = acpCall({ kind: "read", title: "Read src/a.ts", input: { path: "/p/src/a.ts" } });
  assert.equal(read?.body, "src/a.ts");
  assert.equal(acpCall({})?.body, undefined);
});

test("ACP results carry their id and say how the step went", () => {
  const result = (extra) =>
    formatLogLine(
      JSON.stringify({
        type: "tool_result",
        callId: "c1",
        toolName: "Edit",
        kind: "edit",
        ...extra,
      }),
    );
  const done = result({ additions: 3, deletions: 2, files: ["/p/src/a.ts"] });
  assert.equal(done?.kind, "result");
  assert.equal(done?.callId, "c1");
  assert.equal(done?.additions, 3);
  assert.equal(done?.deletions, 2);
  assert.deepEqual(done?.files, ["src/a.ts"]);
  const read = result({ toolName: "Read", kind: "read", summary: "95 lines" });
  assert.equal(read?.summary, "95 lines");
  assert.equal(read?.body, "95 lines");
  const failed = result({ isError: true, summary: "Exit code 1: no such file" });
  assert.equal(failed?.kind, "error");
  assert.equal(failed?.title, "Edit failed");
  assert.equal(failed?.body, "Exit code 1: no such file");
  assert.equal(failed?.callId, "c1");
  // A mode switch is routine, even when the agent reports it as failed (ADE declined it).
  assert.equal(result({ kind: "switch_mode", isError: true })?.kind, "lifecycle");
  assert.equal(acpCall({ kind: "switch_mode" })?.kind, "lifecycle");
  // A result that amends an earlier one keeps its marker, and says nothing about what is live.
  const amend = result({ amends: true, additions: 5, deletions: 2 });
  assert.equal(amend?.amends, true);
  assert.equal(done?.amends, undefined);
  const line = (extra) => JSON.stringify({ type: "tool_result", toolName: "Edit", ...extra });
  assert.equal(
    currentActivity([
      JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "thinking" } }),
      line({ amends: true }),
    ]),
    "Thinking",
  );
  assert.equal(currentActivity([line({})]), "Still working on the next step");
});

test("the live phrase follows an ACP agent's kind, whatever the tool is called", () => {
  const phrase = (extra) =>
    currentActivity([JSON.stringify({ type: "tool_call", toolName: "tool", input: {}, ...extra })]);
  assert.equal(phrase({ kind: "read" }), "Reading the project");
  assert.equal(phrase({ kind: "search" }), "Reading the project");
  assert.equal(phrase({ kind: "edit", input: { path: "/p/src/a.ts" } }), "Updating a.ts");
  assert.equal(phrase({ kind: "delete" }), "Updating files");
  assert.equal(phrase({ kind: "execute", input: { command: "npm test" } }), "Running checks");
  assert.equal(
    phrase({ kind: "execute", input: { command: "git status" } }),
    "Looking at what changed",
  );
  assert.equal(phrase({ kind: "fetch", input: { url: "https://x.test" } }), "Looking something up");
  assert.equal(phrase({ kind: "think" }), "Working");
  assert.equal(phrase({}), "Working");
  // ADE's own tools keep their phrases, and a routine mode switch says nothing new.
  assert.equal(phrase({ toolName: "browser_click", kind: "other" }), "Looking at the page");
  assert.equal(
    currentActivity([
      JSON.stringify({ type: "tool_call", toolName: "Read", kind: "read", input: {} }),
      JSON.stringify({ type: "tool_call", toolName: "tool", kind: "switch_mode", input: {} }),
    ]),
    "Reading the project",
  );
  // Results and the call before them: between steps.
  assert.equal(
    currentActivity([
      JSON.stringify({ type: "tool_call", toolName: "Bash", kind: "execute", input: {} }),
      JSON.stringify({ type: "tool_result", toolName: "Bash", kind: "execute" }),
    ]),
    "Still working on the next step",
  );
});

test("decodeLogEvent says what an event means before it is worded", () => {
  assert.deepEqual(
    decodeLogEvent({
      type: "tool_execution_start",
      toolCallId: "c",
      toolName: "read",
      args: { path: "a" },
    }),
    { type: "tool_call", tool: "read", callId: "c", input: { path: "a" }, state: "running" },
  );
  assert.deepEqual(
    decodeLogEvent({
      type: "tool_call",
      callId: "c",
      toolName: "Bash",
      kind: "execute",
      title: "ls",
      input: {},
    }),
    {
      type: "tool_call",
      tool: "Bash",
      callId: "c",
      kind: "execute",
      input: {},
      describe: "ls",
      state: "running",
    },
  );
  assert.equal(decodeLogEvent({ type: "message_end" }), null);
  assert.deepEqual(decodeLogEvent({ type: "turn.started" }), {
    type: "lifecycle",
    title: "Turn started",
    live: "Starting",
  });
});
