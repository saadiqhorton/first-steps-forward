import { Link, useRouterState } from "@tanstack/react-router";
import { Plus, Settings } from "lucide-react";
import { projectColor } from "@/components/ade/projectColor";
import { ProjectsMenu } from "@/components/ade/ProjectsMenu";
import { useShell } from "@/components/ade/shellContext";
import { useAde } from "@/lib/ade/store";

export function TopBar({ isDesktop }: { isDesktop: boolean }) {
  const { state } = useAde();
  const { openDialog } = useShell();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const activeFromRoute = pathname.match(/^\/p\/([^/]+)/)?.[1] ?? null;
  const activeId = activeFromRoute ?? state.activeProjectId;

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 sm:px-4">
      <Link
        to="/"
        className="shrink-0 font-display text-xl tracking-wide text-ink hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
        aria-label="ADE home"
      >
        ADE
      </Link>

      {isDesktop ? (
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {state.projects.map((p) => {
            const colors = projectColor(p.id);
            const active = p.id === activeId;
            const busy = state.sessions.some(
              (s) => s.projectId === p.id && (s.status === "working" || s.status === "verifying"),
            );
            const initial = (p.name.trim().charAt(0) || "?").toUpperCase();
            return (
              <Link
                key={p.id}
                to="/p/$projectId/conversations"
                params={{ projectId: p.id }}
                aria-current={active ? "page" : undefined}
                className={`flex max-w-[calc(18ch+2.5rem)] shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] transition-colors ${
                  active
                    ? "bg-ink/[0.06] font-medium text-ink"
                    : "text-dim hover:bg-ink/[0.04] hover:text-ink"
                }`}
              >
                <span
                  className={`grid size-5 shrink-0 place-items-center rounded font-mono text-[10px] font-semibold ${colors.bg} ${colors.fg}`}
                  aria-hidden
                >
                  {initial}
                </span>
                <span className="min-w-0 truncate" style={{ maxWidth: "18ch" }}>
                  {p.name}
                </span>
                {busy && (
                  <span className="size-1.5 shrink-0 rounded-full bg-teal" aria-label="Working" />
                )}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => openDialog("add-project")}
            aria-label="Add project"
            className="grid size-7 shrink-0 place-items-center rounded-md text-dim hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
          >
            <Plus className="size-4" aria-hidden strokeWidth={2} />
          </button>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <ProjectsMenu showActiveName />
          <button
            type="button"
            onClick={() => openDialog("add-project")}
            aria-label="Add project"
            className="grid size-7 shrink-0 place-items-center rounded-md text-dim hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
          >
            <Plus className="size-4" aria-hidden strokeWidth={2} />
          </button>
        </div>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        {isDesktop && <ProjectsMenu />}
        <button
          type="button"
          onClick={() => openDialog("agents")}
          aria-label="Agents settings"
          className="grid size-7 place-items-center rounded-md text-dim hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
        >
          <Settings className="size-3.5" aria-hidden />
        </button>
        {state.hydrated && !state.serviceAvailable && (
          <span className="hidden font-mono text-[10px] text-amber sm:inline">
            Local service disconnected
          </span>
        )}
      </div>
    </header>
  );
}
