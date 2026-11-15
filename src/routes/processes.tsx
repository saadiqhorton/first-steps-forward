import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { readLastProject } from "@/lib/ade/navigation";
import { useAdeState } from "@/lib/ade/store";

export const Route = createFileRoute("/processes")({
  head: () => ({
    meta: [
      { title: "Processes — ADE" },
      {
        name: "description",
        content: "Every server and long job ADE started for this project, with its output.",
      },
      { property: "og:title", content: "Processes — ADE" },
      {
        property: "og:description",
        content: "Every local process, grouped by the conversation that started it.",
      },
    ],
  }),
  component: ProcessesRedirect,
});

function ProcessesRedirect() {
  const state = useAdeState((state) => ({
    hydrated: state.hydrated,
    projects: state.projects,
  }));
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
      to: "/p/$projectId/processes",
      params: { projectId },
      replace: true,
    });
  }, [state.hydrated, state.projects, navigate]);

  return <main className="flex-1" />;
}
