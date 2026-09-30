import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AddProjectForm } from "@/components/ade/AddProjectForm";

export const Route = createFileRoute("/projects/add")({
  head: () => ({ meta: [{ title: "Add project — ADE" }] }),
  component: AddProject,
});

function AddProject() {
  const navigate = useNavigate();
  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <AddProjectForm
        onDone={(projectId) => {
          void navigate({
            to: "/p/$projectId/conversations",
            params: { projectId },
            replace: true,
          });
        }}
      />
    </main>
  );
}
