import { createFileRoute } from "@tanstack/react-router";
import { SkillsWorkspace } from "@/components/ade/skills/SkillsWorkspace";

export const Route = createFileRoute("/p/$projectId/skills")({
  head: () => ({ meta: [{ title: "Skills — ADE" }] }),
  component: SkillsPage,
});

function SkillsPage() {
  const { projectId } = Route.useParams();
  return <SkillsWorkspace projectId={projectId} />;
}
