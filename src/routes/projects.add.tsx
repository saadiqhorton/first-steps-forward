import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { readLastProject } from "@/lib/ade/navigation";
import { useAde } from "@/lib/ade/store";

export const Route = createFileRoute("/projects/add")({
  head: () => ({ meta: [{ title: "Add project — ADE" }] }),
  component: AddProjectRedirect,
});

function AddProjectRedirect() {
  const { state } = useAde();
  const navigate = useNavigate();

  useEffect(() => {
    if (!state.hydrated) return;
    if (!state.projects.length) {
      void navigate({ to: "/", search: { dialog: "add-project" } as never, replace: true });
      return;
    }
    const last = readLastProject();
    const projectId =
      (last && state.projects.some((p) => p.id === last) ? last : null) ?? state.projects[0]!.id;
    void navigate({
      to: "/p/$projectId/conversations",
      params: { projectId },
      search: { dialog: "add-project" },
      replace: true,
    });
  }, [state.hydrated, state.projects, navigate]);

  return <main className="flex-1" />;
}
