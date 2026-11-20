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

export function ChecksPanel({ change }: { change: Change }) {
  const firstFailed = change.checks.find((check) => check.status === "failed")?.id ?? null;
  const [open, setOpen] = useState<string | null>(firstFailed);
  const rerun = useCustomizeAction((id: string) => rerunChecks(id));
  const canRerun = ["ready", "failed", "needs-you"].includes(change.status);

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
      <ul className="divide-y divide-line">
        {change.checks.map((check) => {
          const expandable = !!check.output?.trim();
          const expanded = expandable && open === check.id;
          const row = (
            <>
              <CheckIcon status={check.status} />
              <span className="sr-only">{check.status}</span>
              <span
                className={`min-w-0 flex-1 truncate text-ui ${check.status === "pending" || check.status === "skipped" ? "text-dim" : "text-ink"}`}
              >
                {check.label}
              </span>
              <span className="shrink-0 truncate text-xs text-dim tabular-nums">
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
                  className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
                >
                  {row}
                </button>
              ) : (
                <div className="flex items-center gap-3 py-2.5">{row}</div>
              )}
              {expanded && (
                <pre className="mb-3 max-h-72 overflow-auto rounded-md border border-line bg-paper p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-[color:var(--text-secondary)]">
                  {check.output}
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
          The agent tried twice and a check still fails. Ask it for another fix below, or undo the
          change.
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
