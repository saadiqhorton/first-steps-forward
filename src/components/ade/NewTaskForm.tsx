import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { type AgentSelection } from "@/components/ade/AgentPicker";
import { Composer } from "@/components/ade/Composer";
import { SignInDialog } from "@/components/ade/SignInDialog";
import type { Agent } from "@/lib/ade/types";
import { useAde } from "@/lib/ade/store";

export function NewTaskForm({
  projectId,
  initialText,
}: {
  projectId: string;
  initialText?: string;
}) {
  const { state, startTask } = useAde();
  const navigate = useNavigate();
  const project = state.projects.find((p) => p.id === projectId);
  const [selection, setSelection] = useState<AgentSelection>(() => ({
    agentId: project?.defaultAgent ?? "codex",
    model: "",
    effort: "",
    speed: "",
    permission: "build",
  }));
  const [criteria, setCriteria] = useState("");
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [signing, setSigning] = useState<Agent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ackDirty, setAckDirty] = useState(false);
  const agent = state.agents.find((a) => a.id === selection.agentId);
  const usable = !!agent?.installed && agent.signedIn;
  const overlapping =
    !!project &&
    state.sessions.some(
      (s) => s.projectId === project.id && ["working", "verifying"].includes(s.status),
    );
  const dirty = !!project && project.uncommittedFiles.length > 0;

  const onSend = async (text: string) => {
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
      const s = await startTask({
        projectId: project.id,
        agentId: selection.agentId,
        request: text.trim(),
        criteria: criteria.trim(),
        ...(selection.model.trim() ? { model: selection.model.trim() } : {}),
        ...(selection.effort.trim() ? { effort: selection.effort.trim() } : {}),
        ...(selection.speed.trim() ? { speed: selection.speed.trim() } : {}),
        permission: selection.permission,
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
        <div className="label-mono">No project selected</div>
        <h1 className="mt-1 font-display text-4xl">Add a project first</h1>
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
          <div className="text-[13px] font-semibold">
            Uncommitted work detected — it will be protected, not blocked
          </div>
          <p className="mt-1 text-[12px] leading-relaxed">
            You can start the task anyway. ADE records these files as your pre-existing changes,
            tells the agent to work around them (never revert, stash, commit, or overwrite them),
            and marks them "yours" in the diff so you can tell your edits from the agent's. ADE
            never auto-stashes, resets, or restores files.
          </p>
          <ul className="mt-2 font-mono text-[11px] text-dim">
            {project.uncommittedFiles.map((f) => (
              <li key={f}>{f}</li>
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

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-7 py-10">
        <h1 className="font-display text-[44px] leading-[0.9] tracking-wide">
          What are you working on?
        </h1>
        <p className="mt-3 text-[13px] text-dim">Describe a change and an agent gets started.</p>
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
            {...(initialText !== undefined ? { initialText } : {})}
            extra={extra}
          />
        </div>
      </div>
      {signing && <SignInDialog agent={signing} onClose={() => setSigning(null)} />}
    </main>
  );
}
