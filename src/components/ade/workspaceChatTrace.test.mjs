import assert from "node:assert/strict";
import test from "node:test";
import { formatSessionLogs } from "../../lib/ade/formatLogs.mjs";
import { threadTrace } from "./workspaceChatTrace.mjs";

const at = 1;

/** The rows ActivityLogs will build from the trace; routine markers are separators. */
const shown = (trace) =>
  formatSessionLogs(trace.lines)
    .filter((row) => row.kind !== "lifecycle" && row.kind !== "turn")
    .map((row) => ({
      kind: row.kind,
      title: row.title,
      ...(row.body ? { body: row.body } : {}),
    }));

test("log entries become the CLI lines the Activity pane decodes", () => {
  const trace = threadTrace([
    { id: "a", type: "log", text: '{"type":"tool_execution_start","toolName":"read"}', at },
    { id: "b", type: "log", text: '{"type":"tool_execution_end","toolName":"read"}', at },
  ]);
  assert.deepEqual(trace.lines, [
    '{"type":"tool_execution_start","toolName":"read"}',
    '{"type":"tool_execution_end","toolName":"read"}',
  ]);
  assert.equal(trace.count, 2);
});

test("notices, errors and permission asks are the rows the Activity pane renders", () => {
  const trace = threadTrace([
    {
      id: "n1",
      type: "notice",
      text: "Connectors could not be read, so this turn runs without them.",
      at,
    },
    { id: "p1", type: "permission", text: "Agent needs input", at },
    { id: "e1", type: "error", text: "Codex quit: quota exhausted", at },
    { id: "f1", type: "failed", text: "Agent turn failed.", at },
    { id: "s1", type: "stopped", text: "Stopped by user", at },
  ]);
  assert.deepEqual(shown(trace), [
    { kind: "output", title: "Connectors could not be read, so this turn runs without them." },
    { kind: "permission", title: "Asked for your permission", body: "Agent needs input" },
    { kind: "error", title: "Codex quit: quota exhausted" },
    { kind: "error", title: "Agent turn failed." },
    { kind: "notice", title: "Stopped by user" },
  ]);
  assert.equal(trace.count, 5);
});

test("a note keeps its place in the log", () => {
  const trace = threadTrace([
    { id: "a", type: "log", text: "first", at },
    { id: "e", type: "error", text: "boom", at },
    { id: "b", type: "log", text: "last", at },
  ]);
  assert.deepEqual(trace.lines, ["first", '{"type":"error","message":"boom"}', "last"]);
  assert.deepEqual(
    shown(trace).map((row) => [row.kind, row.title]),
    [
      ["output", "first"],
      ["error", "boom"],
      ["output", "last"],
    ],
  );
  assert.equal(trace.count, 3);
});

test("skips empty entries and blank log lines", () => {
  const trace = threadTrace([
    { id: "a", type: "log", text: "first", at },
    { id: "c", type: "log", text: "  ", at },
    null,
    "not an entry",
    { id: "d", type: "log", text: "last", at },
    { type: "notice", text: "no id" },
  ]);
  assert.deepEqual(trace.lines, ["first", "last", "no id"]);
  assert.equal(trace.count, 3);
});

test("streaming deltas, truncated JSON and routine markers are not steps", () => {
  const trace = threadTrace([
    { type: "log", text: '{"type":"message_update","assistantMessageEvent":{}}', at },
    { type: "log", text: '{"type":"tool_execution_start","toolName":"re', at },
    { type: "log", text: '{"type":"agent_start"}', at },
    { type: "log", text: '{"type":"turn_start"}', at },
    { type: "log", text: '{"type":"agent_settled","aborted":false}', at },
  ]);
  assert.deepEqual(shown(trace), []);
  assert.equal(trace.count, 0);
});

test("an empty or missing activity list has nothing to show", () => {
  const empty = { lines: [], count: 0 };
  assert.deepEqual(threadTrace([]), empty);
  assert.deepEqual(threadTrace(undefined), empty);
  assert.deepEqual(threadTrace(null), empty);
});
