import test from "node:test";
import assert from "node:assert/strict";
import { formatLogLine, formatSessionLogs, truncate } from "./formatLogs.mjs";

test("truncate shortens long strings", () => {
  assert.equal(truncate("abc", 10), "abc");
  assert.equal(truncate("a".repeat(20), 10).endsWith("…"), true);
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

test("formatSessionLogs collapses repeated empty info titles", () => {
  const lines = [
    JSON.stringify({ type: "step_start" }),
    JSON.stringify({ type: "step_start" }),
    JSON.stringify({ type: "tool_use", tool: "read", input: { path: "a.ts" } }),
  ];
  const rows = formatSessionLogs(lines);
  assert.equal(rows.filter((r) => r.title === "Step started").length, 1);
  assert.equal(rows.some((r) => r.title === "Used read"), true);
});
