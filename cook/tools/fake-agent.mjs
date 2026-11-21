#!/usr/bin/env node
// Scripted `codex` for the cook stills harness. Non-turn calls (--version, login
// status, model list) go to the repo's test helper; `exec` turns run a scenario
// that edits real files in the working copy. Scenario = first line of the file
// named by COOK_SCENARIO_FILE (copy-log | copy-log-failing | no-change |
// reapply-fails: a normal turn builds copy-log, a re-apply turn during an ADE
// update gives up and leaves the conflict as it is).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
if (args[0] !== "exec") {
  const helper = path.join(root, "src/local/cli-fake-agent.test-helper.mjs");
  const res = spawnSync(process.execPath, [helper, "codex", ...args], { stdio: "inherit" });
  process.exit(res.status ?? 1);
}

const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const say = (text) => out({ type: "item.completed", item: { type: "agent_message", text } });
const cdAt = args.indexOf("--cd");
const cwd = cdAt >= 0 ? args[cdAt + 1] : process.cwd();
let scenario = "copy-log";
try {
  scenario = readFileSync(process.env.COOK_SCENARIO_FILE, "utf8").split("\n")[0].trim();
} catch {}
const followUp = args.some((arg) => arg.includes("ADE ran its checks and some failed"));
const write = (file, text) => {
  const target = path.join(cwd, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
};

out({ type: "thread.started", thread_id: "cook-thread" });
await new Promise((resolve) => setTimeout(resolve, 1500));

const REPLY =
  'Added a Copy log button next to Stop. It fetches the whole log, not just what\'s on screen, and shows "Copied" when done.';

const reapply = args.some((arg) => arg.includes("Re-apply this change to ADE"));
if (reapply && scenario === "reapply-fails") {
  say(
    "ADE's new version rewrote copyLog.mjs in a different way, and I could not merge the two without breaking one of them.",
  );
  process.exit(0);
}

if (scenario === "no-change") {
  say("I looked at this and did not find anything to change.");
  process.exit(0);
}
if (followUp && scenario === "copy-log-failing") {
  say("I looked at the failing test but could not find a safe fix.");
  process.exit(0);
}

write(
  "src/lib/ade/copyLog.mjs",
  `// Copy a session's whole log, not just the rows on screen.
export async function copyWholeLog(fetchLog, write) {
  const log = await fetchLog();
  const text = Array.isArray(log) ? log.join("\\n") : String(log ?? "");
  await write(text);
  return text.length;
}
`,
);
write(
  "src/lib/ade/copyLog.d.mts",
  `export function copyWholeLog(
  fetchLog: () => Promise<string[] | string>,
  write: (text: string) => Promise<unknown>,
): Promise<number>;
`,
);
write(
  "src/components/ade/CopyLogButton.tsx",
  `import { useState } from "react";
import { copyText } from "@/lib/ade/clipboard";
import { copyWholeLog } from "@/lib/ade/copyLog.mjs";

/** Copies the whole log of a session, then says so for two seconds. */
export function CopyLogButton({ fetchLog }: { fetchLog: () => Promise<string[] | string> }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-xs text-dim hover:text-ink"
      onClick={async () => {
        await copyWholeLog(fetchLog, copyText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copied" : "Copy log"}
    </button>
  );
}
`,
);
const failing = scenario === "copy-log-failing";
write(
  "src/lib/ade/copyLog.test.mjs",
  `import test from "node:test";
import assert from "node:assert/strict";
import { copyWholeLog } from "./copyLog.mjs";

test("copies every line of the log, not just the visible rows", async () => {
  let written = "";
  const length = await copyWholeLog(
    async () => ["one", "two", "three"],
    async (text) => {
      written = text;
    },
  );
  assert.equal(written, "one\\ntwo\\nthree");
  assert.equal(length, written.length);
});
${
  failing
    ? `
test("keeps the log's trailing newline", async () => {
  let written = "";
  await copyWholeLog(
    async () => ["one", "two"],
    async (text) => {
      written = text;
    },
  );
  assert.equal(written, "one\\ntwo\\n");
});
`
    : ""
}`,
);
say(REPLY);
