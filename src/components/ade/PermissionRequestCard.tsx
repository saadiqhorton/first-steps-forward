import { useState } from "react";
import { warnUser } from "@/components/ade/NoticeDialog";
import { useAde } from "@/lib/ade/store";
import type { PendingPermission } from "@/lib/ade/types";

/**
 * An ACP agent's permission request. The turn is paused until one of the
 * agent's own options is chosen; ADE adds none of its own. Title, detail and
 * option names are agent-supplied and rendered as plain text.
 */
export function PermissionRequestCard({
  sessionId,
  request,
  agentName,
}: {
  sessionId: string;
  request: PendingPermission;
  agentName: string;
}) {
  const { answerPermission } = useAde();
  const [busy, setBusy] = useState<string | null>(null);
  const answer = async (optionId: string) => {
    if (busy) return;
    setBusy(optionId);
    try {
      await answerPermission(sessionId, request.id, optionId);
    } catch (e) {
      void warnUser(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const remembers = request.options.some((o) => o.kind.endsWith("_always"));
  return (
    <div
      className="card-panel p-4 ring-1 ring-amber/50"
      role="group"
      aria-label="Permission request"
    >
      <div className="label-section text-amber-deep">{agentName} is asking for permission</div>
      <p className="mt-1 text-[13px] font-medium break-words">{request.title}</p>
      {request.detail && request.detail !== request.title && (
        <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-deck p-2 font-mono text-xs whitespace-pre-wrap break-all text-deck-foreground">
          {request.detail}
        </pre>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {request.options.map((option) => (
          <button
            key={option.optionId}
            type="button"
            disabled={busy !== null}
            onClick={() => void answer(option.optionId)}
            className={`${option.kind === "allow_once" ? "btn-amber" : "btn-quiet"} px-3 py-1.5 text-xs disabled:opacity-60`}
          >
            {busy === option.optionId ? "Sending…" : option.name}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-dim">
        The agent is paused until you answer.
        {remembers && ` "Always" choices are saved by ${agentName} itself, not by ADE.`}
      </p>
    </div>
  );
}
