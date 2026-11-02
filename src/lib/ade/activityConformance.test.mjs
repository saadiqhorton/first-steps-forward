// One table that every agent's activity log must pass: raw lines in, the Activity pane's turns
// out. To support a new agent, add a fixture to fixtures/activity/ and a row to CASES below.
//
// Fixtures are raw log lines, one per line, as they are stored in ~/.ade/session-logs:
// - pi.ndjson: event shapes, ids and tool names from a real Pi session log; file contents,
//   paths and screenshots were replaced.
// - acp.ndjson: the lines ADE writes for Claude Code over ACP (src/local/acp.mjs), with Claude
//   Code's own tool names. acp-legacy.ndjson is the same session as ADE wrote it before it
//   logged ids, kinds and summaries (the real output of that older code).
// - codex.ndjson and opencode.ndjson are written to the formats their CLIs document
//   (`codex exec --json`, `opencode run --format json`); no real session log of either was
//   available to copy from.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { currentActivity, formatSessionLogs } from "./formatLogs.mjs";
import { groupActivityTurns } from "./activityTurns.mjs";

const FIXTURES = new URL("./fixtures/activity/", import.meta.url);
const load = (file) =>
  readFileSync(new URL(file, FIXTURES), "utf8")
    .split("\n")
    .filter((line) => line.trim());

/**
 * `items` is [kind, status, detail] for each step in the turn, in order. `failed` and `summary`
 * are the turn's. `edits` are the changed line counts of an edit step (by its index in items),
 * `outcomes` the plain outcome of a step, `reasons` why a step failed. `unpaired` is how many
 * results found no call. `live` is the status phrase for the whole log, and `checkpoints` the
 * phrase after the first line that contains some text.
 */
const CASES = [
  {
    agent: "Pi",
    file: "pi.ndjson",
    items: [
      ["search", "done", ".env*"],
      ["read", "done", "src/api.ts"],
      ["read", "failed", ".env"],
      ["edit", "done", "pages/Settings.tsx"],
      ["preview", "done", undefined],
      ["browse", "done", undefined],
      ["browse", "pending", undefined],
    ],
    failed: 1,
    summary: "1 step failed · edited 1 file · read 1 file",
    edits: { 3: [2, 1] },
    reasons: { 2: "ENOENT: no such file or directory, access '/home/user/project/.env'" },
    live: "Looking at the page",
    checkpoints: [
      ['"toolName":"find"', "Reading the project"],
      ['"toolName":"edit"', "Updating Settings.tsx"],
    ],
  },
  {
    agent: "OpenCode",
    file: "opencode.ndjson",
    items: [
      ["read", "done", "src/app.ts"],
      ["run", "done", "npm test"],
      ["edit", "done", "src/app.ts"],
      ["run", "failed", "cat missing.txt"],
      ["search", "done", "TODO in project/src"],
      ["tool", "done", "webfetch"],
      ["message", "done", "Done. The tests pass."],
      ["read", "done", "project/README.md"],
    ],
    failed: 1,
    summary: "1 step failed · edited 1 file · ran 1 command",
    live: "Reading the project",
  },
  {
    agent: "Codex",
    file: "codex.ndjson",
    items: [
      ["run", "done", "bash -lc 'rg -n logout public/js/app.js'"],
      ["run", "failed", "bash -lc 'cat missing.txt'"],
      ["edit", "done", "js/app.js"],
      ["tool", "done", "mcp_tool_call"],
      ["plan", "done", "Run the checks"],
    ],
    failed: 1,
    summary: "1 step failed · edited 1 file · ran 1 command",
    live: "Running checks",
    checkpoints: [['"id":"item_1","type":"command_execution"', "Reading the project"]],
  },
  {
    agent: "Claude Code over ACP",
    file: "acp.ndjson",
    items: [
      ["plan", "done", "Read the file and run the tests"],
      ["read", "done", "src/a.ts"],
      ["edit", "done", "src/a.ts"],
      ["edit", "done", "Write src/new.ts"],
      ["run", "done", "npm test"],
      ["permission", "done", "cat missing.txt"],
      ["permission", "done", "cat missing.txt — Allow"],
      ["run", "failed", "cat missing.txt"],
      ["tool", "failed", undefined],
      ["search", "done", "TODO"],
    ],
    failed: 2,
    summary: "2 steps failed · edited 2 files · ran 1 command",
    edits: { 2: [3, 2], 3: [3, 0] },
    outcomes: { 1: "95 lines", 4: "Tests 12 passed" },
    reasons: {
      7: "Exit code 1: cat: missing.txt: No such file or directory",
      8: "Tool use aborted",
    },
    live: "Writing a reply",
    checkpoints: [
      ['"title":"Read src/a.ts"', "Reading the project"],
      ['"callId":"edit1","toolName":"Edit"', "Updating a.ts"],
      ['"title":"npm test"', "Running checks"],
      ['"decision":"asked"', "Waiting for your answer"],
      ['"callId":"ghost1","toolName":"tool","isError"', "Still working on the next step"],
      // A mode switch is routine, so the phrase stays where the step before it left it.
      ['"kind":"switch_mode","title"', "Still working on the next step"],
    ],
  },
  {
    agent: "Claude Code over ACP, as logged before ids",
    file: "acp-legacy.ndjson",
    // The one Read result left over is the agent's repeated status, shown rather than dropped.
    items: [
      ["read", "done", "Read File"],
      ["result", "done", "read"],
      ["edit", "done", "src/a.ts"],
      ["edit", "done", "Write src/new.ts"],
      ["run", "done", "Terminal"],
      ["run", "failed", "cat missing.txt"],
      ["error", "failed", undefined],
      ["search", "done", "TODO"],
      ["tool", "failed", "Ready to code?"],
    ],
    failed: 3,
    summary: "3 steps failed · edited 2 files · ran 1 command",
    unpaired: 1,
    live: "Writing a reply",
  },
];

