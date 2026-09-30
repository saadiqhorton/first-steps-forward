import { createFileRoute } from "@tanstack/react-router";
import { NewTaskForm } from "@/components/ade/NewTaskForm";

export const Route = createFileRoute("/p/$projectId/conversations/")({
  head: () => ({
    meta: [
      { title: "New task — ADE" },
      { name: "description", content: "Start a real local coding-agent session." },
    ],
  }),
  component: ConversationsIndex,
});

function ConversationsIndex() {
  const { projectId } = Route.useParams();
  return <NewTaskForm projectId={projectId} />;
}
