import test from "node:test";
import assert from "node:assert/strict";
import { formatSessionLogs } from "./formatLogs.mjs";
import { groupActivityTurns, summarizeTurn, trimmedFromFront } from "./activityTurns.mjs";

const MANIFEST = "Context manifest: 12 candidate files, tools: read, edit";
const start = (id, toolName, args = {}) =>
  JSON.stringify({ type: "tool_execution_start", toolCallId: id, toolName, args });
const end = (id, toolName, text, { isError = false, details = {} } = {}) =>
  JSON.stringify({
    type: "tool_execution_end",
    toolCallId: id,
    toolName,
    result: { content: [{ type: "text", text }], details },
    isError,
  });
const groups = (lines, offset) => groupActivityTurns(formatSessionLogs(lines), offset);
const only = (lines) => {
  const result = groups(lines);
  assert.equal(result.length, 1);
  return result[0];
};

test("results are matched to their call by id, even when calls overlap and results swap", () => {
  // The shape of the real log: a find and a read overlap, and the read result comes first.
  const turn = only([
    start("a", "find", { pattern: ".env*" }),
    start("b", "read", { path: "src/api.ts" }),
    end("b", "read", "ENOENT: no such file", { isError: true }),
    end("a", "find", ".env.example"),
  ]);
  assert.deepEqual(
    turn.items.map(({ label, detail, status }) => [label, detail, status]),
    [
      ["Looked for", ".env*", "done"],
      ["Couldn’t read", "src/api.ts", "failed"],
    ],
  );
  assert.equal(turn.items[1].reason, "ENOENT: no such file");
  assert.equal(turn.failed, 1);
});

test("a result with no matching call stays visible as its own row", () => {
  const turn = only([
    end("gone", "read", "file contents"),
    // Lines from before ADE logged ACP ids: the one waiting Bash call takes the Bash result.
    JSON.stringify({ type: "tool_call", toolName: "Bash", input: { command: "npm test" } }),
    JSON.stringify({ type: "tool_result", toolName: "Bash" }),
    // No Read call is waiting, so this result has nowhere to go.
    JSON.stringify({ type: "tool_result", toolName: "Read", isError: true }),
  ]);
  assert.deepEqual(
    turn.items.map(({ kind, label, detail, status }) => [kind, label, detail, status]),
    [
      ["result", "Tool finished", "file contents", "done"],
      ["run", "Ran", "npm test", "done"],
      ["error", "Read failed", undefined, "failed"],
    ],
  );
  assert.equal(turn.failed, 1);
});

test("an edit shows plain +N/−N counts from its diff", () => {
  const diff = "     ...\n  11   a\n- 12 old\n+ 12 new\n+ 13 extra\n  14   b";
  const turn = only([
    start("e", "edit", { path: "src/pages/Settings.tsx" }),
    end("e", "edit", "Successfully replaced 1 block(s).", { details: { diff } }),
  ]);
  const [edit] = turn.items;
  assert.equal(edit.label, "Edited");
  assert.equal(edit.detail, "pages/Settings.tsx");
  assert.equal(edit.additions, 2);
  assert.equal(edit.deletions, 1);
  assert.equal(turn.items.length, 1);
});

test("a diff cut by the log limit gives no counts rather than wrong ones", () => {
  const diff = `+ 1 ${"x".repeat(500)}…[+2400 chars]`;
  const turn = only([
    start("e", "edit", { path: "a.ts" }),
    end("e", "edit", "ok", { details: { diff } }),
  ]);
  assert.equal(turn.items[0].additions, undefined);
  assert.equal(turn.items[0].deletions, undefined);
});

test("a call is pending until its result, unless it has no id to be matched by", () => {
  const turn = only([
    start("slow", "bash", { command: "npm test" }),
    JSON.stringify({ type: "tool_call", toolName: "Read", input: { path: "a.ts" } }),
  ]);
  assert.deepEqual(
    turn.items.map(({ label, activeLabel, status }) => [label, activeLabel, status]),
    [
      ["Ran", "Running", "pending"],
      ["Read", "Reading", "done"],
    ],
  );
});

