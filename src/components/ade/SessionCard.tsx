import { Link } from "@tanstack/react-router";
import type { SessionSummary } from "@/lib/ade/types";
import { sessionTitle } from "@/lib/ade/sessionTitle";
import { needsYou, useAdeState } from "@/lib/ade/store";
import { StatusPill } from "./StatusPill";
import { TimeAgo } from "./TimeAgo";

export function SessionCard({ session, delay = 0 }: { session: SessionSummary; delay?: number }) {
  const agents = useAdeState((state) => state.agents);
  const agent = agents.find((a) => a.id === session.agentId);
  const ring = session.status === "ready" ? "ring-1 ring-teal/40" : "ring-1 ring-teal/25";
  return (
    <div className={`card-panel p-4 ${ring} animate-rise`} style={{ animationDelay: `${delay}ms` }}>
      <div className="mb-2 flex items-center gap-2">
        <StatusPill status={session.status} needsYou={needsYou(session)} />
        <span className="font-mono text-2xs text-dim">
          {agent?.short} · <TimeAgo at={session.updatedAt} />
        </span>
        <Link
          to="/sessions/$sessionId"
          params={{ sessionId: session.id }}
          className="ml-auto font-mono text-caption text-dim hover:text-ink"
        >
          Open →
        </Link>
      </div>
      <p
        className="line-clamp-2 text-sm leading-snug"
        title={session.displayRequest ?? session.request}
      >
        {sessionTitle(session.displayRequest ?? session.request, 140)}
      </p>
      {session.status === "ready" && session.summary && (
        <p className="mt-2 text-xs leading-snug text-dim">{session.summary}</p>
      )}
    </div>
  );
}
