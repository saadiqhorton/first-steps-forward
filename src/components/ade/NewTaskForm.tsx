import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ChevronDown, Plus, TriangleAlert } from "lucide-react";
import { type AgentSelection } from "@/components/ade/AgentPicker";
import { Composer } from "@/components/ade/Composer";
import { SignInDialog } from "@/components/ade/SignInDialog";
import { WorkflowCards } from "@/components/ade/workflows/WorkflowCards";
import type { Agent, MessagePresentation, Workflow } from "@/lib/ade/types";
import { workflowsQuery } from "@/lib/ade/queries";
import { uploadAttachment, useAde, useAdeState } from "@/lib/ade/store";
import { readLastModel, writeLastModel } from "@/lib/ade/lastModels";

const NO_WORKFLOWS: Workflow[] = [];

/** Neutral notes above the composer: informational, not a call to action. */
const noteClass = "rounded-md border border-line bg-surface-muted px-4 py-3 text-ui leading-5";

export function NewTaskForm({
  projectId,
  initialText,
  initialSelection,
  prefillWorkflowId,
}: {
  projectId: string;
  initialText?: string;
  initialSelection?: Partial<Pick<AgentSelection, "agentId" | "permission">>;
  prefillWorkflowId?: string;
}) {
  const { startTask } = useAde();
  const projects = useAdeState((state) => state.projects);
  const agents = useAdeState((state) => state.agents);
  const sessions = useAdeState((state) => state.sessions);
  const navigate = useNavigate();
  const project = projects.find((p) => p.id === projectId);
  const [selection, setSelection] = useState<AgentSelection>(() => {
    // The project's default agent, else the first ready one.
    const agentId =
      initialSelection?.agentId ??
      (project?.defaultAgent || agents.find((a) => a.installed && a.signedIn)?.id) ??
      agents[0]?.id ??
      "";
    return {
      agentId,
      model: readLastModel(agentId) ?? "",
      effort: "",
      speed: "",
      permission: initialSelection?.permission ?? "build",
    };
  });
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [criteria, setCriteria] = useState("");
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [signing, setSigning] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ackDirty, setAckDirty] = useState(false);
  const workflows = useQuery(workflowsQuery()).data ?? NO_WORKFLOWS;
  const appliedPrefill = useRef<string | null>(null);
  const agent = agents.find((a) => a.id === selection.agentId);
  const usable = !!agent?.installed && agent.signedIn;
  const overlapping =
    !!project &&
    sessions.some((s) => s.projectId === project.id && ["working", "verifying"].includes(s.status));
  const dirty = !!project && project.uncommittedFiles.length > 0;

  const applyWorkflow = useCallback((workflow: Workflow) => {
    setSelectedWorkflow(workflow);
    setSelection((prev) => ({
      ...prev,
      // A model (and its effort and speed) belongs to the agent it was picked for.
      ...(workflow.agentId && workflow.agentId !== prev.agentId
        ? { agentId: workflow.agentId, model: "", effort: "", speed: "" }
        : {}),
      ...(workflow.permission ? { permission: workflow.permission } : {}),
    }));
  }, []);

  useEffect(() => {
    if (selection.model.trim()) writeLastModel(selection.agentId, selection.model);
  }, [selection.agentId, selection.model]);

  // A default that points nowhere — agents still loading at mount, or an
  // agent that no longer exists — falls back to the first ready agent. A
  // selection the user made is never overridden, even if it is not usable.
  useEffect(() => {
    if (agents.some((a) => a.id === selection.agentId)) return;
    const fallback = agents.find((a) => a.installed && a.signedIn)?.id ?? agents[0]?.id;
    if (!fallback) return;
    setSelection((prev) => ({
      ...prev,
      agentId: fallback,
      model: readLastModel(fallback) ?? "",
      effort: "",
      speed: "",
    }));
  }, [agents, selection.agentId]);

  useEffect(() => {
    if (!prefillWorkflowId || workflows.length === 0) return;
    if (appliedPrefill.current === prefillWorkflowId) return;
    const workflow = workflows.find((w) => w.id === prefillWorkflowId);
    if (!workflow) return;
    appliedPrefill.current = prefillWorkflowId;
    applyWorkflow(workflow);
    // Clear the query param so refresh doesn't re-apply mid-edit.
    void navigate({
      to: "/p/$projectId/conversations",
      params: { projectId },
      search: (prev) => {
        const next = { ...prev } as Record<string, unknown>;
        delete next["workflow"];
        return next as typeof prev;
      },
      replace: true,
    });
  }, [prefillWorkflowId, workflows, projectId, applyWorkflow, navigate]);

  const onSend = async (
    text: string,
    files: File[],
    _delivery?: "now" | "later",
    presentation?: MessagePresentation,
  ) => {
    if (!project || busy) return false;
    if (!usable) {
      setError(
        agent && !agent.installed
          ? `${agent.name} is not installed. ${agent.installHint}`
          : `${agent?.name ?? "Agent"} must be signed in before starting.`,
      );
      return false;
    }
    if (dirty && !ackDirty) {
      setError("Acknowledge uncommitted work before starting.");
      return false;
    }
    if (overlapping) {
      setError(
        "One task is still running in this project. Wait for it to stop before starting another.",
      );
      return false;
    }
    if (text.trim().length <= 3) {
      setError("Describe the change in a bit more detail.");
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      let attachmentIds: string[] = [];
      if (files.length) {
        try {
          attachmentIds = (await Promise.all(files.map(uploadAttachment))).map((a) => a.id);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          return false;
        }
      }
      const s = await startTask({
        projectId: project.id,
        agentId: selection.agentId,
        request: text.trim(),
        criteria: criteria.trim(),
        ...(selection.model.trim() ? { model: selection.model.trim() } : {}),
        ...(selection.effort.trim() ? { effort: selection.effort.trim() } : {}),
        ...(selection.speed.trim() ? { speed: selection.speed.trim() } : {}),
        permission: selection.permission,
        ...(attachmentIds.length ? { attachmentIds } : {}),
        ...(presentation ? { presentation } : {}),
      });
      void navigate({
        to: "/p/$projectId/conversations/$sessionId",
        params: { projectId: project.id, sessionId: s.id },
      });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!projects.length || !project)
    return (
      <main className="min-w-0 flex-1 px-4 py-6 @lg:px-7 @lg:py-8 @container">
        <h1 className="heading-display text-2xl @lg:text-3xl">Add a project first</h1>
        <Link
          to="/projects/add"
          className="btn-amber mt-5 inline-flex items-center gap-1.5 px-4 py-2 text-sm"
        >
          <Plus className="size-4" strokeWidth={1.5} aria-hidden />
          Add project
        </Link>
      </main>
    );

  const extra = (
    <div className="space-y-3">
      <div>
        <button
          type="button"
          onClick={() => setCriteriaOpen((v) => !v)}
          className="label-section inline-flex items-center gap-1 transition-colors hover:text-ink"
          aria-expanded={criteriaOpen}
        >
          Acceptance criteria (optional)
          <ChevronDown
            className={`size-4 transition-transform motion-reduce:transition-none ${criteriaOpen ? "rotate-180" : ""}`}
            strokeWidth={1.5}
            aria-hidden
          />
        </button>
        {criteriaOpen && (
          <textarea
            id="criteria"
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            rows={2}
            placeholder="How will you know it's done? Leave blank to let the agent choose a reasonable approach."
            className="mt-2 w-full resize-y rounded-md border border-line bg-paper px-3 py-2 text-ui leading-relaxed placeholder:text-dim/70"
          />
        )}
      </div>
      {!!project.uncommittedFiles.length && (
        <div className="rounded-md border border-line bg-surface-muted p-4">
          <div className="flex items-center gap-2 text-ui font-medium text-ink">
            <TriangleAlert
              className="size-4 shrink-0 text-amber-deep"
              strokeWidth={1.5}
              aria-hidden
            />
            Uncommitted changes in this project
          </div>
          <p className="mt-1 text-ui leading-5 text-[color:var(--text-secondary)]">
            The agent is told to work around these files and never revert, stash, commit or
            overwrite them. They're marked as yours in the diff, and ADE never stashes, resets or
            restores files on its own.
          </p>
          <ul className="mt-3 max-h-40 overflow-y-auto font-mono text-xs text-dim">
            {project.uncommittedFiles.map((f) => (
              <li key={f} className="truncate" title={f}>
                {f}
              </li>
            ))}
          </ul>
          <label className="mt-3 flex items-start gap-2 text-ui leading-5 text-ink">
            <input
              type="checkbox"
              checked={ackDirty}
              onChange={(e) => setAckDirty(e.target.checked)}
              className="mt-1 accent-amber"
            />
            <span>
              I understand the agent will run alongside my uncommitted changes and I'll review the
              diff before committing anything.
            </span>
          </label>
        </div>
      )}
      {overlapping && (
        <div className={noteClass}>
          One task is still running in this project. Wait for it to stop before starting another to
          avoid overlapping edits.
        </div>
      )}
      {agent && !agent.installed && (
        <p className={noteClass}>
          {agent.name} is not installed. {agent.installHint}
        </p>
      )}
      {agent?.installed && !agent.signedIn && (
        <div className={`flex items-center gap-3 ${noteClass}`}>
          <span>{agent.name} is installed but not authenticated.</span>
          <button
            type="button"
            onClick={() => setSigning(agent)}
            className="btn-amber ml-auto px-3 py-1.5 text-xs"
          >
            Set up
          </button>
        </div>
      )}
    </div>
  );

  const preview = workflows.slice(0, 3);

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto @container">
      <div className="flex w-full max-w-3xl flex-col px-4 py-6 @lg:px-7 @lg:py-10">
        <h1 className="heading-display text-2xl @lg:text-3xl">What are you working on?</h1>
        <p className="mt-3 text-ui text-dim">Describe a change and an agent gets started</p>
        {preview.length > 0 && (
          <div className="mt-8">
            <div className="label-section">Start with a workflow</div>
            <div className="mt-3">
              <WorkflowCards workflows={preview} onSelect={applyWorkflow} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-ui">
              <Link
                to="/p/$projectId/workflows"
                params={{ projectId }}
                className="inline-flex items-center gap-1.5 text-dim underline-offset-2 transition-colors hover:text-ink hover:underline"
              >
                Browse all workflows
                <ArrowRight className="size-4" strokeWidth={1.5} aria-hidden />
              </Link>
              <Link
                to="/p/$projectId/workflows"
                params={{ projectId }}
                search={{ new: true }}
                className="inline-flex items-center gap-1.5 text-dim underline-offset-2 transition-colors hover:text-ink hover:underline"
              >
                <Plus className="size-4" strokeWidth={1.5} aria-hidden />
                New workflow
              </Link>
            </div>
          </div>
        )}
        <div className="mt-8">
          <Composer
            projectId={project.id}
            mode="new"
            selection={selection}
            onSelectionChange={setSelection}
            branch={project.branch}
            placeholder="Describe a change"
            sending={busy}
            error={error}
            onSend={onSend}
            {...(initialText !== undefined ? { initialText } : {})}
            workflow={selectedWorkflow}
            onWorkflowSelect={applyWorkflow}
            onWorkflowRemove={() => setSelectedWorkflow(null)}
            extra={extra}
          />
        </div>
      </div>
      {signing && <SignInDialog agent={signing} onClose={() => setSigning(null)} />}
    </main>
  );
}
