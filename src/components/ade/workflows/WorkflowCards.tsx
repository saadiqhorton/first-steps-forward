import { Play } from "lucide-react";
import type { Workflow } from "@/lib/ade/types";

export function WorkflowCards({
  workflows,
  onSelect,
}: {
  workflows: Workflow[];
  onSelect: (workflow: Workflow) => void;
}) {
  return (
    <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]">
      {workflows.map((workflow) => (
        <button
          key={workflow.id}
          type="button"
          onClick={() => onSelect(workflow)}
          className="card-panel group flex flex-col items-start gap-2 p-4 text-left transition hover:border-ink/25"
        >
          <div className="flex w-full items-start justify-between gap-2">
            <span className="min-w-0 text-[14px] font-medium leading-snug">{workflow.name}</span>
            <Play
              className="mt-0.5 size-4 shrink-0 text-dim transition group-hover:text-ink"
              aria-hidden
            />
          </div>
          {workflow.description ? (
            <p className="line-clamp-2 text-[12px] leading-relaxed text-dim">
              {workflow.description}
            </p>
          ) : null}
        </button>
      ))}
    </div>
  );
}
