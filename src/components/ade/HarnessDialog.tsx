import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentId } from "@/lib/ade/types";
import { harnessJob, useAde, useAdeState } from "@/lib/ade/store";

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
  const { harnessCommand, startHarness, refresh } = useAde();
  const queryClient = useQueryClient();
  const agent = useAdeState((state) => state.agents.find((a) => a.id === agentId));
  const command = harnessCommand(agentId, kind);
  const [started, setStarted] = useState(false);
  const jobQuery = useQuery({
    queryKey: ["harness", agentId],
    queryFn: () => harnessJob(agentId),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
  });
  const job = jobQuery.data ?? null;
  const active = started || job?.status === "running";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  const refreshed = useRef(false);
  useEffect(() => {
    if (job?.status === "running") setStarted(true);
    if (jobQuery.error)
      setError(jobQuery.error instanceof Error ? jobQuery.error.message : String(jobQuery.error));
    if (job?.status === "succeeded" && !refreshed.current) {
      refreshed.current = true;
      void refresh();
    }
  }, [job, jobQuery.error, refresh]);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [job?.output.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (busy || job?.status === "running") return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, job?.status, busy]);

  const run = async () => {
    try {
      setBusy(true);
      setError("");
      await queryClient.cancelQueries({ queryKey: ["harness", agentId] });
      const startedJob = await startHarness(agentId, kind);
      await queryClient.cancelQueries({ queryKey: ["harness", agentId] });
      queryClient.setQueryData(["harness", agentId], startedJob);
      refreshed.current = false;
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
      className="fixed inset-0 z-50 grid place-items-center bg-scrim p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="harness-title"
    >
      <div className="w-full max-w-lg rounded-2xl border bg-surface-raised p-6 shadow-lg animate-rise">
        <h2 id="harness-title" className="text-xl font-medium">
          {title}
        </h2>

        {!active ? (
          <>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-deck px-3 py-2 font-mono text-caption leading-relaxed text-deck-foreground/80">
              {command || "(no command configured)"}
            </pre>
            <p className="mt-3 text-xs leading-relaxed text-dim">
              This runs on your computer and may take a few minutes.
            </p>
            {error && <p className="mt-3 text-(length:--text-xs) text-danger">{error}</p>}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                className="btn-amber px-4 py-2 text-ui"
                disabled={busy || !command || jobQuery.isFetching}
                onClick={() => void run()}
              >
                {busy ? "Starting…" : "Run"}
              </button>
              <button
                type="button"
                className="btn-quiet ml-auto px-4 py-2 text-ui"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <pre
              ref={outputRef}
              className="mt-4 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-deck px-3 py-2 font-mono text-caption leading-relaxed text-deck-foreground/80 [overflow-wrap:anywhere]"
            >
              {(job?.output ?? []).join("\n") || "Waiting for output…"}
            </pre>
            <p className="mt-3 font-mono text-caption text-dim">
              Status: {job?.status ?? "running"}
              {typeof job?.exitCode === "number" ? ` · exit ${job.exitCode}` : ""}
            </p>
            {error && <p className="mt-2 text-(length:--text-xs) text-danger">{error}</p>}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                className="btn-quiet ml-auto px-4 py-2 text-ui"
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
