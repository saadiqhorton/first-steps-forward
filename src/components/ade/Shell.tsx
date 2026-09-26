import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { isActive, useAde } from "@/lib/ade/store";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/history", label: "History" },
  { to: "/processes", label: "Processes" },
  { to: "/agents", label: "Agents" },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const { state, selectProject } = useAde();
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        navigate({ to: "/tasks/new" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-paper text-ink">
      <div className="flex h-9 shrink-0 items-center justify-between bg-ink/90 px-4 text-paper">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em]">
          ADE · local-first agent workspace
        </span>
        <span className="flex items-center gap-4 font-mono text-[11px] text-paper/60">
          {state.hydrated && !state.serviceAvailable && (
            <span className="text-amber">Local service disconnected</span>
          )}
          <span>⌘K new task</span>
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside
          className="flex w-56 shrink-0 flex-col border-r border-line bg-panel"
          aria-label="Projects"
        >
          <div className="px-4 pt-5 pb-2">
            <div className="font-display text-2xl leading-none tracking-wide">Projects</div>
            <div className="label-mono mt-1 tracking-[0.16em]">
              {state.projects.length} on this machine
            </div>
          </div>
          <div className="space-y-1 px-3">
            {state.projects.map((p) => {
              const active = p.id === state.activeProjectId;
              const sessions = state.sessions.filter((s) => s.projectId === p.id && isActive(s));
              const running = state.processes.some(
                (x) => x.projectId === p.id && x.status === "running",
              );
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    selectProject(p.id);
                    navigate({ to: "/" });
                  }}
                  aria-current={active ? "true" : undefined}
                  className={`w-full rounded-md px-3 py-2 text-left transition-colors ${active ? "bg-amber/10 ring-1 ring-amber/25" : "hover:bg-ink/[0.04]"}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-2 shrink-0 rounded-full ${running ? "bg-teal" : "bg-dim"}`}
                      aria-hidden
                    />
                    <span className={`text-[13px] ${active ? "font-medium" : ""}`}>{p.name}</span>
                    {sessions.length > 0 && (
                      <span className="ml-auto font-mono text-[10px] text-dim">
                        {sessions.length}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 pl-4 font-mono text-[10px] text-dim">
                    {p.path}
                    {p.missing ? " · missing" : ""}
                  </div>
                </button>
              );
            })}
            <Link
              to="/projects/add"
              className="block rounded-md px-3 py-2 text-[12px] text-dim hover:bg-ink/[0.04] hover:text-ink"
            >
              + Add project
            </Link>
          </div>

          <nav className="mt-6 px-3" aria-label="Workspace">
            <div className="label-mono px-3 pb-1 tracking-[0.16em]">Workspace</div>
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                activeOptions={{ exact: n.to === "/" }}
                activeProps={{ className: "bg-ink/[0.06] font-medium" }}
                className="block rounded-md px-3 py-1.5 text-[13px] hover:bg-ink/[0.04]"
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="mt-auto p-3">
            <div className="rounded-md bg-ink px-3 py-2 text-center">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper/70">
                Open source · free
              </span>
            </div>
          </div>
        </aside>

        {children}
      </div>

      <footer className="flex h-8 shrink-0 items-center justify-between bg-ink px-4 text-paper/55">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
          ADE — start with the task · Codex · OpenCode · Pi Agent
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em]">
          Loopback only · No ADE account · No hosted service
        </span>
      </footer>
    </div>
  );
}