test("plain verbs for each kind of tool", () => {
  const turn = only([
    start("1", "grep", { pattern: "TODO" }),
    start("2", "ls", { path: "src" }),
    start("3", "dev_server_status"),
    start("4", "computer_click"),
    start("5", "mystery_tool", { path: "x/y.ts" }),
    start("6", "mystery"),
  ]);
  assert.deepEqual(
    turn.items.map(({ label, detail }) => [label, detail]),
    [
      ["Searched for", "TODO"],
      ["Looked for", "src"],
      ["Checked the preview", undefined],
      ["Looked at the page", undefined],
      ["Used a tool", "x/y.ts"],
      ["Used a tool", "mystery"],
    ],
  );
});

test("routine events are hidden, and Pi's own turn markers do not split a turn", () => {
  const turn = only([
    JSON.stringify({ type: "agent_start" }),
    JSON.stringify({ type: "turn_start" }),
    JSON.stringify({ type: "auto_retry_end", success: true }),
    start("a", "read", { path: "a.ts" }),
    end("a", "read", "x"),
    JSON.stringify({ type: "turn_end" }),
    JSON.stringify({ type: "turn_start" }),
    start("b", "read", { path: "b.ts" }),
    end("b", "read", "y"),
    JSON.stringify({ type: "turn_end" }),
  ]);
  assert.deepEqual(
    turn.items.map((item) => item.detail),
    ["a.ts", "b.ts"],
  );
});

test("a turn starts at each context manifest; earlier rows form their own group", () => {
  const result = groups([
    start("0", "read", { path: "old.ts" }),
    MANIFEST,
    start("1", "edit", { path: "a.ts" }),
    MANIFEST,
    start("2", "bash", { command: "npm test" }),
  ]);
  assert.deepEqual(
    result.map((group) => [group.id, group.items.map((item) => item.detail)]),
    [
      ["turn-head", ["old.ts"]],
      ["turn-1", ["a.ts"]],
      ["turn-3", ["npm test"]],
    ],
  );
});

test("a log that opens with a manifest has no empty head group; none at all is one group", () => {
  assert.equal(groups([MANIFEST, start("1", "read", { path: "a.ts" })]).length, 1);
  assert.equal(groups([MANIFEST, MANIFEST]).length, 2);
  const plain = only(["Compiling...", "Done in 3s"]);
  assert.deepEqual(
    plain.items.map(({ kind, label }) => [kind, label]),
    [
      ["output", "Compiling..."],
      ["output", "Done in 3s"],
    ],
  );
  assert.equal(plain.summary.text, "2 lines of CLI output");
  assert.deepEqual(
    groups([]).map((group) => group.items),
    [[]],
  );
});

test("ids stay put while ADE drops lines from the front of the log", () => {
  const log = [MANIFEST, start("1", "read", { path: "a.ts" }), end("1", "read", "x")];
  const before = groups(log);
  const after = groups([...log.slice(1), start("2", "read", { path: "b.ts" })], 1);
  assert.equal(before[0].id, "turn-0");
  assert.equal(before[0].items[0].id, "1");
  // The manifest is gone, so the rest becomes the head group; the read keeps its id.
  assert.equal(after[0].id, "turn-head");
  assert.equal(after[0].items[0].id, "1");
  assert.equal(after[0].items[1].id, "3");
});

test("trimmedFromFront counts the lines dropped between two snapshots", () => {
  const lines = ["a", "b", "c", "d"];
  assert.equal(trimmedFromFront([], lines), 0);
  assert.equal(trimmedFromFront(lines, lines), 0);
  assert.equal(trimmedFromFront(lines, [...lines, "e"]), 0);
  assert.equal(trimmedFromFront(lines, ["b", "c", "d", "e"]), 1);
  assert.equal(trimmedFromFront(lines, ["d", "e", "f"]), 3);
  assert.equal(trimmedFromFront(lines, ["x", "y"]), 4);
  assert.equal(trimmedFromFront(lines, []), 4);
});

