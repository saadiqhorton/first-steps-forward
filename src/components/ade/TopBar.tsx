import { Link, useRouterState } from "@tanstack/react-router";
import { Plus, Settings } from "lucide-react";
import { GlideIndicator } from "@/components/ade/motion";
import { projectColor } from "@/components/ade/projectColor";
import { ProjectsMenu } from "@/components/ade/ProjectsMenu";
import { useShell } from "@/components/ade/shellContext";
import { ThemeSwitch } from "@/components/arc/theme-switch/theme-switch";
import { useAdeState } from "@/lib/ade/store";
import { useTheme } from "@/lib/theme";

export function TopBar({ isDesktop }: { isDesktop: boolean }) {
  const { activeProjectId, hydrated, projects, serviceAvailable, sessions } = useAdeState(
    (state) => ({
      activeProjectId: state.activeProjectId,
      hydrated: state.hydrated,
      projects: state.projects,
      serviceAvailable: state.serviceAvailable,
      sessions: state.sessions,
    }),
  );
  const { openDialog } = useShell();
  const { theme, setTheme } = useTheme();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const activeFromRoute = pathname.match(/^\/p\/([^/]+)/)?.[1] ?? null;
  const activeId = activeFromRoute ?? activeProjectId;

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 sm:px-4">
      <Link
        to="/"
        className="heading-display shrink-0 text-xl text-ink hover:text-ink"
        aria-label="ADE home"
      >
        ADE
      </Link>

      {isDesktop ? (
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {projects.map((p) => {
            const colors = projectColor(p.id);
            const active = p.id === activeId;
            const busy = sessions.some(
              (s) => s.projectId === p.id && (s.status === "working" || s.status === "verifying"),
            );
            const initial = (p.name.trim().charAt(0) || "?").toUpperCase();
            return (
              <Link
                key={p.id}
                to="/p/$projectId/conversations"
                params={{ projectId: p.id }}
                aria-current={active ? "page" : undefined}
                className={`relative isolate flex max-w-[calc(18ch+2.5rem)] shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] transition-colors ${
                  active ? "font-medium text-ink" : "text-dim hover:bg-ink/[0.04] hover:text-ink"
                }`}
              >
                {active && (
                  <GlideIndicator
                    id="top-bar-project"
                    className="absolute inset-0 -z-10 rounded-md bg-ink/[0.06]"
                  />
                )}
                <span
                  className={`grid size-5 shrink-0 place-items-center rounded-xs font-mono text-[10px] font-medium ${colors.bg} ${colors.fg}`}
                  aria-hidden
                >
                  {initial}
                </span>
                <span className="min-w-0 truncate" style={{ maxWidth: "18ch" }}>
                  {p.name}
                </span>
                {busy && (
                  <span
                    className="size-1.5 shrink-0 animate-pulse-soft rounded-full bg-teal"
                    aria-label="Working"
                  />
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
        <ThemeSwitch
          theme={theme}
          variant="rise"
          iconOnly
          onThemeChange={(next) => setTheme(next)}
        />
        {hydrated && !serviceAvailable && (
          <span className="hidden font-mono text-[10px] text-amber sm:inline">
            Local service disconnected
          </span>
        )}
      </div>
    </header>
  );
}
