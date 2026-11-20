import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { GlideIndicator } from "@/components/ade/motion";
import { documentsQuery, entriesQuery, workflowsQuery } from "@/lib/ade/queries";
import {
  projectIdFromPath,
  projectSectionFromPath,
  type ProjectSection,
} from "@/lib/ade/navigation";
import { useAppPathname } from "@/lib/ade/useAppPathname";
import { useAdeState } from "@/lib/ade/store";
import { needsAttention } from "@/lib/ade/viewed";

export function SectionTabs() {
  const { activeProjectId, projects, sessions } = useAdeState((state) => ({
    activeProjectId: state.activeProjectId,
    projects: state.projects,
    sessions: state.sessions,
  }));
  const queryClient = useQueryClient();
  const pathname = useAppPathname();
  // The prerendered shell can still report `/` on a direct load of a workspace
  // page. Match the route as well so project tabs never flash above it.
  const workspaceRoute = useRouterState({
    select: (state) =>
      state.matches.some(
        (match) => match.pathname === "/workspace" || match.pathname.startsWith("/workspace/"),
      ),
  });
  const projectId = projectIdFromPath(pathname) ?? activeProjectId;
  const routeSection = projectSectionFromPath(pathname);
  // Optimistic selection so the highlight moves on click, not after the route settles.
  const [pendingSection, setPendingSection] = useState<ProjectSection | null>(null);
  const activeSection = pendingSection ?? routeSection;

  useEffect(() => {
    if (pendingSection && routeSection === pendingSection) setPendingSection(null);
  }, [pendingSection, routeSection]);

  useEffect(() => {
    // Only warm sections from a real project URL; redirect pages (/processes, /)
    // have no project path yet and preloading during the redirect races the router.
    if (!projectId || !projectIdFromPath(pathname)) return;
    // Warm sibling section code and data so the first click renders without a loading flash.
    void queryClient.prefetchQuery(workflowsQuery());
    void queryClient.prefetchQuery(documentsQuery(projectId));
    void queryClient.prefetchQuery(entriesQuery(projectId));
  }, [projectId, pathname, queryClient]);

  if (
    workspaceRoute ||
    pathname.startsWith("/workspace") ||
    !projectId ||
    !projects.some((p) => p.id === projectId)
  )
    return null;

  const needsInput = sessions.filter((s) => s.projectId === projectId && needsAttention(s)).length;

  const linkClass = (active: boolean) =>
    `relative isolate inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-ui transition-colors ${
      active ? "font-medium text-ink" : "text-dim hover:bg-ink/[0.04] hover:text-ink"
    }`;
  const highlight = (
    <GlideIndicator
      id="section-tab"
      spring="snappy"
      className="absolute inset-0 -z-10 rounded-lg bg-ink/[0.06]"
    />
  );

  return (
    <nav
      aria-label="Project sections"
      className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-paper px-3 [scrollbar-width:none] sm:px-4 [&::-webkit-scrollbar]:hidden"
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
          <span className="rounded bg-amber/20 px-1.5 py-0.5 font-mono text-2xs text-amber-deep">
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
      <Link
        to="/p/$projectId/skills"
        params={{ projectId }}
        preload="intent"
        aria-current={activeSection === "skills" ? "page" : undefined}
        onClick={() => setPendingSection("skills")}
        className={linkClass(activeSection === "skills")}
      >
        {activeSection === "skills" && highlight}
        Skills
      </Link>
      <Link
        to="/p/$projectId/processes"
        params={{ projectId }}
        preload="intent"
        aria-current={activeSection === "processes" ? "page" : undefined}
        onClick={() => setPendingSection("processes")}
        className={linkClass(activeSection === "processes")}
      >
        {activeSection === "processes" && highlight}
        Processes
      </Link>
    </nav>
  );
}
