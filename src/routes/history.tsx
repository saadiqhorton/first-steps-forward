import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { readLastProject } from "@/lib/ade/navigation";
import { useAdeState } from "@/lib/ade/store";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History — ADE" },
      {
        name: "description",
        content: "Search and reopen past agent sessions across all your projects.",
      },
      { property: "og:title", content: "History — ADE" },
      { property: "og:description", content: "Every task session, kept and searchable." },
    ],
  }),
  component: HistoryRedirect,
});

function HistoryRedirect() {
  const state = useAdeState((state) => ({ hydrated: state.hydrated, projects: state.projects }));
  const navigate = useNavigate();

  useEffect(() => {
    if (!state.hydrated) return;
    if (!state.projects.length) {
      void navigate({ to: "/", replace: true });
      return;
    }
    const last = readLastProject();
    const projectId =
      (last && state.projects.some((p) => p.id === last) ? last : null) ?? state.projects[0]!.id;
    void navigate({
      to: "/p/$projectId/conversations",
      params: { projectId },
      search: { completed: true },
      replace: true,
    });
  }, [state.hydrated, state.projects, navigate]);

  return <main className="flex-1" />;
}
