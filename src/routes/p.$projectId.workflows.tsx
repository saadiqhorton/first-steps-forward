import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/p/$projectId/workflows")({
  head: () => ({ meta: [{ title: "Workflows — ADE" }] }),
  component: WorkflowsPlaceholder,
});

function WorkflowsPlaceholder() {
  return (
    <main className="grid flex-1 place-items-center px-8 text-center">
      <p className="text-[14px] text-dim">Workflows are coming in the next stage.</p>
    </main>
  );
}
