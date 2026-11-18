import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceChat } from "@/components/ade/WorkspaceChat";

export const Route = createFileRoute("/workspace/assistant/$threadId")({
  component: AssistantThreadRoute,
});

function AssistantThreadRoute() {
  const { threadId } = Route.useParams();
  return <WorkspaceChat threadId={threadId} />;
}