const until = (lines, text) => {
  const at = lines.findIndex((line) => line.includes(text));
  assert.ok(at >= 0, `no line contains ${text}`);
  return lines.slice(0, at + 1);
};

for (const row of CASES) {
  test(`${row.agent}: a fixture log reads as steps, results and a status`, () => {
    const lines = load(row.file);
    const rows = formatSessionLogs(lines);
    const turns = groupActivityTurns(rows);
    assert.equal(turns.length, 1, "one manifest line, one turn");
    const [turn] = turns;
    assert.deepEqual(
      turn.items.map((item) => [item.kind, item.status, item.detail]),
      row.items,
    );
    // Each call took its own result: any result left over is one that has no call.
    assert.equal(turn.items.filter((item) => item.kind === "result").length, row.unpaired ?? 0);
    assert.equal(turn.failed, row.failed);
    assert.equal(turn.summary.text, row.summary);
    for (const [at, [additions, deletions]] of Object.entries(row.edits ?? {}))
      assert.deepEqual(
        [turn.items[at].additions, turn.items[at].deletions],
        [additions, deletions],
        `edit ${at}`,
      );
    for (const [at, outcome] of Object.entries(row.outcomes ?? {}))
      assert.equal(turn.items[at].outcome, outcome, `outcome ${at}`);
    for (const [at, reason] of Object.entries(row.reasons ?? {}))
      assert.equal(turn.items[at].reason, reason, `reason ${at}`);
    assert.equal(currentActivity(lines), row.live);
    for (const [text, phrase] of row.checkpoints ?? [])
      assert.equal(currentActivity(until(lines, text)), phrase, `after ${text}`);
  });
}

test("every fixture has a row in the table, and every row a fixture", () => {
  const files = readdirSync(FIXTURES).filter((name) => name.endsWith(".ndjson"));
  assert.deepEqual(files.sort(), CASES.map((row) => row.file).sort());
});

test("fixtures are small, within the log's line limit, and hold nothing private", () => {
  for (const { file } of CASES) {
    const lines = load(file);
    assert.ok(lines.length >= 10 && lines.length <= 25, `${file} has ${lines.length} lines`);
    for (const line of lines) {
      assert.ok(line.length <= 4096, `${file}: a line is too long`);
      assert.doesNotMatch(line, /\/home\/(?!user\/)/, `${file}: a real home folder`);
      assert.doesNotMatch(
        line,
        /sk-[A-Za-z0-9]|Bearer |api[_-]?key|\btoken"?\s*[:=]|password|secret/i,
        file,
      );
      assert.doesNotMatch(line, /"type":"image"|iVBORw0KGgo/, `${file}: a screenshot`);
    }
  }
});

test("a log that stops after a call leaves that step waiting, whatever the agent", () => {
  const waiting = {
    "pi.ndjson": 1,
    "acp.ndjson": 0,
  };
  for (const [file, count] of Object.entries(waiting)) {
    const [turn] = groupActivityTurns(formatSessionLogs(load(file)));
    assert.equal(turn.items.filter((item) => item.status === "pending").length, count, file);
  }
  // Cut the Claude log right after its command starts: that step is the one in progress.
  const lines = until(load("acp.ndjson"), '"title":"npm test"');
  const [turn] = groupActivityTurns(formatSessionLogs(lines));
  assert.deepEqual(
    turn.items.filter((item) => item.status === "pending").map((item) => item.detail),
    ["npm test"],
  );
});
