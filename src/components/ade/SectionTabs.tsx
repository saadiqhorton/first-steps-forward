import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { GlideIndicator } from "@/components/ade/motion";
import { documentsQuery, entriesQuery, workflowsQuery } from "@/lib/ade/queries";
import { needsYou, useAde } from "@/lib/ade/store";

type Section = "conversations" | "files" | "workflows";

function sectionFromPath(pathname: string, projectId: string): Section | null {
  if (pathname.includes(`/p/${projectId}/conversations`)) return "conversations";
  if (pathname.includes(`/p/${projectId}/files`)) return "files";
  if (pathname.includes(`/p/${projectId}/workflows`)) return "workflows";
  return null;
}

export function SectionTabs() {
  const { state } = useAde();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const match = pathname.match(/^\/p\/([^/]+)/);
  const projectId = match?.[1] ?? state.activeProjectId;
  const routeSection = projectId ? sectionFromPath(pathname, projectId) : null;
  // Optimistic selection so the highlight moves on click, not after the route settles.
  const [pendingSection, setPendingSection] = useState<Section | null>(null);
  const activeSection = pendingSection ?? routeSection;

  useEffect(() => {
    if (pendingSection && routeSection === pendingSection) setPendingSection(null);
  }, [pendingSection, routeSection]);

  useEffect(() => {
    if (!projectId) return;
    // Warm sibling section code and data so the first click renders without a loading flash.
    void router.preloadRoute({ to: "/p/$projectId/files", params: { projectId } });
    void router.preloadRoute({ to: "/p/$projectId/workflows", params: { projectId } });
    void router.preloadRoute({ to: "/p/$projectId/conversations", params: { projectId } });
    void queryClient.prefetchQuery(workflowsQuery());
    void queryClient.prefetchQuery(documentsQuery(projectId));
    void queryClient.prefetchQuery(entriesQuery(projectId));
  }, [projectId, router, queryClient]);

  if (!projectId || !state.projects.some((p) => p.id === projectId)) return null;

  const needsInput = state.sessions.filter(
    (s) =>
      s.projectId === projectId && (s.status === "ready" || s.status === "blocked" || needsYou(s)),
  ).length;

  const linkClass = (active: boolean) =>
    `relative isolate inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] transition-colors ${
      active ? "font-medium text-ink" : "text-dim hover:bg-ink/[0.04] hover:text-ink"
    }`;
  const highlight = (
    <GlideIndicator
      id="section-tab"
      spring="snappy"
      className="absolute inset-0 -z-10 rounded-md bg-ink/[0.06]"
    />
  );

  return (
    <nav
      aria-label="Project sections"
      className="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-paper px-3 sm:px-4"
    >
      <Link
        to="/p/$projectId/conversations"
        params={{ projectId }}
        preload="intent"
        aria-current={activeSection === "conversations" ? "page" : undefined}
        onClick={() => setPendingSection("conversations")}
        className={linkClass(activeSection === "conversations")}
      >
        {activeSection === "conversations" && highlight}
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
        preload="intent"
        aria-current={activeSection === "files" ? "page" : undefined}
        onClick={() => setPendingSection("files")}
        className={linkClass(activeSection === "files")}
      >
        {activeSection === "files" && highlight}
        Files
      </Link>
      <Link
        to="/p/$projectId/workflows"
        params={{ projectId }}
        preload="intent"
        aria-current={activeSection === "workflows" ? "page" : undefined}
        onClick={() => setPendingSection("workflows")}
        className={linkClass(activeSection === "workflows")}
      >
        {activeSection === "workflows" && highlight}
        Workflows
      </Link>
    </nav>
  );
}
