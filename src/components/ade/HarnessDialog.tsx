import { useEffect, useRef, useState } from "react";
import type { AgentId, HarnessJob } from "@/lib/ade/types";
import { harnessJob, useAde } from "@/lib/ade/store";

/**
 * Confirm-then-run dialog for CLI install/update harness jobs. Shows the exact
 * command before starting, then streams job output until the job finishes.
 */
export function HarnessDialog({
  agentId,
  kind,
  onClose,
}: {
  agentId: AgentId;
  kind: "install" | "update";
  onClose: () => void;
}) {
  const { state, harnessCommand, startHarness, refresh } = useAde();
  const agent = state.agents.find((a) => a.id === agentId);
  const command = harnessCommand(agentId, kind);
  const [started, setStarted] = useState(false);
  const [job, setJob] = useState<HarnessJob | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    let refreshed = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await harnessJob(agentId);
        if (cancelled) return;
        setJob(next);
        if (next.status === "succeeded" || next.status === "failed") {
          if (timer !== undefined) window.clearInterval(timer);
          timer = undefined;
        }
        if (next.status === "succeeded" && !refreshed) {
          refreshed = true;
          await refresh();
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void poll();
    timer = window.setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [started, agentId, refresh]);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [job?.output.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (job?.status === "running") return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, job?.status]);

  const run = async () => {
    try {
      setBusy(true);
      setError("");
      const startedJob = await startHarness(agentId, kind);
      setJob(startedJob);
      setStarted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const finished = job?.status === "succeeded" || job?.status === "failed";
  const title =
    kind === "install" ? `Install ${agent?.name ?? agentId}` : `Update ${agent?.name ?? agentId}`;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="harness-title"
    >
      <div className="w-full max-w-lg rounded-lg bg-panel p-6 ring-1 ring-ink/10 animate-rise">
        <div className="label-mono">{kind === "install" ? "Install CLI" : "Update CLI"}</div>
        <h2 id="harness-title" className="mt-1 font-display text-3xl tracking-wide">
          {title}
        </h2>

        {!started ? (
          <>
            <pre className="mt-4 overflow-x-auto rounded-md bg-ink px-3 py-2 font-mono text-[11px] leading-relaxed text-paper/80">
              {command || "(no command configured)"}
            </pre>
            <p className="mt-3 text-[12px] leading-relaxed text-dim">
              This runs on your computer and may take a few minutes.
            </p>
            {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                className="btn-amber px-4 py-2 text-[13px]"
                disabled={busy || !command}
                onClick={() => void run()}
              >
                {busy ? "Starting…" : "Run"}
              </button>
              <button
                type="button"
                className="btn-quiet ml-auto px-4 py-2 text-[13px]"
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <pre
              ref={outputRef}
              className="mt-4 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-ink px-3 py-2 font-mono text-[11px] leading-relaxed text-paper/80 [overflow-wrap:anywhere]"
            >
              {(job?.output ?? []).join("") || "Waiting for output…"}
            </pre>
            <p className="mt-3 font-mono text-[11px] text-dim">
              Status: {job?.status ?? "running"}
              {typeof job?.exitCode === "number" ? ` · exit ${job.exitCode}` : ""}
            </p>
            {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                className="btn-quiet ml-auto px-4 py-2 text-[13px]"
                onClick={onClose}
                disabled={!finished && job?.status === "running"}
              >
                {finished ? "Close" : "Running…"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
