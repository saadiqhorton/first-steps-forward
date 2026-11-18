import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceSettings } from "@/components/ade/WorkspaceHub";
export const Route = createFileRoute("/workspace/settings")({ component: WorkspaceSettings });
