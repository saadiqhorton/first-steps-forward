import { useEffect } from "react";
import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { writeLastProject } from "@/lib/ade/navigation";
import { useAde, useAdeState } from "@/lib/ade/store";

export const Route = createFileRoute("/p/$projectId")({
  component: ProjectLayout,
});

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const { selectProject } = useAde();
  const state = useAdeState((state) => ({
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    hydrated: state.hydrated,
  }));
  const known = state.projects.some((p) => p.id === projectId);

  useEffect(() => {
    if (!state.hydrated || !known) return;
    if (state.activeProjectId !== projectId) selectProject(projectId);
    writeLastProject(projectId);
  }, [state.hydrated, known, projectId, state.activeProjectId, selectProject]);

  if (state.hydrated && !known) {
    return (
      <main className="grid flex-1 place-items-center">
        <div className="text-center">
          <h1 className="text-xl font-medium">Project not found</h1>
          <Link to="/" className="btn-quiet mt-3 inline-block px-3 py-1.5 text-[12px]">
            Back home
          </Link>
        </div>
      </main>
    );
  }

  return <Outlet />;
}
