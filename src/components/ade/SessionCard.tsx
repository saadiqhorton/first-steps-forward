import { Link } from "@tanstack/react-router";
import type { Session } from "@/lib/ade/types";
import { NEEDS_YOU, timeAgo, useAde } from "@/lib/ade/store";
import { StatusPill } from "./StatusPill";

export function SessionCard({ session, delay = 0 }: { session: Session; delay?: number }) {
  const { state, answer, decide } = useAde();
  const agent = state.agents.find((a) => a.id === session.agentId);
  const needs = NEEDS_YOU.includes(session.status);
  const ring = needs ? "ring-1 ring-amber/30" : session.status === "ready" ? "ring-1 ring-teal/40" : "ring-1 ring-teal/25";

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
          className="ml-auto font-mono text-[10px] uppercase tracking-[0.16em] text-dim hover:text-ink"
        >
          Open →
        </Link>
      </div>
      <p className="text-[14px] leading-snug">
        {session.status === "needs_input" && session.question ? session.question.text : session.request}
      </p>
      {session.status === "needs_input" && session.question && (
        <div className="mt-3 flex flex-wrap gap-2">
          {session.question.options.map((o, i) => (
            <button
              key={o}
              onClick={() => answer(session.id, o)}
              className={`px-3 py-1.5 text-[12px] font-medium ${i === 0 ? "btn-amber" : "btn-quiet"}`}
            >
              {o}
            </button>
          ))}
        </div>
      )}
      {session.status === "awaiting_approval" && session.approval && (
        <div className="mt-3 rounded-md bg-amber/10 p-3 text-[12px] leading-snug">
          <div className="font-semibold">{session.approval.action}</div>
          <div className="text-dim">Scope: {session.approval.scope}</div>
          <div className="mt-2 flex gap-2">
            <button onClick={() => decide(session.id, true)} className="btn-amber px-3 py-1.5 text-[12px]">
              Allow this once
            </button>
            <button onClick={() => decide(session.id, false)} className="btn-quiet px-3 py-1.5 text-[12px]">
              Don't allow
            </button>
          </div>
        </div>
      )}
      {session.status === "ready" && session.summary && (
        <p className="mt-2 text-[12px] leading-snug text-dim">{session.summary}</p>
      )}
    </div>
  );
}
