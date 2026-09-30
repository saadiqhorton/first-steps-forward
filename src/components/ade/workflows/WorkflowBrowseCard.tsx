import { Play, Workflow as WorkflowIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { Workflow } from "@/lib/ade/types";
import { workflowAccent } from "./workflowFilters.mjs";

export function WorkflowBrowseCard({
  workflow,
  selected,
  projectId,
  onSelect,
}: {
  workflow: Workflow;
  selected: boolean;
  projectId: string;
  onSelect: (workflow: Workflow) => void;
}) {
  const accent = workflowAccent(workflow.id);

  return (
    <button
      type="button"
      onClick={() => onSelect(workflow)}
      aria-pressed={selected}
      className={`card-panel group relative flex flex-col items-start gap-2 p-4 text-left transition ${
        selected ? "border-amber ring-1 ring-amber/40" : "hover:border-ink/25"
      }`}
    >
      <div
        className={`grid size-8 shrink-0 place-items-center rounded-md ${accent}`}
        aria-hidden
      >
        <WorkflowIcon className="size-4 text-ink/70" />
      </div>
      <div className="min-w-0 w-full pr-8">
        <h3 className="text-[14px] font-semibold leading-snug">{workflow.name}</h3>
        {workflow.description ? (
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-dim">
            {workflow.description}
          </p>
        ) : null}
      </div>
      <Link
        to="/p/$projectId/conversations"
        params={{ projectId }}
        search={{ workflow: workflow.id } as never}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Run ${workflow.name}`}
        className="absolute right-3 bottom-3 grid size-7 place-items-center rounded-md text-dim transition hover:bg-ink/5 hover:text-ink"
      >
        <Play className="size-3.5" aria-hidden />
      </Link>
    </button>
  );
}
