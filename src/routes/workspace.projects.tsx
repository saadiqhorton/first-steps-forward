import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceProjects } from "@/components/ade/WorkspaceHub";
export const Route = createFileRoute("/workspace/projects")({ component: WorkspaceProjects });
