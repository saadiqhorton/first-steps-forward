import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceInbox } from "@/components/ade/WorkspaceHub";
export const Route = createFileRoute("/workspace/inbox")({ component: WorkspaceInbox });
