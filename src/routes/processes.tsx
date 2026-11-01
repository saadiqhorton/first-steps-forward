import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { readLastProject } from "@/lib/ade/navigation";
import { useAde } from "@/lib/ade/store";

export const Route = createFileRoute("/processes")({
  head: () => ({
    meta: [
      { title: "Processes — ADE" },
      {
        name: "description",
        content: "Watch the agent run and test each project in its own browser.",
      },
      { property: "og:title", content: "Processes — ADE" },
      { property: "og:description", content: "Every local process, named by project and purpose." },
    ],
  }),
  component: ProcessesRedirect,
});

function ProcessesRedirect() {
  const { state } = useAde();
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
      search: { pane: "computer" },
      replace: true,
    });
  }, [state.hydrated, state.projects, navigate]);

  return <main className="flex-1" />;
}