test("the summary is one plain line, as the workshop's option 2 shows it", () => {
  const edited = only([
    start("1", "edit", { path: "a.ts" }),
    end("1", "edit", "ok"),
    start("2", "bash", { command: "npm run typecheck" }),
    end("2", "bash", "ok"),
    start("3", "bash", { command: "npm test" }),
    end("3", "bash", "ok"),
  ]);
  assert.equal(edited.summary.text, "Edited 1 file · ran 2 commands");

  const failed = only([
    start("1", "read", { path: ".env" }),
    end("1", "read", "ENOENT", { isError: true }),
    start("2", "edit", { path: "a.ts" }),
    end("2", "edit", "ok"),
  ]);
  assert.equal(failed.summary.text, "1 step failed · edited 1 file");
  assert.deepEqual(failed.summary.parts[0], { text: "1 step failed", bad: true });

  assert.equal(
    only([
      JSON.stringify({ type: "text", part: { text: "All done." } }),
      JSON.stringify({ type: "plan", entries: [] }),
    ]).summary.text,
    "Wrote a reply",
  );
});

test("summaries count files once, cap at three parts and name every kind of step", () => {
  const item = (kind, detail, status = "done", id = detail) => ({
    id,
    kind,
    label: kind,
    status,
    ...(detail ? { detail } : {}),
  });
  assert.equal(
    summarizeTurn([item("edit", "a.ts"), item("edit", "a.ts", "done", "x"), item("edit", "b.ts")])
      .text,
    "Edited 2 files",
  );
  assert.equal(
    summarizeTurn([
      item("edit", "a.ts"),
      item("run", "npm test", "done", "r"),
      item("read", "a.ts", "done", "q"),
      item("search", "x", "done", "s"),
    ]).text,
    "Edited 1 file · ran 1 command · read 1 file",
  );
  assert.equal(
    summarizeTurn([
      item("search", "x"),
      item("preview", undefined, "done", "p"),
      item("browse", undefined, "done", "b"),
      item("tool", "mystery", "done", "t"),
    ]).text,
    "Searched the project · checked the preview · looked at the page",
  );
  assert.equal(summarizeTurn([item("tool", "mystery")]).text, "Used 1 tool");
  assert.equal(summarizeTurn([]).text, "No steps yet");
  assert.equal(
    summarizeTurn([item("edit", "a.ts", "failed"), item("error", undefined, "failed", "e")]).text,
    "2 steps failed",
  );
});

test("a failed step, a failed result or a CLI error marks its turn", () => {
  assert.equal(only([start("1", "read", { path: "a.ts" }), end("1", "read", "x")]).failed, 0);
  assert.equal(only([JSON.stringify({ type: "error", message: "Rate limited" })]).failed, 1);
  assert.equal(only(["Error: invalid api key"]).failed, 1);
});

test("OpenCode tool_use carries its own state and call id; a repeat joins the first", () => {
  const tool = (status) =>
    JSON.stringify({
      type: "tool_use",
      part: {
        type: "tool",
        callID: "oc1",
        tool: "bash",
        state: { status, input: { command: "ls" } },
      },
    });
  const turn = only([tool("running"), tool("completed")]);
  assert.deepEqual(
    turn.items.map(({ label, status }) => [label, status]),
    [["Ran", "done"]],
  );
  const failed = only([tool("error")]);
  assert.equal(failed.items[0].status, "failed");
  assert.equal(failed.items[0].label, "Command failed");
});

