import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { readLastProject } from "@/lib/ade/navigation";
import { useAdeState } from "@/lib/ade/store";

export const Route = createFileRoute("/tasks/new")({
  head: () => ({
    meta: [
      { title: "New task — ADE" },
      { name: "description", content: "Start a real local coding-agent session." },
    ],
  }),
  component: NewTaskRedirect,
});

function NewTaskRedirect() {
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
      replace: true,
    });
  }, [state.hydrated, state.projects, navigate]);

  return <main className="flex-1" />;
}
