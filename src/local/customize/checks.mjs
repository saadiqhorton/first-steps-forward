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
    const pass = /^# pass (\d+)/m.exec(output)?.[1] ?? /(\d+) passed/.exec(output)?.[1];
    const fail = /^# fail (\d+)/m.exec(output)?.[1] ?? /(\d+) failed/.exec(output)?.[1];
    if (fail && Number(fail) > 0) return `${fail} failed`;
    if (pass) return `${pass} passed`;
  }
  const errors = /(\d+) errors?/i.exec(output)?.[1];
  if (!passed && errors) return `${errors} error${errors === "1" ? "" : "s"}`;
  return passed ? "Passed" : "Failed";
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
    }
    check.durationMs = Date.now() - started;
    onUpdate?.(checks);
  }
  return checks;
}
