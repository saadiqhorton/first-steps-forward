import { useState } from "react";
import { warnUser } from "@/lib/ade/userNotices";
import type { DevCommandRequest } from "@/lib/ade/types";

/**
 * ADE's own question when an agent proposes a dev command for a project without a package.json
 * dev script. Allow stores it for the project, so ADE runs it (outside the agent's sandbox, as
 * the user) on every later start without asking again. The command and folder are
 * agent-supplied and rendered verbatim as plain text.
 */
export function DevCommandRequestCard({
  request,
  onAnswer,
}: {
  request: DevCommandRequest;
  onAnswer: (allow: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const answer = async (allow: boolean) => {
    if (busy) return;
    setBusy(allow ? "allow" : "deny");
    try {
      await onAnswer(allow);
    } catch (e) {
      void warnUser(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div
      className="card-panel p-4 ring-1 ring-amber/50"
      role="group"
      aria-label="Dev command request"
    >
      <p className="text-[13px] font-medium">Run this dev command?</p>
      <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-deck p-2 font-mono text-xs whitespace-pre-wrap break-all text-deck-foreground">
        {request.command}
      </pre>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-dim">Folder</dt>
        <dd className="font-mono break-all">{request.cwd}</dd>
        {request.port !== undefined && (
          <>
            <dt className="text-dim">Port</dt>
            <dd className="font-mono tabular-nums">{request.port}</dd>
          </>
        )}
      </dl>
      <p className="mt-2 text-xs leading-snug text-dim">
        ADE runs it outside the agent&apos;s sandbox, as you, whenever the agent starts this
        project&apos;s dev server
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void answer(true)}
          className="btn-amber px-3 py-1.5 text-xs disabled:opacity-60"
        >
          {busy === "allow" ? "Sending…" : "Allow"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void answer(false)}
          className="btn-quiet px-3 py-1.5 text-xs disabled:opacity-60"
        >
          {busy === "deny" ? "Sending…" : "Deny"}
        </button>
      </div>
    </div>
  );
}