test("Codex items carry their id; a failed command marks the turn", () => {
  const turn = only([
    JSON.stringify({ type: "item.started", item: { id: "item_1", type: "command_execution" } }),
    JSON.stringify({
      type: "item.completed",
      item: { id: "item_1", type: "command_execution", command: "npm test", status: "failed" },
    }),
    JSON.stringify({
      type: "item.completed",
      item: { id: "item_2", type: "file_change", changes: [{ path: "a.ts" }] },
    }),
    JSON.stringify({ type: "item.completed", item: { id: "item_3", type: "reasoning" } }),
  ]);
  assert.deepEqual(
    turn.items.map(({ label, detail, status }) => [label, detail, status]),
    [
      ["Command failed", "npm test", "failed"],
      ["Edited", "a.ts", "done"],
    ],
  );
});

test("permission rows read as plain steps", () => {
  const permission = (decision, extra = {}) =>
    JSON.stringify({ type: "permission", decision, title: "npm test", ...extra });
  const turn = only([
    permission("asked"),
    permission("allowed", { option: "Allow once" }),
    permission("rejected"),
    permission("declined"),
  ]);
  assert.deepEqual(
    turn.items.map(({ label, detail, decision }) => [label, detail, decision]),
    [
      ["Asked permission", "npm test", "asked"],
      ["You allowed", "npm test — Allow once", "allowed"],
      ["You declined", "npm test", "rejected"],
      ["Declined (Plan is read-only)", "npm test", "declined"],
    ],
  );
});

test("an id used twice gives two steps; a result goes to the first call still waiting", () => {
  const reused = only([
    start("a", "read", { path: "x.ts" }),
    end("a", "read", "ok"),
    start("a", "read", { path: "y.ts" }),
    end("a", "read", "ENOENT", { isError: true }),
  ]);
  assert.deepEqual(
    reused.items.map(({ label, detail, status }) => [label, detail, status]),
    [
      ["Read", "x.ts", "done"],
      ["Couldn’t read", "y.ts", "failed"],
    ],
  );
  // Two calls that share an id while both are running are told apart by the tool's name.
  const overlap = only([
    start("a", "read", { path: "x.ts" }),
    start("a", "bash", { command: "ls" }),
    end("a", "bash", "boom", { isError: true }),
    end("a", "read", "ok"),
  ]);
  assert.deepEqual(
    overlap.items.map(({ label, detail, status }) => [label, detail, status]),
    [
      ["Read", "x.ts", "done"],
      ["Command failed", "ls", "failed"],
    ],
  );
  // A second result for a call that already has one is not hidden.
  const twice = only([
    start("a", "read", { path: "x.ts" }),
    end("a", "read", "ok"),
    end("a", "read", "ok again"),
  ]);
  assert.deepEqual(
    twice.items.map((item) => item.kind),
    ["read", "result"],
  );
});

test("a result that comes before its call is folded into it", () => {
  const turn = only([
    end("late", "read", "ENOENT", { isError: true }),
    start("late", "read", { path: "a.ts" }),
  ]);
  assert.deepEqual(
    turn.items.map(({ label, detail, status, reason }) => [label, detail, status, reason]),
    [["Couldn’t read", "a.ts", "failed", "ENOENT"]],
  );
});

