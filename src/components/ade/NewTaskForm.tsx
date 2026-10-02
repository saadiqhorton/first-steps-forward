import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type AgentSelection } from "@/components/ade/AgentPicker";
import { Composer } from "@/components/ade/Composer";
import { SignInDialog } from "@/components/ade/SignInDialog";
import { WorkflowCards } from "@/components/ade/workflows/WorkflowCards";
import type { Agent, Workflow } from "@/lib/ade/types";
import { workflowsQuery } from "@/lib/ade/queries";
import { agentModels, uploadAttachment, useAde } from "@/lib/ade/store";
import { resolveModelForAgent, writeLastModel } from "@/lib/ade/lastModels";

const NO_WORKFLOWS: Workflow[] = [];

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
  const { state, startTask } = useAde();
  const navigate = useNavigate();
  const project = state.projects.find((p) => p.id === projectId);
  const [selection, setSelection] = useState<AgentSelection>(() => ({
    agentId: initialSelection?.agentId ?? project?.defaultAgent ?? "codex",
    model: "",
    effort: "",
    speed: "",
    permission: initialSelection?.permission ?? "build",
  }));
  const [composerText, setComposerText] = useState(initialText);
  const [criteria, setCriteria] = useState("");
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [signing, setSigning] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ackDirty, setAckDirty] = useState(false);
  const workflows = useQuery(workflowsQuery()).data ?? NO_WORKFLOWS;
  const appliedPrefill = useRef<string | null>(null);
  const agent = state.agents.find((a) => a.id === selection.agentId);
  const usable = !!agent?.installed && agent.signedIn;
  const overlapping =
    !!project &&
    state.sessions.some(
      (s) => s.projectId === project.id && ["working", "verifying"].includes(s.status),
    );
  const dirty = !!project && project.uncommittedFiles.length > 0;

  const applyWorkflow = useCallback((workflow: Workflow) => {
    setComposerText(workflow.prompt);
    setSelection((prev) => ({
      ...prev,
      ...(workflow.agentId ? { agentId: workflow.agentId } : {}),
      ...(workflow.permission ? { permission: workflow.permission } : {}),
    }));
  }, []);

  // Last model for this agent/provider, else first catalog entry.
  useEffect(() => {
    let cancelled = false;
    const agentId = selection.agentId;
    void agentModels(agentId)
      .then((result) => {
        if (cancelled) return;
        const catalogIds = result.available ? (result.models ?? []).map((m) => m.id) : [];
        setSelection((prev) => {
          if (prev.agentId !== agentId || prev.model.trim()) return prev;
          const resolved = resolveModelForAgent(agentId, catalogIds, "");
          if (!resolved) return prev;
          return { ...prev, model: resolved, effort: "", speed: "" };
        });
      })
      .catch(() => {
        if (cancelled) return;
        setSelection((prev) => {
          if (prev.agentId !== agentId || prev.model.trim()) return prev;
          const resolved = resolveModelForAgent(agentId, [], "");
          if (!resolved) return prev;
          return { ...prev, model: resolved, effort: "", speed: "" };
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selection.agentId]);

  useEffect(() => {
    if (selection.model.trim()) writeLastModel(selection.agentId, selection.model);
  }, [selection.agentId, selection.model]);

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

  const onSend = async (text: string, files: File[]) => {
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

  if (!state.projects.length || !project)
    return (
      <main className="min-w-0 flex-1 px-7 py-8">
        <h1 className="heading-display text-3xl">Add a project first</h1>
        <Link to="/projects/add" className="btn-amber mt-5 inline-block px-4 py-2 text-sm">
          + Add project
        </Link>
      </main>
    );

  const extra = (
    <div className="space-y-3">
      <div>
        <button
          type="button"
          onClick={() => setCriteriaOpen((v) => !v)}
          className="label-mono hover:text-ink"
          aria-expanded={criteriaOpen}
        >
          Acceptance criteria (optional){criteriaOpen ? " ▴" : " ▾"}
        </button>
        {criteriaOpen && (
          <textarea
            id="criteria"
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            rows={2}
            placeholder="How will you know it's done? Leave blank to let the agent choose a reasonable approach."
            className="mt-2 w-full resize-y rounded-lg border border-line bg-paper px-3 py-2 text-[13px] leading-relaxed placeholder:text-dim/70"
          />
        )}
      </div>
      {!!project.uncommittedFiles.length && (
        <div className="rounded-lg border border-amber/40 bg-amber/10 p-4">
          <div className="text-[13px] font-medium">
            Uncommitted work detected — it will be protected, not blocked
          </div>
          <p className="mt-1 text-[12px] leading-relaxed">
            You can start the task anyway. ADE records these files as your pre-existing changes,
            tells the agent to work around them (never revert, stash, commit, or overwrite them),
            and marks them "yours" in the diff so you can tell your edits from the agent's. ADE
            never auto-stashes, resets, or restores files.
          </p>
          <ul className="mt-2 max-h-40 overflow-y-auto font-mono text-[11px] text-dim">
            {project.uncommittedFiles.map((f) => (
              <li key={f} className="truncate" title={f}>
                {f}
              </li>
            ))}
          </ul>
          <label className="mt-3 flex items-start gap-2 text-[12px] leading-snug">
            <input
              type="checkbox"
              checked={ackDirty}
              onChange={(e) => setAckDirty(e.target.checked)}
              className="mt-0.5 accent-amber"
            />
            <span>
              I understand the agent will run alongside my uncommitted changes and I'll review the
              diff before committing anything.
            </span>
          </label>
        </div>
      )}
      {overlapping && (
        <div className="rounded-lg border border-line bg-panel p-4 text-[12px]">
          One task is still running in this project. Wait for it to stop before starting another to
          avoid overlapping edits.
        </div>
      )}
      {agent && !agent.installed && (
        <p className="rounded-md bg-amber/10 px-3 py-2 text-[12px]">
          {agent.name} is not installed. {agent.installHint}
        </p>
      )}
      {agent?.installed && !agent.signedIn && (
        <div className="flex items-center gap-3 rounded-md bg-amber/10 px-3 py-2 text-[12px]">
          <span>{agent.name} is installed but not authenticated.</span>
          <button
            type="button"
            onClick={() => setSigning(agent)}
            className="btn-amber ml-auto px-3 py-1"
          >
            Set up
          </button>
        </div>
      )}
    </div>
  );

  const preview = workflows.slice(0, 3);

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
      <div className="flex w-full max-w-3xl flex-col px-7 py-10">
        <h1 className="heading-display text-3xl">What are you working on?</h1>
        <p className="mt-3 text-[13px] text-dim">Describe a change and an agent gets started.</p>
        {preview.length > 0 && (
          <div className="mt-8">
            <div className="label-mono">Start with a workflow</div>
            <div className="mt-3">
              <WorkflowCards workflows={preview} onSelect={applyWorkflow} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-[13px]">
              <Link
                to="/p/$projectId/workflows"
                params={{ projectId }}
                className="text-dim underline-offset-2 hover:text-ink hover:underline"
              >
                Browse all workflows →
              </Link>
              <Link
                to="/p/$projectId/workflows"
                params={{ projectId }}
                search={{ new: true }}
                className="text-dim underline-offset-2 hover:text-ink hover:underline"
              >
                + New workflow
              </Link>
            </div>
          </div>
        )}
        <div className="mt-8">
          <Composer
            mode="new"
            selection={selection}
            onSelectionChange={setSelection}
            branch={project.branch}
            placeholder="Describe a change…"
            sending={busy}
            error={error}
            onSend={onSend}
            {...(composerText !== undefined ? { initialText: composerText } : {})}
            extra={extra}
          />
        </div>
      </div>
      {signing && <SignInDialog agent={signing} onClose={() => setSigning(null)} />}
    </main>
  );
}
