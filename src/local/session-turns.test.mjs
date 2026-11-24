import test from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, retryHint } from "./classify.mjs";
import { formatLogLine, currentActivity } from "../lib/ade/formatLogs.mjs";
import { shrinkLogLine } from "./session-turns.mjs";

const piAgentEnd = (bytes) =>
  JSON.stringify({
    type: "agent_end",
    willRetry: false,
    messages: [
      { role: "user", content: [{ type: "text", text: "u".repeat(bytes / 2) }] },
      {
        role: "assistant",
        content: [{ type: "thinking", thinkingSignature: "s".repeat(bytes / 2) }],
        stopReason: "stop",
      },
    ],
  });

test("lines up to 4 KB are stored byte-identical", () => {
  const json = JSON.stringify({ type: "text", text: "t".repeat(2000), messages: [1, 2] });
  const edge = "x".repeat(4096);
  for (const line of [json, edge, "plain output", "", '{"broken json']) {
    assert.equal(shrinkLogLine(line), line);
  }
});

test("a 1.7 MB Pi agent_end becomes valid JSON under 8 KB without its transcript", () => {
  const raw = piAgentEnd(1_700_000);
  assert.ok(raw.length > 1_700_000);
  const shrunk = shrinkLogLine(raw);
  assert.ok(shrunk.length < 8192, `${shrunk.length} chars`);
  assert.deepEqual(JSON.parse(shrunk), { type: "agent_end", willRetry: false });
});

test("toolResults go and any string over 500 characters is cut with a count", () => {
  const raw = JSON.stringify({
    type: "turn_end",
    toolResults: [{ content: "r".repeat(100_000) }],
    message: { content: [{ type: "image", data: "b".repeat(2_000) }, { text: "short" }] },
    error: { message: "e".repeat(500) },
    count: 3,
    ok: null,
  });
  const shrunk = JSON.parse(shrinkLogLine(raw));
  assert.equal("toolResults" in shrunk, false);
  assert.equal(shrunk.message.content[0].data, `${"b".repeat(500)}…[+1500 chars]`);
  assert.equal(shrunk.message.content[1].text, "short");
  assert.equal(shrunk.error.message, "e".repeat(500), "500 characters is not over the limit");
  assert.equal(shrunk.count, 3);
  assert.equal(shrunk.ok, null);
});

test("a long line that is not JSON is cut to 4 KB with a marker", () => {
  const shrunk = shrinkLogLine("o".repeat(10_000));
  assert.equal(shrunk, `${"o".repeat(4096)}…[+5904 chars]`);
  const brokenJson = shrinkLogLine(`{"type":"x","data":"${"d".repeat(10_000)}`);
  assert.ok(brokenJson.length < 4200 && brokenJson.endsWith("chars]"));
});

test("JSON too large after shrinking keeps a small valid event, never a cut dump", () => {
  const wide = JSON.stringify({ type: "x", items: Array.from({ length: 5000 }, (_, i) => i) });
  const parsed = JSON.parse(shrinkLogLine(wide));
  assert.equal(parsed.type, "x");
  assert.equal(parsed.items.length, 20);

  const hugeResult = JSON.stringify({
    type: "tool_execution_end",
    toolCallId: "c1",
    toolName: "mcp__parallel__web_search",
    result: {
      content: Array.from({ length: 80 }, () => ({ type: "text", text: "r".repeat(600) })),
    },
    isError: false,
  });
  const shrunk = JSON.parse(shrinkLogLine(hugeResult));
  assert.equal(shrunk.type, "tool_execution_end");
  assert.equal(shrunk.toolCallId, "c1");
  assert.equal(shrunk.toolName, "mcp__parallel__web_search");
  assert.equal("result" in shrunk, false);
  assert.equal(shrunk.isError, false);
  // The completed call still reads in the Activity pane.
  assert.equal(formatLogLine(JSON.stringify(shrunk))?.title, "Tool finished");
});

test("the Activity pane reads a shrunk line the same way", () => {
  const raw = JSON.stringify({
    type: "tool_execution_end",
    toolName: "screenshot",
    result: { content: [{ type: "text", text: "ok ".repeat(3000) }] },
    toolResults: ["z".repeat(50_000)],
  });
  const shrunk = shrinkLogLine(raw);
  const row = formatLogLine(shrunk);
  assert.equal(row.tone, "output");
  assert.equal(row.title, "Tool finished");
  assert.equal(currentActivity([shrunk]), "Still working on the next step");
  assert.equal(currentActivity([shrinkLogLine(piAgentEnd(100_000))]), "Starting");
});

// What turn.texts feeds: error wording must survive the shrink wherever it can appear.
test("failure wording still classifies after a long line is shrunk", () => {
  const filler = "f".repeat(20_000);
  const cases = [
    [
      "provider_quota",
      JSON.stringify({
        type: "error",
        error: { message: "429 rate limit exceeded. Please try again in 20s." },
        trace: filler,
      }),
    ],
    [
      "model_not_found",
      JSON.stringify({ type: "error", error: { name: "ProviderModelNotFoundError" }, log: filler }),
    ],
    ["auth_expired", `Error: invalid api key ${filler}`],
    [
      "provider_quota",
      JSON.stringify({
        type: "message_end",
        message: { errorMessage: "quota exceeded", content: filler },
      }),
    ],
  ];
  for (const [kind, raw] of cases) {
    assert.equal(classifyFailure([shrinkLogLine(raw)]), kind, raw.slice(0, 80));
  }
  assert.equal(
    retryHint([shrinkLogLine(cases[0][1])]),
    "try again in 20s",
    "the retry hint survives too",
  );
});