test("a turn of notices says what happened, not how many events", () => {
  const turn = only(["agent switch: Pi → Claude (conversation not carried)"]);
  assert.equal(turn.items.length, 1);
  assert.equal(turn.summary.text, "Switched from Pi to Claude");

  const stopped = groups([
    MANIFEST,
    JSON.stringify({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      errorMessage: JSON.stringify({ error: { message: "Model is unavailable." } }),
    }),
    JSON.stringify({ type: "auto_retry_start", attempt: 2, maxAttempts: 3 }),
    "Stopped by user. Existing worktree changes are kept.",
    // ADE logs a stop twice when a stop is followed by an agent switch.
    "Stopped by user. Existing worktree changes are kept.",
    "Reading additional input from stdin...",
    "agent switch: Codex → Pi (no agent turn started; conversation not carried)",
  ])[0];
  assert.deepEqual(
    stopped.items.map(({ kind, label, detail }) => [kind, label, detail]),
    [
      ["notice", "Retrying after an error", "Attempt 1 of 3 · Model is unavailable."],
      ["notice", "Retrying after an error", "Attempt 2 of 3"],
      ["notice", "Stopped by user. Existing worktree changes are kept.", undefined],
      ["output", "Reading additional input from stdin...", undefined],
      [
        "notice",
        "agent switch: Codex → Pi (no agent turn started; conversation not carried)",
        undefined,
      ],
    ],
  );
  assert.equal(
    stopped.summary.text,
    "Retried after an error · stopped · switched from Codex to Pi",
  );
  assert.equal(stopped.failed, 0);

  assert.equal(
    only(["Compiling...", "$ npm test", "Stopped by user. Existing worktree changes are kept."])
      .summary.text,
    "Stopped · 1 line of CLI output",
  );
  assert.equal(
    only([end("gone", "read", "x"), end("gone2", "read", "y")]).summary.text,
    "2 tool results",
  );
});

test("a failed turn, retry or error event is never left out of the turn", () => {
  const failed = only([
    JSON.stringify({ type: "turn.failed", error: { message: "Context window exceeded" } }),
    JSON.stringify({ type: "auto_retry_end", success: false, finalError: "gave up" }),
    JSON.stringify({ type: "auto_retry_end", success: true }),
  ]);
  assert.deepEqual(
    failed.items.map(({ label, detail, status }) => [label, detail, status]),
    [
      ["turn failed", "Context window exceeded", "failed"],
      ["Retrying did not work", "gave up", "failed"],
    ],
  );
  assert.equal(failed.summary.text, "2 steps failed");
});

test("a Codex change to several files counts every file, once", () => {
  const change = (id, ...paths) =>
    JSON.stringify({
      type: "item.completed",
      item: { id, type: "file_change", changes: paths.map((path) => ({ path })) },
    });
  const turn = only([change("i1", "src/a.ts", "src/b.ts", "src/c.ts"), change("i2", "src/a.ts")]);
  assert.deepEqual(
    turn.items.map((item) => [item.detail, item.files]),
    [
      ["3 files", ["src/a.ts", "src/b.ts", "src/c.ts"]],
      ["src/a.ts", ["src/a.ts"]],
    ],
  );
  assert.equal(turn.summary.text, "Edited 3 files");
});

test("Codex errors and to-do lists are not mistaken for tool use", () => {
  const turn = only([
    JSON.stringify({
      type: "item.completed",
      item: { id: "e", type: "error", message: "Sandbox denied the write" },
    }),
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "t",
        type: "todo_list",
        items: [
          { text: "Read the code", completed: true },
          { text: "Fix the bug", completed: false },
        ],
      },
    }),
  ]);
  assert.deepEqual(
    turn.items.map(({ kind, label, detail, status }) => [kind, label, detail, status]),
    [
      ["error", "Sandbox denied the write", undefined, "failed"],
      ["plan", "Updated the plan", "Fix the bug", "done"],
    ],
  );
});

const acpCall = (callId, toolName, extra = {}) =>
  JSON.stringify({ type: "tool_call", callId, toolName, input: {}, ...extra });
const acpResult = (callId, toolName, extra = {}) =>
  JSON.stringify({ type: "tool_result", callId, toolName, ...extra });

