import { useState } from "react";
import { ChecksList } from "@/components/ade/ChecksList";
import { DiffView } from "@/components/ade/DiffView";
import type { Session } from "@/lib/ade/types";
import { useAde } from "@/lib/ade/store";

export function ActivityPanel({ session }: { session: Session }) {
  const { runChecks } = useAde();
  const [busy, setBusy] = useState(false);

  const checksClick = async () => {
    if (
      !window.confirm(
        "Run this project's detected check scripts now? Project scripts can execute code and may access the network.",
      )
    )
      return;
    setBusy(true);
    try {
      await runChecks(session.id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const filesLabel = session.changeCountUnavailable
    ? "Files changed"
    : `Files changed (${session.changes.length})`;

  return (
    <aside
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto bg-panel"
      aria-label="Activity"
    >
      <div className="space-y-6 px-4 py-4">
        <section>
          <h2 className="label-mono">Agent context</h2>
          {session.manifest ? (
            <details className="card-panel mt-2 px-4 py-3 text-[12px]">
              <summary className="label-mono cursor-pointer select-none">
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
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed [overflow-wrap:anywhere]">
                  {session.manifest.relevantFiles.join("\n") || "(none listed)"}
                </pre>
              </details>
            </details>
          ) : (
            <p className="mt-2 text-[12px] text-dim">No agent context yet.</p>
          )}
        </section>

        <section>
          <h2 className="label-mono">{filesLabel}</h2>
          <div className="mt-2">
            <DiffView changes={session.changes} unavailable={!!session.changeCountUnavailable} />
          </div>
        </section>

        <section>
          <h2 className="label-mono">Checks ({session.checks.length})</h2>
          <div className="mt-2">
            <ChecksList checks={session.checks} />
            {session.status === "ready" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void checksClick()}
                className="btn-quiet mt-3 px-3 py-1.5 text-[12px]"
              >
                {busy ? "Running…" : "Run project checks"}
              </button>
            )}
            {session.status === "blocked" && (
              <p className="mt-3 text-[12px] text-dim">
                Checks run once the session is ready to review. Clear the blocker above —
                re-authenticate, switch agents, or send a follow-up — then run them here.
              </p>
            )}
          </div>
        </section>

        <section>
          <h2 className="label-mono">Logs ({session.logs.length})</h2>
          <div className="mt-2">
            {session.logs.length ? (
              <pre className="whitespace-pre-wrap break-words rounded-md bg-ink px-3 py-2 font-mono text-[11px] leading-relaxed text-paper/80 [overflow-wrap:anywhere]">
                {session.logs.join("\n")}
              </pre>
            ) : (
              <p className="text-[12px] text-dim">No CLI output yet.</p>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
