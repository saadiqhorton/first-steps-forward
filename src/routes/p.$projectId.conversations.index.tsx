import { createFileRoute } from "@tanstack/react-router";
import { NewTaskForm } from "@/components/ade/NewTaskForm";

export const Route = createFileRoute("/p/$projectId/conversations/")({
  head: () => ({
    meta: [
      { title: "Conversations — ADE" },
      { name: "description", content: "Project conversations and new tasks." },
    ],
  }),
  component: ConversationsIndex,
});

function ConversationsIndex() {
  const { projectId } = Route.useParams();
  return <NewTaskForm projectId={projectId} />;
}
