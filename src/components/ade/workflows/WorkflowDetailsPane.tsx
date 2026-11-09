import { useEffect, useState } from "react";
import { Check, Clipboard, FilePenLine, Play, Sparkles, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { Agent, Workflow } from "@/lib/ade/types";
import { warnUser } from "@/lib/ade/userNotices";
import { copyText, isInsecureOrigin } from "@/lib/ade/clipboard";
import { useAdeState } from "@/lib/ade/store";
import { workflowAccent } from "./workflowFilters.mjs";

const COPY_RESET_MS = 2000;

function agentTagLabel(agentId: Workflow["agentId"], agents: Agent[]) {
  if (!agentId) return "Any agent";
  return agents.find((a) => a.id === agentId)?.short ?? agentId;
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
  const agents = useAdeState((state) => state.agents);
  const accent = workflowAccent(workflow.id);
  const builtIn = !!workflow.builtIn;
  const permissionLabel = permissionTagLabel(workflow.permission);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPY_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyPrompt = async () => {
    if (await copyText(workflow.prompt)) {
      setCopied(true);
      return;
    }
    const reason = isInsecureOrigin()
      ? " Your browser only allows clipboard writes on secure origins, so open the ADE at 127.0.0.1 or over HTTPS."
      : "";
    void warnUser(`Could not copy the prompt. Select the text and copy it manually.${reason}`);
  };

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
        <h3 className="mt-4 text-xl font-medium leading-snug">{workflow.name}</h3>
        <p className="label-mono mt-1">{builtIn ? "Built-in" : "Yours"}</p>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1 text-[11px] text-dim">
            <Sparkles className="size-3" aria-hidden />
            {agentTagLabel(workflow.agentId, agents)}
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
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="label-mono">Prompt</span>
            <button
              type="button"
              onClick={() => void copyPrompt()}
              className="btn-quiet inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px]"
            >
              {copied ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                <Clipboard className="size-3.5" aria-hidden />
              )}
              {copied ? "Copied" : "Copy prompt"}
            </button>
          </div>
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
