import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { StatusPill } from "@/components/ade/StatusPill";
import { timeAgo, useAde } from "@/lib/ade/store";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History — ADE" },
      { name: "description", content: "Search and reopen past agent sessions across all your projects." },
      { property: "og:title", content: "History — ADE" },
      { property: "og:description", content: "Every task session, kept and searchable." },
    ],
  }),
  component: History,
});

function History() {
  const { state, reopen } = useAde();
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"all" | "active">("all");
  const needle = q.trim().toLowerCase();
  const rows = state.sessions
    .filter((s) => (scope === "all" ? true : s.status !== "complete"))
    .filter((s) => {
      if (!needle) return true;
      const p = state.projects.find((x) => x.id === s.projectId)?.name ?? "";
      return [s.request, s.summary ?? "", p, ...s.changes.map((c) => c.path)].join(" ").toLowerCase().includes(needle);
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="px-7 pt-6 pb-4">
        <div className="label-mono">All projects</div>
        <h1 className="mt-1 font-display text-[44px] leading-[0.9] tracking-wide">History</h1>
        <p className="mt-1 text-[12px] text-dim">Completed sessions leave the home view but are never deleted. Search by request, summary, project, or file.</p>
        <div className="mt-4 flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search sessions…"
            aria-label="Search sessions"
            className="flex-1 rounded-md border border-line bg-panel px-3 py-2 text-[13px] placeholder:text-dim/70 focus:border-amber"
          />
          <button onClick={() => setScope(scope === "all" ? "active" : "all")} className="btn-quiet px-3 py-2 font-mono text-[11px]">
            {scope === "all" ? "Showing all" : "Hiding completed"}
          </button>
        </div>
      </div>
      <div className="px-7 pb-8">
        {rows.length === 0 ? (
          <p className="text-[12px] text-dim">No sessions match.</p>
        ) : (
          <div className="card-panel divide-y divide-line">
            {rows.map((s) => {
              const p = state.projects.find((x) => x.id === s.projectId);
              const a = state.agents.find((x) => x.id === s.createdBy);
              return (
                <div key={s.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <StatusPill status={s.status} />
                      <span className="font-mono text-[10px] text-dim">
                        {p?.name} · {a?.short} · {timeAgo(state.now, s.updatedAt)}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-[13px]">{s.request}</div>
                    {s.summary && <div className="truncate text-[11px] text-dim">{s.summary}</div>}
                  </div>
                  <span className="font-mono text-[10px] text-dim">{s.changes.length} files</span>
                  {s.status === "complete" && (
                    <button onClick={() => reopen(s.id)} className="btn-quiet px-3 py-1.5 text-[12px]">
                      Reopen
                    </button>
                  )}
                  <Link to="/sessions/$sessionId" params={{ sessionId: s.id }} className="btn-quiet px-3 py-1.5 text-[12px]">
                    Open
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
