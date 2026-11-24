import { ActivityLogs } from "@/components/ade/ActivityLogs";
import type { ThreadTrace } from "./workspaceChatTrace.mjs";

/**
 * Luna's agent activity, in the Shell's right pane — the same place a project conversation
 * keeps it.
 *
 * Deliberately the same shape as `ActivityPanel` (and the same rows): a full-height `aside`,
 * `label-section` headings, an agent-context `card-panel`, and `ActivityLogs` under "Logs".
 * A Luna thread has no project checks, so there is no Checks section. The notice, error and
 * permission entries ADE writes into a thread are already part of `trace.lines`, so they show
 * as the readable rows `ActivityLogs` builds rather than as raw JSON.
 */
export function AssistantActivityPanel({
  agentId,
  agentName,
  model,
  mode,
  workspacePath,
  status,
  trace,
  live,
}: {
  agentId?: string | undefined;
  agentName?: string | undefined;
  model?: string | undefined;
  mode: "chat" | "work";
  workspacePath?: string | undefined;
  status: string;
  trace: ThreadTrace;
  live: boolean;
}) {
  return (
    <aside
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-panel"
      aria-label="Activity"
    >
      <div className="space-y-6 px-4 py-4">
        <section>
          <h2 className="label-section">Agent context</h2>
          <div className="card-panel mt-2 px-4 py-3 text-xs">
            <dl className="grid min-w-0 grid-cols-[minmax(90px,120px)_minmax(0,1fr)] gap-x-3 gap-y-2 [overflow-wrap:anywhere]">
              <dt className="text-dim">Agent</dt>
              <dd>{agentName || agentId || "Not selected yet"}</dd>
              <dt className="text-dim">Model</dt>
              <dd className="font-mono">{model || "agent default"}</dd>
              <dt className="text-dim">Mode</dt>
              <dd>{mode === "work" ? "Work" : "Chat"}</dd>
              <dt className="text-dim">Workspace</dt>
              <dd className="font-mono">{workspacePath || "Not started yet"}</dd>
              <dt className="text-dim">Status</dt>
              <dd>{status}</dd>
            </dl>
          </div>
        </section>

        <section>
          <h2 className="label-section">Logs</h2>
          <div className="mt-2">
            {trace.count ? (
              <ActivityLogs lines={trace.lines} live={live} />
            ) : (
              <p className="text-ui text-dim">No agent activity yet.</p>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
