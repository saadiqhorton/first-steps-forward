import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceOverview } from "@/components/ade/WorkspaceHub";

export const Route = createFileRoute("/workspace/")({ component: WorkspaceOverview });
