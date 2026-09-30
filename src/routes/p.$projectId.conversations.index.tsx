import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { NewTaskForm } from "@/components/ade/NewTaskForm";
import { useAde } from "@/lib/ade/store";

export const Route = createFileRoute("/p/$projectId/conversations/")({
  head: () => ({
    meta: [
      { title: "Conversations — ADE" },
      { name: "description", content: "Project conversations and new tasks." },
    ],
  }),
  component: ConversationsIndex,
});

function ConversationsIndex() {
  const { projectId } = Route.useParams();
  const { state } = useAde();
  const project = state.projects.find((p) => p.id === projectId);
  const [composing, setComposing] = useState(false);

  if (composing) {
    return <NewTaskForm projectId={projectId} onCancel={() => setComposing(false)} />;
  }

  return (
    <main className="min-w-0 flex-1 overflow-y-auto px-7 py-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="label-mono">Conversations</div>
        <h1 className="mt-1 font-display text-4xl tracking-wide">
          {project?.name ?? "This project"}
        </h1>
        <p className="mt-2 text-[13px] text-dim">
          No conversation selected. Start a new task, or open Files or Workflows.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="btn-amber px-5 py-2.5 text-[14px]"
          >
            New task
          </button>
          <Link
            to="/p/$projectId/files"
            params={{ projectId }}
            className="btn-quiet px-4 py-2.5 text-[14px]"
          >
            Files
          </Link>
          <Link
            to="/p/$projectId/workflows"
            params={{ projectId }}
            className="btn-quiet px-4 py-2.5 text-[14px]"
          >
            Workflows
          </Link>
        </div>
      </div>
    </main>
  );
}