test("ACP calls and results pair by id, and the result's facts land on the step", () => {
  const turn = only([
    acpCall("a", "Read", { kind: "read", input: { path: "/p/src/a.ts" } }),
    acpCall("b", "Edit", { kind: "edit", input: { path: "/p/src/a.ts" } }),
    acpCall("c", "Bash", { kind: "execute", input: { command: "cat x" } }),
    // Results arrive in any order.
    acpResult("c", "Bash", {
      kind: "execute",
      isError: true,
      summary: "Exit code 1: no such file",
    }),
    acpResult("b", "Edit", {
      kind: "edit",
      additions: 3,
      deletions: 2,
      files: ["/p/src/a.ts"],
    }),
    acpResult("a", "Read", { kind: "read", summary: "95 lines" }),
  ]);
  assert.deepEqual(
    turn.items.map(({ kind, label, detail, status, outcome, additions, deletions, reason }) => ({
      kind,
      label,
      detail,
      status,
      outcome,
      additions,
      deletions,
      reason,
    })),
    [
      {
        kind: "read",
        label: "Read",
        detail: "src/a.ts",
        status: "done",
        outcome: "95 lines",
        additions: undefined,
        deletions: undefined,
        reason: undefined,
      },
      {
        kind: "edit",
        label: "Edited",
        detail: "src/a.ts",
        status: "done",
        outcome: undefined,
        additions: 3,
        deletions: 2,
        reason: undefined,
      },
      {
        kind: "run",
        label: "Command failed",
        detail: "cat x",
        status: "failed",
        outcome: undefined,
        additions: undefined,
        deletions: undefined,
        reason: "Exit code 1: no such file",
      },
    ],
  );
  assert.deepEqual(turn.items[1].files, ["src/a.ts"]);
  assert.equal(turn.failed, 1);
  assert.equal(turn.summary.text, "1 step failed · edited 1 file · read 1 file");
});

test("an ACP call logged again as it is refined stays one step", () => {
  const turn = only([
    acpCall("a", "Bash", { kind: "other", title: "Terminal" }),
    acpCall("a", "Bash", { kind: "execute", title: "npm test", input: { command: "npm test" } }),
    acpResult("a", "Bash", { kind: "execute", summary: "Tests 12 passed" }),
  ]);
  assert.equal(turn.items.length, 1);
  const [step] = turn.items;
  assert.deepEqual(
    [step.kind, step.label, step.detail, step.status, step.outcome],
    ["run", "Ran", "npm test", "done", "Tests 12 passed"],
  );
});

test("an ACP call is pending until its result, and one that arrived finished is not", () => {
  const turn = only([
    acpCall("a", "Bash", { kind: "execute", input: { command: "sleep 9" } }),
    acpCall("b", "Write", { kind: "edit" }),
    acpResult("b", "Write", { kind: "edit", additions: 4, deletions: 0 }),
  ]);
  assert.deepEqual(
    turn.items.map(({ status, additions }) => [status, additions]),
    [
      ["pending", undefined],
      ["done", 4],
    ],
  );
});

test("a mode switch and its result are routine and leave no step", () => {
  const turn = only([
    acpCall("m", "ExitPlanMode", { kind: "switch_mode", title: "Ready to code?" }),
    acpResult("m", "ExitPlanMode", { kind: "switch_mode", isError: true }),
  ]);
  assert.deepEqual(turn.items, []);
  assert.equal(turn.failed, 0);
});

test("a web request is a step of its own, in plain words", () => {
  const turn = only([
    acpCall("w", "WebFetch", { kind: "fetch", input: { url: "https://x.test/docs" } }),
    acpResult("w", "WebFetch", { kind: "fetch" }),
  ]);
  assert.deepEqual(
    turn.items.map(({ kind, label, detail }) => [kind, label, detail]),
    [["fetch", "Looked up", "https://x.test/docs"]],
  );
  assert.equal(turn.summary.text, "Looked something up");
});

