import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  awaitsChangeReport,
  changeReport,
  claimsCreation,
  lateResultFields,
  lineDiffCounts,
  mergeToolCall,
  toolResultFields,
} from "./acp-activity.mjs";
import { runAcpTurn } from "./acp.mjs";
import { currentActivity, formatSessionLogs } from "../lib/ade/formatLogs.mjs";
import { groupActivityTurns } from "../lib/ade/activityTurns.mjs";

const FAKE = fileURLToPath(new URL("./acp-fake-agent.test-helper.mjs", import.meta.url));

test("diff counts: a new file is all additions, a removed one all deletions", () => {
  assert.deepEqual(lineDiffCounts(null, "a\nb\nc\n"), { additions: 3, deletions: 0 });
  assert.deepEqual(lineDiffCounts("", "a"), { additions: 1, deletions: 0 });
  assert.deepEqual(lineDiffCounts("a\nb", ""), { additions: 0, deletions: 2 });
  assert.deepEqual(lineDiffCounts("a\nb", null), { additions: 0, deletions: 2 });
  assert.deepEqual(lineDiffCounts(null, null), { additions: 0, deletions: 0 });
});

test("diff counts: only the lines that changed, not the context around them", () => {
  // The usual edit: one block replaced.
  assert.deepEqual(lineDiffCounts("a\nold\nz", "a\nnew1\nnew2\nz"), { additions: 2, deletions: 1 });
  // A hunk with context and two separate changes: +1 -1 twice, not the whole middle.
  assert.deepEqual(lineDiffCounts("1\nold\n3\nold\n5", "1\nnew\n3\nnew\n5"), {
    additions: 2,
    deletions: 2,
  });
  // A line inserted among lines that stay.
  assert.deepEqual(lineDiffCounts("a\nb\nc", "a\nb\nx\nc"), { additions: 1, deletions: 0 });
  // Nothing changed, a final newline, and Windows line ends.
  assert.deepEqual(lineDiffCounts("a\nb", "a\nb"), { additions: 0, deletions: 0 });
  assert.deepEqual(lineDiffCounts("a\nb\n", "a\nb"), { additions: 0, deletions: 0 });
  assert.deepEqual(lineDiffCounts("a\r\nb", "a\nc"), { additions: 1, deletions: 1 });
});

test("diff counts: a change too large to compare counts everything between head and tail", () => {
  const before = Array.from({ length: 2500 }, (_, i) => `old ${i}`);
  const after = Array.from({ length: 2500 }, (_, i) => `new ${i}`);
  assert.deepEqual(lineDiffCounts(before.join("\n"), after.join("\n")), {
    additions: 2500,
    deletions: 2500,
  });
});

const text = (value) => ({ type: "content", content: { type: "text", text: value } });

test("a failed tool's summary is the first line with anything in it", () => {
  const failed = (update) => toolResultFields(update, true);
  assert.deepEqual(failed({ content: [text("```\n\nENOENT: no such file\nmore\n```")] }), {
    summary: "ENOENT: no such file",
  });
  assert.deepEqual(failed({ content: [text("Tool use aborted")] }), {
    summary: "Tool use aborted",
  });
  assert.equal(failed({ content: [text(`${"x".repeat(300)}\nsecond`)] }).summary?.length, 200);
  // A failed command: Claude Code's "Exit code N" line, then the shell's reason.
  assert.equal(
    failed({ kind: "execute", content: [text("```\nExit code 2\nmake: *** No rule\n```")] })
      .summary,
    "Exit code 2: make: *** No rule",
  );
  // Without content the error may sit in the raw output.
  assert.equal(failed({ rawOutput: { error: "Permission denied" } }).summary, "Permission denied");
  assert.equal(failed({ rawOutput: "boom" }).summary, "boom");
  // Colours are not part of a reason.
  assert.equal(failed({ content: [text("\u001b[31mfailed\u001b[0m")] }).summary, "failed");
  assert.deepEqual(failed({}), {});
  // A change that failed changed nothing, whatever diff was shown before it ran.
  assert.deepEqual(
    failed({
      kind: "edit",
      content: [
        { type: "diff", path: "/p/a.ts", oldText: "a", newText: "b" },
        text("old_string not found"),
      ],
    }),
    { summary: "old_string not found" },
  );
  assert.deepEqual(failed({ content: [{ type: "terminal", terminalId: "t" }] }), {});
});

test("a finished read says how many lines, never what they were", () => {
  const read = (...items) => toolResultFields({ kind: "read", content: items }, false);
  assert.deepEqual(read(text("```\n1\ta\n2\tb\n3\tc\n```")), { summary: "3 lines" });
  assert.deepEqual(read(text("one line\n")), { summary: "1 line" });
  // A markdown file's own fences are lines of it; only the wrapping fence is not.
  assert.deepEqual(read(text("````\n```js\nx\n```\n````")), { summary: "3 lines" });
  assert.deepEqual(read(), {});
  assert.deepEqual(read({ type: "terminal", terminalId: "t" }), {});
});

