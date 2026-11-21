import { promises as fs } from "node:fs";
import path from "node:path";
import { lockedPath } from "./paths.mjs";

export const CHECKS = [
  { id: "typecheck", label: "Typecheck", script: "typecheck" },
  { id: "lint", label: "Lint", script: "lint" },
  { id: "build", label: "Build", script: "build" },
  { id: "test", label: "Tests", script: "test" },
  { id: "token-audit", label: "Design tokens", script: "token-audit" },
  { id: "design-lock", label: "Design files untouched", internal: true },
];

export const pendingChecks = () =>
  CHECKS.map(({ id, label }) => ({ id, label, status: "pending" }));

const tail = (text, lines = 200) => text.split(/\r?\n/).slice(-lines).join("\n").trim();

/** One line for the user, from what the script printed. */
export function summarize(id, output, passed) {
  if (id === "test") {
    const pass = /^(?:#|ℹ) pass (\d+)/m.exec(output)?.[1] ?? /(\d+) passed/.exec(output)?.[1];
    const fail = /^(?:#|ℹ) fail (\d+)/m.exec(output)?.[1] ?? /(\d+) failed/.exec(output)?.[1];
    if (fail && Number(fail) > 0) return `${fail} failed`;
    if (pass) return `${pass} passed`;
  }
  const tsErrors = output.match(/error TS\d+:/g)?.length;
  const errors = /(\d+) errors?/i.exec(output)?.[1] ?? (tsErrors ? String(tsErrors) : undefined);
  if (!passed && errors) return `${errors} error${errors === "1" ? "" : "s"}`;
  return passed ? "Passed" : "Failed";
}

const MAX_FAILURES = 8;
const clip = (line) => (line.length > 240 ? `${line.slice(0, 239)}…` : line);
// Escape codes some tools print even with CI=1.
const plain = (text) => text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");

/**
 * What failed, first, for the UI: failing test names with their first error
 * line (node --test: the spec reporter's "failing tests" list, or TAP `not ok`
 * lines), TypeScript `error TS` lines, ESLint error lines with file and line,
 * else the first error-looking lines, else the script's last lines. No duplicates; at most eight.
 * @param {string} id the check id
 * @param {string} output what the script printed
 * @returns {string[]}
 */
export function extractFailures(id, output) {
  const lines = plain(output ?? "").split(/\r?\n/);
  const found = [];
  const add = (line) => {
    const text = clip(line.trim());
    if (text && !found.includes(text)) found.push(text);
  };
  if (id === "test") {
    const list = lines.findIndex((line) => /^\s*✖ failing tests:?\s*$/.test(line));
    if (list >= 0) {
      for (let i = list + 1; i < lines.length; i++) {
        const name = /^✖ (.+?)(\s+\([\d.]+m?s\))?$/.exec(lines[i]);
        if (!name) continue;
        const first = lines
          .slice(i + 1)
          .find((line) => line.trim())
          ?.trim();
        add(first && !first.startsWith("✖") ? `${name[1]}: ${first}` : name[1]);
      }
    } else
      for (const line of lines) {
        const tap = /^\s*not ok \d+ - (.+?)(\s+#.*)?$/.exec(line);
        if (tap) add(tap[1]);
      }
  }
  if (!found.length && (id === "typecheck" || id === "build"))
    for (const line of lines) if (/error TS\d+:/.test(line)) add(line);
  if (!found.length && id === "lint") {
    let file = "";
    for (const line of lines) {
      if (/^\S.*\.[cm]?[jt]sx?$/.test(line)) file = path.basename(line.trim());
      const hit = /^\s*(\d+):\d+\s+error\s+(.+?)(\s{2,}(\S+))?\s*$/.exec(line);
      if (hit) add(`${file ? `${file}:${hit[1]} ` : ""}${hit[2]}${hit[4] ? ` (${hit[4]})` : ""}`);
    }
  }
  if (!found.length)
    for (const line of lines)
      if (
        /\b(error|Error|ERR!|failed|FAIL)\b/.test(line) &&
        !/^npm (ERR!|error) (code|path|command|errno|A complete log|Lifecycle)/.test(line.trim())
      )
        add(line);
  // Nothing recognisable: the last lines the script itself printed (not npm's own).
  if (!found.length)
    lines
      .filter((line) => line.trim() && !/^(> |npm (ERR!|error|warn))/.test(line.trim()))
      .slice(-3)
      .forEach(add);
  return found.slice(0, MAX_FAILURES);
}

/**
 * Run every check (no stop on first failure) in the private copy with a
 * throwaway HOME. `onUpdate` receives the full checks array after each step.
 */
export async function runChecks({
  run,
  git,
  sourceDir,
  home,
  branch,
  base = "mine",
  onUpdate,
  cancelled = () => false,
  timeout = 600_000,
}) {
  let scripts = {};
  try {
    scripts =
      JSON.parse(await fs.readFile(path.join(sourceDir, "package.json"), "utf8")).scripts ?? {};
  } catch {}
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  const checks = pendingChecks();
  onUpdate?.(checks);
  for (const check of checks) {
    if (cancelled()) break;
    const def = CHECKS.find((item) => item.id === check.id);
    check.status = "running";
    onUpdate?.(checks);
    const started = Date.now();
    if (def.internal) {
      const diff = await git(["diff", "--name-only", `${base}...${branch}`]);
      const touched = diff.stdout.split(/\r?\n/).filter(Boolean).filter(lockedPath);
      check.status = diff.code === 0 && touched.length === 0 ? "passed" : "failed";
      check.summary =
        diff.code !== 0
          ? "Could not compare the change"
          : touched.length
            ? `${touched.length} protected file${touched.length === 1 ? "" : "s"} changed`
            : "No protected files changed";
      check.output =
        diff.code !== 0
          ? tail(diff.stderr)
          : touched.length
            ? `Customizations may not change the design system. Revert:\n${touched.join("\n")}`
            : "";
      if (check.status === "failed") check.failures = touched.length ? touched : [check.summary];
    } else if (!scripts[def.script]) {
      check.status = "skipped";
      check.summary = `This copy has no "${def.script}" script`;
    } else {
      const result = await run("npm", ["run", def.script], {
        cwd: sourceDir,
        env: { HOME: home, USERPROFILE: home, CI: "1" },
        timeout,
      });
      const output = `${result.stdout}\n${result.stderr}`;
      const passed = result.code === 0 && !result.timedOut;
      check.status = passed ? "passed" : "failed";
      check.summary = result.timedOut ? "Timed out" : summarize(def.id, output, passed);
      check.output = tail(output);
      if (!passed)
        check.failures = result.timedOut
          ? [`Stopped after ${Math.round(timeout / 1000)} seconds`]
          : extractFailures(def.id, output);
    }
    check.durationMs = Date.now() - started;
    onUpdate?.(checks);
  }
  return checks;
}
