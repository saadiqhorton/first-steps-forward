import { FilePenLine, Play, Sparkles, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { Workflow } from "@/lib/ade/types";
import { workflowAccent } from "./workflowFilters.mjs";

function agentTagLabel(agentId?: Workflow["agentId"]) {
  if (!agentId) return "Any agent";
  if (agentId === "codex") return "Codex";
  if (agentId === "opencode") return "OpenCode";
  if (agentId === "pi") return "Pi";
  return agentId;
}

function permissionTagLabel(permission?: Workflow["permission"]) {
  if (!permission) return null;
  return permission === "plan" ? "Plan" : "Build";
}

export function WorkflowDetailsPane({
  workflow,
  projectId,
  onClose,
  onEdit,
  onDelete,
}: {
  workflow: Workflow;
  projectId: string;
  onClose: () => void;
  onEdit: (workflow: Workflow) => void;
  onDelete: (workflow: Workflow) => void;
}) {
  const accent = workflowAccent(workflow.id);
  const builtIn = !!workflow.builtIn;
  const permissionLabel = permissionTagLabel(workflow.permission);

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-panel">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <h2 className="label-mono">Workflow details</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="btn-quiet grid size-7 place-items-center"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className={`grid size-12 place-items-center rounded-lg ${accent}`} aria-hidden>
          <Sparkles className="size-5 text-ink/70" />
        </div>
        <p className="label-mono mt-4">{builtIn ? "Built-in" : "Yours"}</p>
        <h3 className="mt-1 font-display text-[28px] leading-[0.95] tracking-wide">
          {workflow.name}
        </h3>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1 text-[11px] text-dim">
            <Sparkles className="size-3" aria-hidden />
            {agentTagLabel(workflow.agentId)}
          </span>
          {permissionLabel ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1 text-[11px] text-dim">
              {permissionLabel}
            </span>
          ) : null}
        </div>

        {workflow.description ? (
          <p className="mt-5 text-[13px] leading-relaxed text-dim">{workflow.description}</p>
        ) : null}

        <div className="mt-5">
          <div className="label-mono mb-2">Prompt</div>
          <pre className="whitespace-pre-wrap rounded-md border border-line bg-paper p-3 font-mono text-[12px] leading-relaxed text-ink">
            {workflow.prompt}
          </pre>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        <button
          type="button"
          onClick={() => onEdit(workflow)}
          className="btn-quiet inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px]"
        >
          <FilePenLine className="size-3.5" aria-hidden />
          Edit workflow
        </button>
        {!builtIn ? (
          <button
            type="button"
            onClick={() => onDelete(workflow)}
            className="btn-quiet px-3 py-1.5 text-[12px]"
          >
            Delete
          </button>
        ) : null}
        <Link
          to="/p/$projectId/conversations"
          params={{ projectId }}
          search={{ workflow: workflow.id } as never}
          className="btn-amber ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px]"
        >
          <Play className="size-3.5" aria-hidden />
          Run workflow
        </Link>
      </div>
    </aside>
  );
}
