import { useState } from "react";
import {
  ChevronRight,
  CircleCheck,
  CircleMinus,
  CircleX,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import {
  rerunChecks,
  useCustomizeAction,
  type Change,
  type ChangeCheck,
} from "@/lib/ade/customizeApi";
import { checkLabel } from "./customizeText";

function CheckIcon({ status }: { status: ChangeCheck["status"] }) {
  const cls = "size-4 shrink-0";
  if (status === "passed") return <CircleCheck className={`${cls} text-teal`} strokeWidth={1.5} />;
  if (status === "failed") return <CircleX className={`${cls} text-danger`} strokeWidth={1.5} />;
  if (status === "running")
    return <LoaderCircle className={`${cls} animate-spin text-teal`} strokeWidth={1.5} />;
  if (status === "skipped") return <CircleMinus className={`${cls} text-dim`} strokeWidth={1.5} />;
  return (
    <span className={`${cls} grid place-items-center`}>
      <span className="size-3 rounded-full border border-dim/60" />
    </span>
  );
}

function duration(ms?: number) {
  if (ms == null) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

// eslint-disable-next-line no-control-regex -- ANSI colour codes from test runners
const ANSI = /\u001b\[[0-9;]*m/g;
const FAILURE_LINE = /not ok|✖|error|Error|FAIL/;

/** The lines that say what failed: the check's own list, else matching output lines. */
function failureExcerpt(check: ChangeCheck): string[] {
  if (check.failures?.length) return check.failures.slice(0, 12);
  const lines = (check.output ?? "").replace(ANSI, "").split("\n");
  const hits = lines.filter((line) => FAILURE_LINE.test(line)).map((line) => line.trimEnd());
  const unique = hits.filter((line, index) => line.trim() && hits.indexOf(line) === index);
  if (unique.length) return unique.slice(0, 12);
  return lines.filter((line) => line.trim()).slice(-8);
}

function FailedCheck({ check }: { check: ChangeCheck }) {
  const [full, setFull] = useState(false);
  const excerpt = failureExcerpt(check);
  const hasOutput = !!check.output?.trim();
  return (
    <section
      aria-label={`${checkLabel(check)} failed`}
      className="rounded-md border border-danger/30 bg-danger/5 px-3 py-3"
    >
      <div className="flex items-center gap-3">
        <CheckIcon status="failed" />
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-ink">
          {checkLabel(check)}
        </span>
        <span className="shrink-0 text-xs text-danger tabular-nums">
          {[check.summary ?? "Failed", duration(check.durationMs)].filter(Boolean).join(" · ")}
        </span>
      </div>
      {excerpt.length > 0 && (
        <pre className="mt-3 max-h-48 overflow-auto rounded-md border border-line bg-paper px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-ink">
          {excerpt.join("\n")}
        </pre>
      )}
      {hasOutput && (
        <button
          type="button"
          onClick={() => setFull((v) => !v)}
          aria-expanded={full}
          className="mt-2 inline-flex items-center gap-1 text-xs text-dim transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
        >
          <ChevronRight
            className={`size-3.5 transition-transform motion-reduce:transition-none ${full ? "rotate-90" : ""}`}
            strokeWidth={1.5}
            aria-hidden
          />
          {full ? "Hide full output" : "Show full output"}
        </button>
      )}
      {full && (
        <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-line bg-paper p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-[color:var(--text-secondary)]">
          {check.output?.replace(ANSI, "")}
        </pre>
      )}
    </section>
  );
}

export function ChecksPanel({ change }: { change: Change }) {
  const [open, setOpen] = useState<string | null>(null);
  const rerun = useCustomizeAction((id: string) => rerunChecks(id));
  // A failed change offers "Run checks again" next to its other next steps instead.
  const canRerun = ["ready", "needs-you"].includes(change.status);
  const failed = change.checks.filter((check) => check.status === "failed");
  const rest = change.checks.filter((check) => check.status !== "failed");

  if (!change.checks.length)
    return (
      <p className="text-ui text-dim">
        {change.status === "working"
          ? "Checks run when the agent finishes."
          : "No checks have run for this change."}
      </p>
    );

  return (
    <div>
      {failed.length > 0 && (
        <div className="mb-3 space-y-2">
          {failed.map((check) => (
            <FailedCheck key={check.id} check={check} />
          ))}
        </div>
      )}
      <ul className="divide-y divide-line">
        {rest.map((check) => {
          const expandable = !!check.output?.trim();
          const expanded = expandable && open === check.id;
          const row = (
            <>
              <CheckIcon status={check.status} />
              <span className="sr-only">{check.status}</span>
              <span
                className={`min-w-0 flex-1 truncate text-ui ${check.status === "pending" || check.status === "skipped" ? "text-dim" : "text-ink"}`}
              >
                {checkLabel(check)}
              </span>
              <span className="min-w-0 shrink truncate text-xs text-dim tabular-nums">
                {[check.summary, duration(check.durationMs)].filter(Boolean).join(" · ")}
              </span>
              {expandable && (
                <ChevronRight
                  className={`size-3.5 shrink-0 text-dim transition-transform motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
                  strokeWidth={1.5}
                  aria-hidden
                />
              )}
            </>
          );
          return (
            <li key={check.id}>
              {expandable ? (
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : check.id)}
                  aria-expanded={expanded}
                  title={check.summary}
                  className="flex min-h-9 w-full items-center gap-3 py-1.5 text-left transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
                >
                  {row}
                </button>
              ) : (
                <div className="flex min-h-9 items-center gap-3 py-1.5" title={check.summary}>
                  {row}
                </div>
              )}
              {expanded && (
                <pre className="mb-3 max-h-72 overflow-auto rounded-md border border-line bg-paper p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-[color:var(--text-secondary)]">
                  {check.output?.replace(ANSI, "")}
                </pre>
              )}
            </li>
          );
        })}
      </ul>

      {change.status === "fixing" && (
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-dim">
          <LoaderCircle
            className="mt-0.5 size-3.5 shrink-0 animate-spin"
            strokeWidth={1.5}
            aria-hidden
          />
          The agent is fixing this (attempt {Math.max(1, change.fixAttempts)} of 2). Keep it stays
          off until every check passes.
        </p>
      )}
      {change.status === "failed" && (
        <p className="mt-3 text-xs leading-5 text-dim">
          The agent tried twice and a check still fails. Ask it to try again, or undo the change.
        </p>
      )}

      {canRerun && (
        <button
          type="button"
          onClick={() => rerun.mutate(change.id)}
          disabled={rerun.isPending}
          className="btn-quiet mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium"
        >
          <RotateCcw className="size-3.5" strokeWidth={1.5} aria-hidden />
          {rerun.isPending ? "Starting checks…" : "Run checks again"}
        </button>
      )}
      {rerun.error instanceof Error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {rerun.error.message}
        </p>
      )}
    </div>
  );
}
