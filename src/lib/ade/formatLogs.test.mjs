import test from "node:test";
import assert from "node:assert/strict";
import {
  currentActivity,
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
