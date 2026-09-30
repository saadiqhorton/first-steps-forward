import { Link, useRouterState } from "@tanstack/react-router";
import { useAde } from "@/lib/ade/store";

export function SectionTabs() {
  const { state } = useAde();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const match = pathname.match(/^\/p\/([^/]+)/);
  const projectId = match?.[1] ?? state.activeProjectId;

  if (!projectId || !state.projects.some((p) => p.id === projectId)) return null;

  const needsInput = state.sessions.filter(
    (s) => s.projectId === projectId && (s.status === "ready" || s.status === "blocked"),
  ).length;

  const linkClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] transition-colors ${
      active ? "bg-ink/[0.06] font-medium text-ink" : "text-dim hover:bg-ink/[0.04] hover:text-ink"
    }`;

  const onConversations = pathname.includes(`/p/${projectId}/conversations`);
  const onFiles = pathname.includes(`/p/${projectId}/files`);
  const onWorkflows = pathname.includes(`/p/${projectId}/workflows`);

  return (
    <nav
      aria-label="Project sections"
      className="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-paper px-3 sm:px-4"
    >
      <Link
        to="/p/$projectId/conversations"
        params={{ projectId }}
        aria-current={onConversations ? "page" : undefined}
        className={linkClass(onConversations)}
      >
        Conversations
        {needsInput > 0 && (
          <span className="rounded bg-amber/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-deep">
            {needsInput}
          </span>
        )}
      </Link>
      <Link
        to="/p/$projectId/files"
        params={{ projectId }}
        aria-current={onFiles ? "page" : undefined}
        className={linkClass(onFiles)}
      >
        Files
      </Link>
      <Link
        to="/p/$projectId/workflows"
        params={{ projectId }}
        aria-current={onWorkflows ? "page" : undefined}
        className={linkClass(onWorkflows)}
      >
        Workflows
      </Link>
    </nav>
  );
}
