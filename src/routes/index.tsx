import { Link, createFileRoute } from "@tanstack/react-router";
import { PreviewPane } from "@/components/ade/PreviewPane";
import { SessionCard } from "@/components/ade/SessionCard";
import { NEEDS_YOU, isActive, timeAgo, useActiveProject, useAde } from "@/lib/ade/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ADE — Project home" },
      { name: "description", content: "See your preview, active agent sessions, and recent changes for the current project in one calm workspace." },
      { property: "og:title", content: "ADE — Project home" },
      { property: "og:description", content: "A free, local-first workspace for building software with AI coding agents." },
    ],
  }),
  component: ProjectHome,
});

function ProjectHome() {
  const { state, process } = useAde();
  const project = useActiveProject();
  const sessions = state.sessions.filter((s) => s.projectId === project.id);
  const active = sessions
    .filter(isActive)
    .sort((a, b) => Number(NEEDS_YOU.includes(b.status)) - Number(NEEDS_YOU.includes(a.status)) || b.updatedAt - a.updatedAt);
  const done = sessions.filter((s) => s.status === "complete").sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)).slice(0, 5);
  const dev = state.processes.find((p) => p.projectId === project.id && p.port > 0);
  const running = dev?.status === "running";
  const focus = active[0];

  return (
    <>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-start justify-between gap-6 px-7 pt-6 pb-4">
          <div>
            <div className="label-mono">
              {project.name} · {project.branch}
              {project.ahead ? ` · ${project.ahead} ahead` : ""}
              {project.uncommittedFiles.length ? ` · ${project.uncommittedFiles.length} uncommitted` : ""}
            </div>
            <h1 className="mt-1 font-display text-[44px] leading-[0.9] tracking-wide">{project.name}</h1>
            <div className="mt-1 font-mono text-[11px] text-dim">{project.path}</div>
          </div>
          <Link to="/tasks/new" className="btn-amber shrink-0 self-center px-4 py-2 text-[13px]">
            + New task
          </Link>
        </header>

        <div className="space-y-4 overflow-y-auto px-7 pb-8">
          <div className="grain relative overflow-hidden rounded-lg bg-ink p-4 text-paper ring-1 ring-ink/20 animate-rise">
            <div className={`absolute inset-y-0 left-0 w-1 ${running ? "bg-amber" : "bg-dim"}`} />
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${running ? "bg-teal animate-pulse-soft" : "bg-dim"}`} aria-hidden />
              <span className={`font-mono text-[11px] uppercase tracking-[0.16em] ${running ? "text-teal" : "text-paper/60"}`}>
                {dev ? `${dev.name} ${running ? "running" : "stopped"}` : "No dev server configured"}
              </span>
              {running && dev?.startedAt && <span className="ml-auto font-mono text-[10px] text-paper/50">up {timeAgo(state.now, dev.startedAt).replace(" ago", "")}</span>}
            </div>
            <div className="mt-2 font-mono text-[15px]">{running ? `http://localhost:${dev?.port}` : dev ? dev.command : "—"}</div>
            <div className="mt-1 font-mono text-[10px] text-paper/50">Local only · not reachable by anyone else</div>
            {dev && (
              <div className="relative mt-3 flex gap-2">
                {running ? (
                  <>
                    <a href={`http://localhost:${dev.port}`} target="_blank" rel="noreferrer" className="btn-ink-ghost px-3 py-1.5 text-[12px]">
                      Open
                    </a>
                    <button onClick={() => process(dev.id, "stop")} className="btn-ink-ghost px-3 py-1.5 text-[12px]">
                      Stop
                    </button>
                  </>
                ) : (
                  <button onClick={() => process(dev.id, "start")} className="btn-ink-ghost px-3 py-1.5 text-[12px]">
                    Start
                  </button>
                )}
                <Link to="/processes" className="btn-ink-ghost px-3 py-1.5 text-[12px]">
                  Output
                </Link>
              </div>
            )}
          </div>

          <section aria-labelledby="active-h">
            <div id="active-h" className="label-mono mb-2">
              Active work {active.length ? `· ${active.length}` : ""}
            </div>
            {active.length === 0 ? (
              <div className="card-panel p-5 text-center animate-rise">
                <p className="text-[14px]">Nothing in progress.</p>
                <p className="mt-1 text-[12px] text-dim">Describe a change in plain language and an agent will get started.</p>
                <Link to="/tasks/new" className="btn-amber mt-3 inline-block px-4 py-2 text-[13px]">
                  + New task
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {active.map((s, i) => (
                  <SessionCard key={s.id} session={s} delay={90 + i * 70} />
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="done-h">
            <div id="done-h" className="label-mono mb-2">
              Recently completed
            </div>
            {done.length === 0 ? (
              <p className="text-[12px] text-dim">Completed tasks will show up here.</p>
            ) : (
              <div className="card-panel divide-y divide-line ring-1 ring-ink/5 animate-rise" style={{ animationDelay: "230ms" }}>
                {done.map((s) => (
                  <Link key={s.id} to="/sessions/$sessionId" params={{ sessionId: s.id }} className="flex items-center gap-3 px-4 py-3 hover:bg-ink/[0.03]">
                    <span className="size-2 shrink-0 rounded-full bg-teal" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]">{s.summary ?? s.request}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-dim">
                        {s.changes.length} files changed · {timeAgo(state.now, s.completedAt)} · {state.agents.find((a) => a.id === s.createdBy)?.short}
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-dim">View →</span>
                  </Link>
                ))}
                <Link to="/history" className="block px-4 py-2 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-dim hover:text-ink">
                  All history
                </Link>
              </div>
            )}
          </section>
        </div>
      </main>
      <PreviewPane project={project} session={focus} />
    </>
  );
}