test("a finished command says its last line of output and a failing exit status", () => {
  const run = (update) => toolResultFields({ kind: "execute", ...update }, false);
  assert.deepEqual(run({ content: [text("```console\n> test\nTests 12 passed\n\n```")] }), {
    summary: "Tests 12 passed",
  });
  assert.deepEqual(run({ content: [text("out")], _meta: { terminal_exit: { exit_code: 3 } } }), {
    summary: "exit 3: out",
  });
  assert.deepEqual(run({ rawOutput: { exit_code: 0 } }), {});
  assert.deepEqual(run({ rawOutput: { exitCode: 1 } }), { summary: "exit 1" });
  assert.equal(run({ content: [text(`${"y".repeat(400)}`)] }).summary?.length, 160);
});

test("a finished edit says its changed lines and files; other tools say nothing", () => {
  const diff = (path, oldText, newText) => ({ type: "diff", path, oldText, newText });
  assert.deepEqual(
    toolResultFields(
      {
        kind: "edit",
        content: [
          diff("/p/a.ts", "x\ny", "x\nz"),
          diff("/p/b.ts", null, "n1\nn2"),
          diff("/p/a.ts", "q", "r"),
        ],
      },
      false,
    ),
    { additions: 4, deletions: 2, files: ["/p/a.ts", "/p/b.ts"] },
  );
  // No diff, but the agent named the file it touched.
  assert.deepEqual(toolResultFields({ kind: "edit", locations: [{ path: "/p/a.ts" }] }, false), {
    files: ["/p/a.ts"],
  });
  const many = Array.from({ length: 14 }, (_, i) => diff(`/p/${i}.ts`, null, "x"));
  assert.equal(toolResultFields({ kind: "move", content: many }, false).files?.length, 10);
  assert.deepEqual(toolResultFields({ kind: "search", content: [text("a.ts:1: x")] }, false), {});
  assert.deepEqual(
    toolResultFields({ kind: "other", content: [diff("/p/a.ts", "a", "b")] }, false),
    {},
  );
});

test("a call is merged from its updates; of _meta only the tool name and exit status are kept", () => {
  const merged = mergeToolCall(
    mergeToolCall(
      { title: "Terminal", kind: "execute" },
      { title: "npm test", content: null, _meta: { claudeCode: { toolName: "Bash" } } },
    ),
    {
      status: "completed",
      _meta: {
        claudeCode: { toolResponse: { content: "WHOLE FILE" } },
        terminal_exit: { exit_code: 1, signal: null },
        other: "x",
      },
    },
  );
  assert.deepEqual(merged, {
    title: "npm test",
    kind: "execute",
    status: "completed",
    _meta: { claudeCode: { toolName: "Bash" }, terminal_exit: { exit_code: 1 } },
  });
  // A non-object _meta adds nothing.
  assert.deepEqual(mergeToolCall({}, { _meta: "x" }), {});
});

test("Claude Code's change report is told from a progress beat, and a guess from a real diff", () => {
  const meta = (toolResponse) => ({ _meta: { claudeCode: { toolName: "Write", toolResponse } } });
  assert.deepEqual(changeReport(meta({ type: "create", filePath: "/p/a" })), { created: true });
  assert.deepEqual(changeReport(meta({ type: "update" })), { created: false });
  assert.deepEqual(changeReport(meta({ filePath: "/p/a", structuredPatch: [] })), {
    created: false,
  });
  assert.equal(changeReport(meta({ elapsedTimeSeconds: 2 })), undefined);
  assert.equal(changeReport(meta("text")), undefined);
  assert.equal(changeReport({}), undefined);
  assert.equal(changeReport(null), undefined);
  const diff = (oldText) => ({ type: "diff", path: "/p/a", oldText, newText: "x" });
  assert.equal(claimsCreation({ content: [diff(null)] }), true);
  assert.equal(claimsCreation({ content: [diff("")] }), true);
  assert.equal(claimsCreation({ content: [diff("old")] }), false);
  assert.equal(claimsCreation({ content: "no" }), false);
  assert.equal(awaitsChangeReport({ kind: "edit", ...meta({}) }), true);
  assert.equal(awaitsChangeReport({ kind: "edit" }), false);
  assert.equal(awaitsChangeReport({ kind: "read", ...meta({}) }), false);
});

