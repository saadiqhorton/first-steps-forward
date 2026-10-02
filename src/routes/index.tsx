import { useEffect } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { readLastProject } from "@/lib/ade/navigation";
import { useAde } from "@/lib/ade/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ADE — Project home" },
      {
        name: "description",
        content:
          "See your preview, active agent sessions, and recent changes for the current project in one calm workspace.",
      },
      { property: "og:title", content: "ADE — Project home" },
      {
        property: "og:description",
        content: "A free, local-first workspace for building software with AI coding agents.",
      },
    ],
  }),
  component: ProjectHome,
});

function ProjectHome() {
  const { state } = useAde();
  const navigate = useNavigate();

  useEffect(() => {
    if (!state.hydrated || !state.projects.length) return;
    const last = readLastProject();
    const projectId =
      (last && state.projects.some((p) => p.id === last) ? last : null) ?? state.projects[0]!.id;
    void navigate({
      to: "/p/$projectId/conversations",
      params: { projectId },
      replace: true,
    });
  }, [state.hydrated, state.projects, navigate]);

  if (!state.hydrated) return <main className="flex-1" />;

  if (!state.projects.length)
    return (
      <main className="flex min-w-0 flex-1 flex-col items-center justify-center px-8 text-center">
        <h1 className="heading-display text-4xl">A quieter place to build</h1>
        <p className="mt-3 max-w-md text-[14px] leading-relaxed text-dim">
          Add a local folder to see its Git status, start a real coding-agent CLI, review the
          working-tree diff, and run its development server.
        </p>
        <Link to="/projects/add" className="btn-amber mt-6 px-5 py-2.5 text-[14px]">
          + Add your first project
        </Link>
        <p className="mt-4 font-mono text-[10px] text-dim">
          Everything stays on this machine. No ADE account or hosted relay.
        </p>
      </main>
    );

  return <main className="flex-1" />;
}