test("an old id-less result joins a call only when exactly one call of that tool is waiting", () => {
  const call = (toolName, input = {}) => JSON.stringify({ type: "tool_call", toolName, input });
  const result = (toolName, extra = {}) =>
    JSON.stringify({ type: "tool_result", toolName, ...extra });
  // One at a time: each result has exactly one call waiting.
  const sequential = only([
    call("Bash", { command: "a" }),
    result("Bash"),
    call("Bash", { command: "b" }),
    result("Bash", { isError: true }),
  ]);
  assert.deepEqual(
    sequential.items.map(({ label, detail, status }) => [label, detail, status]),
    [
      ["Ran", "a", "done"],
      ["Command failed", "b", "failed"],
    ],
  );
  // Two Bash calls overlap: no telling which result is whose, so nothing is guessed or dropped.
  const overlapping = only([
    call("Bash", { command: "a" }),
    call("Bash", { command: "b" }),
    result("Bash", { isError: true }),
    result("Bash"),
  ]);
  assert.deepEqual(
    overlapping.items.map(({ kind, label, detail, status }) => [kind, label, detail, status]),
    [
      ["run", "Ran", "a", "done"],
      ["run", "Ran", "b", "done"],
      ["error", "Bash failed", undefined, "failed"],
      ["result", "Tool finished", "Bash", "done"],
    ],
  );
  // A result for another tool, or one that names none, goes nowhere either.
  const elsewhere = only([call("Read", { path: "a.ts" }), result("Bash"), result(undefined)]);
  assert.deepEqual(
    elsewhere.items.map(({ kind, detail }) => [kind, detail]),
    [
      ["read", "a.ts"],
      ["result", "Bash"],
      ["result", undefined],
    ],
  );
  // A result with no id never goes to a call that has one.
  const mixed = only([
    acpCall("a", "Bash", { kind: "execute", input: { command: "a" } }),
    call("Bash", { command: "old" }),
    result("Bash", { isError: true }),
  ]);
  assert.deepEqual(
    mixed.items.map(({ detail, status }) => [detail, status]),
    [
      ["a", "pending"],
      ["old", "failed"],
    ],
  );
});

test("a result that amends an earlier one replaces its counts and is never a step", () => {
  const amends = (callId, toolName, extra) =>
    acpResult(callId, toolName, { kind: "edit", amends: true, ...extra });
  const turn = only([
    acpCall("w", "Write", { kind: "edit", input: { path: "/p/a.ts" } }),
    acpResult("w", "Write", { kind: "edit", files: ["/p/a.ts"] }),
    acpCall("e", "Edit", { kind: "edit", input: { path: "/p/b.ts" } }),
    acpResult("e", "Edit", { kind: "edit", additions: 1, deletions: 1, files: ["/p/b.ts"] }),
    // The real diff of the Write came after its result; so did the other sites of the Edit.
    amends("w", "Write", { additions: 5, deletions: 2, files: ["/p/a.ts"] }),
    amends("e", "Edit", { additions: 3, deletions: 3, files: ["/p/b.ts"] }),
  ]);
  assert.deepEqual(
    turn.items.map(({ kind, status, detail, additions, deletions }) => [
      kind,
      status,
      detail,
      additions,
      deletions,
    ]),
    [
      ["edit", "done", "/p/a.ts", 5, 2],
      ["edit", "done", "/p/b.ts", 3, 3],
    ],
  );
  assert.equal(turn.summary.text, "Edited 2 files");
  // A correction whose call is gone (the log keeps its last 500 lines) is dropped, not shown.
  const orphan = only([amends("gone", "Write", { additions: 1, deletions: 0 })]);
  assert.deepEqual(orphan.items, []);
  // With two calls of one id (an id reused), the correction goes to the latest.
  const reused = only([
    acpCall("a", "Write", { kind: "edit", input: { path: "/p/x.ts" } }),
    acpResult("a", "Write", { kind: "edit" }),
    acpCall("a", "Write", { kind: "edit", input: { path: "/p/y.ts" } }),
    acpResult("a", "Write", { kind: "edit" }),
    amends("a", "Write", { additions: 2, deletions: 0 }),
  ]);
  assert.deepEqual(
    reused.items.map(({ detail, additions }) => [detail, additions]),
    [
      ["/p/x.ts", undefined],
      ["/p/y.ts", 2],
    ],
  );
});
