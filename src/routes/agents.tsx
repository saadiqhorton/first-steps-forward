import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { readLastProject } from "@/lib/ade/navigation";
import { useAde } from "@/lib/ade/store";

export const Route = createFileRoute("/agents")({
  head: () => ({ meta: [{ title: "Agents — ADE" }] }),
  component: AgentsRedirect,
});

function AgentsRedirect() {
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
      search: { dialog: "agents" },
      replace: true,
    });
  }, [state.hydrated, state.projects, navigate]);

  return <main className="flex-1" />;
}
