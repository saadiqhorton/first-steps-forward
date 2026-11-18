import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceChat } from "@/components/ade/WorkspaceChat";

export const Route = createFileRoute("/workspace/assistant/")({
  component: () => <WorkspaceChat />,
});
