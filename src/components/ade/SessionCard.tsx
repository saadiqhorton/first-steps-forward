import { Link } from "@tanstack/react-router";
import type { Session } from "@/lib/ade/types";
import { sessionTitle } from "@/lib/ade/sessionTitle";
import { timeAgo, useAde } from "@/lib/ade/store";
import { StatusPill } from "./StatusPill";

export function SessionCard({ session, delay = 0 }: { session: Session; delay?: number }) {
  const { state } = useAde();
  const agent = state.agents.find((a) => a.id === session.agentId);
  const ring = session.status === "ready" ? "ring-1 ring-teal/40" : "ring-1 ring-teal/25";
  return (
    <div className={`card-panel p-4 ${ring} animate-rise`} style={{ animationDelay: `${delay}ms` }}>
      <div className="mb-2 flex items-center gap-2">
        <StatusPill status={session.status} />
        <span className="font-mono text-[10px] text-dim">
          {agent?.short} · {timeAgo(state.now, session.updatedAt)}
        </span>
        <Link
          to="/sessions/$sessionId"
          params={{ sessionId: session.id }}
          className="ml-auto font-mono text-[11px] text-dim hover:text-ink"
        >
          Open →
        </Link>
      </div>
      <p className="line-clamp-2 text-[14px] leading-snug" title={session.request}>
        {sessionTitle(session.request, 140)}
      </p>
      {session.status === "ready" && session.summary && (
        <p className="mt-2 text-[12px] leading-snug text-dim">{session.summary}</p>
      )}
    </div>
  );
}
