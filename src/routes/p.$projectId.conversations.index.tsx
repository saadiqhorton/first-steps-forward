import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { NewTaskForm } from "@/components/ade/NewTaskForm";

export const Route = createFileRoute("/p/$projectId/conversations/")({
  head: () => ({
    meta: [
      { title: "Conversations — ADE" },
      { name: "description", content: "Project conversations and new tasks." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => {
    const workflow = search["workflow"];
    return {
      ...(typeof workflow === "string" && workflow.length > 0 ? { workflow } : {}),
    };
  },
  component: ConversationsIndex,
});

function ConversationsIndex() {
  const { projectId } = Route.useParams();
  // Prefer the index route's validated search; fall back to the raw URL so
  // ?workflow= still works if the parent conversations layout omits it.
  const validated = Route.useSearch();
  const rawWorkflow = useRouterState({
    select: (s) => {
      const str = s.location.searchStr;
      if (!str) return undefined;
      return (
        new URLSearchParams(str.startsWith("?") ? str : `?${str}`).get("workflow") ?? undefined
      );
    },
  });
  const workflowId = validated.workflow ?? rawWorkflow;

  return (
    <NewTaskForm projectId={projectId} {...(workflowId ? { prefillWorkflowId: workflowId } : {})} />
  );
}