test("a late report corrects a result only when its diff says something different", () => {
  const diff = (oldText, newText) => ({ type: "diff", path: "/p/a.ts", oldText, newText });
  const late = (logged, content, created = false) =>
    lateResultFields(logged, { content, locations: [{ path: "/p/a.ts" }] }, { created });
  // A rewritten file: the guess said 40 additions, the report says one line changed.
  assert.deepEqual(late({ shown: {} }, [diff("a\nb\nc", "a\nB\nc")]), {
    additions: 1,
    deletions: 1,
    files: ["/p/a.ts"],
  });
  // A created file has no diff in its report; it keeps what its first diff counted.
  const guess = { additions: 3, deletions: 0, files: ["/p/a.ts"] };
  assert.deepEqual(late({ shown: {}, guess }, undefined, true), {
    additions: 3,
    deletions: 0,
    files: ["/p/a.ts"],
  });
  // Only a created file may keep the guess: an update with no diff (too large) claims nothing.
  assert.equal(late({ shown: {}, guess }, undefined, false), undefined);
  // The counts already logged were right: nothing to say again.
  assert.equal(late({ shown: { additions: 1, deletions: 1 } }, [diff("a", "b")]), undefined);
  assert.equal(late({ shown: { additions: 3, deletions: 0 }, guess }, undefined, true), undefined);
  // The logged counts were short: more sites changed (replace_all).
  assert.equal(
    late({ shown: { additions: 1, deletions: 1 } }, [diff("a", "b"), diff("c", "d")])?.additions,
    2,
  );
  // A report that changed nothing at all says nothing.
  assert.equal(late({ shown: {} }, [diff("same", "same")]), undefined);
});

/** A scripted ACP agent's tool calls, run through ADE's turn and then the Activity pane. */
async function activityOf(scenario) {
  const child = spawn(process.execPath, [FAKE], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, FAKE_ACP_SCENARIO: scenario },
  });
  const logs = ["Context manifest: 3 candidate files, tools: Claude Code tools"];
  try {
    await runAcpTurn({
      child,
      name: "Fake Agent",
      cwd: "/tmp",
      prompt: "do it",
      permission: "build",
      modes: {},
      on: {
        sessionId() {},
        text() {},
        log: (line) => logs.push(line),
        notice() {},
        permission: async () => ({ outcome: "cancelled" }),
      },
    });
  } finally {
    child.stdin.end();
  }
  const [turn] = groupActivityTurns(formatSessionLogs(logs));
  return { logs, turn };
}

test("end to end: an ACP agent's tool calls become paired, classified steps with no agent code", async () => {
  const { logs, turn } = await activityOf("tools");
  assert.deepEqual(
    turn.items.map(({ kind, label, detail, status, outcome, additions, deletions, reason }) => ({
      kind,
      label,
      ...(detail ? { detail } : {}),
      status,
      ...(outcome ? { outcome } : {}),
      ...(additions != null ? { additions, deletions } : {}),
      ...(reason ? { reason } : {}),
    })),
    [
      {
        kind: "read",
        label: "Read",
        detail: "src/a.ts",
        status: "done",
        outcome: "95 lines",
      },
      {
        kind: "edit",
        label: "Edited",
        detail: "src/a.ts",
        status: "done",
        additions: 3,
        deletions: 2,
      },
      {
        kind: "edit",
        label: "Edited",
        detail: "Write src/new.ts",
        status: "done",
        additions: 3,
        deletions: 0,
      },
      { kind: "run", label: "Ran", detail: "npm test", status: "done", outcome: "Tests 12 passed" },
      {
        kind: "run",
        label: "Command failed",
        detail: "cat missing.txt",
        status: "failed",
        reason: "Exit code 1: cat: missing.txt: No such file or directory",
      },
      { kind: "tool", label: "Tool failed", status: "failed", reason: "Tool use aborted" },
      { kind: "search", label: "Searched for", detail: "TODO", status: "done" },
    ],
  );
  assert.equal(turn.failed, 2);
  assert.equal(turn.summary.text, "2 steps failed · edited 2 files · ran 1 command");
  assert.equal(
    turn.items.filter((item) => item.kind === "result").length,
    0,
    "every result paired",
  );
  assert.equal(turn.items.filter((item) => item.status === "pending").length, 0);
  // The turn ends writing its reply.
  assert.equal(currentActivity(logs), "Writing a reply");
  // None of the file contents, diffs or secrets the agent handled reached the log.
  assert.doesNotMatch(logs.join("\n"), /TOP-SECRET|OLD-SECRET|NEW-SECRET|keep 3/);
});

test("end to end: a plain Read from the fake agent's default turn is a finished step", async () => {
  const { turn } = await activityOf("text");
  assert.deepEqual(
    turn.items.map(({ kind, label, detail, status }) => [kind, label, detail, status]),
    [
      ["read", "Read", "/p/a.ts", "done"],
      ["plan", "Updated the plan", "Check the readme", "done"],
    ],
  );
});
