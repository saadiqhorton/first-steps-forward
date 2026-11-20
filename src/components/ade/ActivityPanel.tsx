import { useState } from "react";
import { ActivityLogs } from "@/components/ade/ActivityLogs";
import { ChecksList } from "@/components/ade/ChecksList";
import type { Session } from "@/lib/ade/types";
import { askConfirm, warnUser } from "@/lib/ade/userNotices";
import { useAde } from "@/lib/ade/store";

export function ActivityPanel({ session }: { session: Session }) {
  const { runChecks } = useAde();
  const [busy, setBusy] = useState(false);

  const checksClick = async () => {
    if (
      !(await askConfirm({
        title: "Run this project's detected check scripts now?",
        description: "Project scripts can execute code and may access the network.",
        confirmLabel: "Run",
      }))
    )
      return;
    setBusy(true);
    try {
      await runChecks(session.id);
    } catch (e) {
      void warnUser(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-panel"
      aria-label="Activity"
    >
      <div className="space-y-6 px-4 py-4">
        <section>
          <h2 className="label-section">Agent context</h2>
          {session.manifest ? (
            <details className="card-panel mt-2 px-4 py-3 text-xs">
              <summary className="cursor-pointer text-ui text-[var(--text-secondary)] tabular-nums select-none">
                Agent context · {session.manifest.relevantFiles.length} candidate files
              </summary>
              <dl className="mt-3 grid min-w-0 grid-cols-[minmax(90px,120px)_minmax(0,1fr)] gap-x-3 gap-y-2 [overflow-wrap:anywhere]">
                <dt className="text-dim">Project</dt>
                <dd>
                  {session.manifest.project.name} · {session.manifest.project.branch}
                </dd>
                <dt className="text-dim">Agent</dt>
                <dd>
                  {session.manifest.agent.id}
                  {session.manifest.agent.account ? ` · ${session.manifest.agent.account}` : ""}
                </dd>
                <dt className="text-dim">Model</dt>
                <dd>{session.manifest.agent.model ?? session.model ?? "agent default"}</dd>
                <dt className="text-dim">Dev server at turn start</dt>
                <dd>{session.manifest.devServer ?? "Not recorded"}</dd>
                <dt className="text-dim">Other services at turn start</dt>
                <dd>{session.manifest.otherServices ?? "Not verified by ADE"}</dd>
              </dl>
              <details className="mt-3 border-t border-line pt-2">
                <summary className="cursor-pointer text-dim">
                  Technical details · tools, safety rules, files
                </summary>
                <div className="mt-2 text-dim">Tools: {session.manifest.tools}</div>
                <ul className="mt-2 list-disc space-y-1 pl-5 [overflow-wrap:anywhere]">
                  {session.manifest.constraints.map((constraint) => (
                    <li key={constraint}>{constraint}</li>
                  ))}
                </ul>
                <div className="mt-3 text-dim">Candidate files</div>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">
                  {session.manifest.relevantFiles.join("\n") || "(none listed)"}
                </pre>
              </details>
            </details>
          ) : (
            <p className="mt-2 text-xs text-dim">No agent context yet.</p>
          )}
        </section>

        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="label-section">
              Checks{" "}
              <span className="font-mono font-normal tabular-nums text-dim">
                {session.checks.length}
              </span>
            </h2>
            {session.status === "ready" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void checksClick()}
                className="btn-amber px-3 py-1.5 text-xs"
              >
                {busy ? "Running…" : "Run project checks"}
              </button>
            ) : null}
          </div>
          <div className="mt-2">
            <ChecksList checks={session.checks} />
            {session.status === "blocked" ? (
              <p className="mt-3 text-xs text-dim">
                Checks run once the session is ready to review. Clear the blocker above —
                re-authenticate, switch agents, or send a follow-up — then run them here.
              </p>
            ) : null}
            {session.status === "working" || session.status === "verifying" ? (
              <p className="mt-3 text-xs text-dim">
                Checks are available after this turn finishes and the session is ready to review.
              </p>
            ) : null}
            {session.status === "complete" || session.status === "stopped" ? (
              <p className="mt-3 text-xs text-dim">
                Reopen or keep the session in “ready to review” to run project checks again.
              </p>
            ) : null}
          </div>
        </section>

        <section>
          <h2 className="label-section">Logs</h2>
          <div className="mt-2">
            <ActivityLogs
              lines={session.logs}
              live={session.status === "working" || session.status === "verifying"}
              // The same words as the status line above the conversation.
              {...(session.status === "verifying" ? { activity: "Running checks" } : {})}
            />
          </div>
        </section>
      </div>
    </aside>
  );
}
