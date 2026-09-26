import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ModelPicker } from "@/components/ade/ModelPicker";
import { SignInDialog } from "@/components/ade/SignInDialog";
import type { Agent, AgentId } from "@/lib/ade/types";
import { useActiveProject, useAde } from "@/lib/ade/store";

export const Route = createFileRoute("/tasks/new")({
  head: () => ({
    meta: [
      { title: "New task — ADE" },
      { name: "description", content: "Start a real local coding-agent session." },
    ],
  }),
  component: NewTask,
});
function NewTask() {
  const { state, startTask } = useAde();
  const active = useActiveProject();
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState(active.id);
  const project = state.projects.find((p) => p.id === projectId) ?? active;
  const [agentId, setAgentId] = useState<AgentId>(project.defaultAgent);
  const [model, setModel] = useState("");
  const [request, setRequest] = useState("");
  const [criteria, setCriteria] = useState("");
  const [signing, setSigning] = useState<Agent | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const agent = state.agents.find((a) => a.id === agentId);
  const usable = !!agent?.installed && agent.signedIn;
  const overlapping = state.sessions.some(
    (s) => s.projectId === project.id && ["working", "verifying"].includes(s.status),
  );
  const canStart =
    !!project.id &&
    request.trim().length > 3 &&
    usable &&
    !project.uncommittedFiles.length &&
    !overlapping &&
    !busy;
  const submit = async () => {
    if (!canStart) return;
    setBusy(true);
    setError("");
    try {
      const s = await startTask({
        projectId: project.id,
        agentId,
        request: request.trim(),
        criteria: criteria.trim(),
        ...(model.trim() ? { model: model.trim() } : {}),
      });
      navigate({ to: "/sessions/$sessionId", params: { sessionId: s.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (!state.projects.length)
    return (
      <main className="min-w-0 flex-1 px-7 py-8">
        <div className="label-mono">No project selected</div>
        <h1 className="mt-1 font-display text-4xl">Add a project first</h1>
        <Link to="/projects/add" className="btn-amber mt-5 inline-block px-4 py-2 text-sm">
          + Add project
        </Link>
      </main>
    );
  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-7 pt-8 pb-12">
        <div className="label-mono">New task</div>
        <h1 className="mt-1 font-display text-[44px] leading-[0.9] tracking-wide">
          What should change?
        </h1>
        <p className="mt-2 text-[13px] text-dim">
          A focused request starts the selected CLI in your project. Prompts and files the CLI reads
          are sent to its configured provider under that provider's policies.
        </p>
        <div className="mt-4 rounded-md border border-line bg-panel px-3 py-2 text-[11px] leading-relaxed text-dim">
          ADE refuses dirty Git worktrees and explicit deployment/destructive requests. Tool-level
          approval prompts are not bridged yet; OpenCode rejects permission requests in
          non-interactive mode, and follow-ups are queued between turns. Review the agent's real
          output and diff.
        </div>
        <div className="mt-6 space-y-5">
          <div>
            <label className="label-mono block">Project</label>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup">
              {state.projects.map((p) => (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={p.id === project.id}
                  onClick={() => {
                    setProjectId(p.id);
                    setAgentId(p.defaultAgent);
                    setModel("");
                  }}
                  className={`rounded-md px-3 py-1.5 text-[13px] ring-1 ${p.id === project.id ? "bg-amber/15 ring-amber/40 font-medium" : "bg-panel ring-line"}`}
                >
                  {p.name} <span className="font-mono text-[10px] text-dim">{p.branch}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label-mono block" htmlFor="request">
              Request
            </label>
            <textarea
              id="request"
              autoFocus
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && void submit()}
              rows={4}
              placeholder='e.g. Add a "Back in stock" signup to sold-out product pages.'
              className="mt-2 w-full resize-y rounded-lg border border-line bg-panel px-4 py-3 text-[15px] leading-relaxed placeholder:text-dim/70"
            />
          </div>
          <div>
            <label className="label-mono block" htmlFor="criteria">
              Acceptance criteria <span className="normal-case tracking-normal">(optional)</span>
            </label>
            <textarea
              id="criteria"
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              rows={2}
              placeholder="How will you know it's done? Leave blank to let the agent choose a reasonable approach."
              className="mt-2 w-full resize-y rounded-lg border border-line bg-panel px-4 py-3 text-[13px] leading-relaxed placeholder:text-dim/70"
            />
          </div>
          <div>
            <div className="label-mono">Agent</div>
            <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup">
              {state.agents.map((a) => (
                <button
                  key={a.id}
                  role="radio"
                  aria-checked={a.id === agentId}
                  onClick={() => {
                    setAgentId(a.id);
                    setModel("");
                  }}
                  className={`rounded-lg p-3 text-left ring-1 ${a.id === agentId ? "bg-amber/15 ring-amber/40" : "bg-panel ring-line"}`}
                >
                  <div className="text-[13px] font-medium">{a.name}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-dim">
                    {!a.installed ? "Not installed" : a.signedIn ? a.account : "Sign-in needed"}
                  </div>
                  {a.id === project.defaultAgent && (
                    <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-teal">
                      Project default
                    </div>
                  )}
                </button>
              ))}
            </div>
            {agent && !agent.installed && (
              <p className="mt-2 rounded-md bg-amber/10 px-3 py-2 text-[12px]">
                {agent.name} is not installed. {agent.installHint}
              </p>
            )}
            {agent?.installed && !agent.signedIn && (
              <div className="mt-2 flex items-center gap-3 rounded-md bg-amber/10 px-3 py-2 text-[12px]">
                <span>{agent.name} is installed but not authenticated.</span>
                <button onClick={() => setSigning(agent)} className="btn-amber ml-auto px-3 py-1">
                  Set up
                </button>
              </div>
            )}
          </div>
          <ModelPicker
            agentId={agentId}
            agentName={agent?.name ?? agentId}
            value={model}
            onChange={setModel}
          />
          {!!project.uncommittedFiles.length && (
            <div className="rounded-lg border border-amber/40 bg-amber/10 p-4">
              <div className="text-[13px] font-semibold">Uncommitted work is protected</div>
              <p className="mt-1 text-[12px] leading-relaxed">
                ADE will not launch an agent against a dirty working tree. Commit or stash these
                changes first. ADE never auto-stashes, resets, or restores files.
              </p>
              <ul className="mt-2 font-mono text-[11px] text-dim">
                {project.uncommittedFiles.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          {overlapping && (
            <div className="rounded-lg border border-line bg-panel p-4 text-[12px]">
              One task is still running in this project. Wait for it to stop before starting another
              to avoid overlapping edits.
            </div>
          )}
          {error && <p className="rounded bg-danger/10 p-3 text-[12px] text-danger">{error}</p>}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => void submit()}
              disabled={!canStart}
              className="btn-amber px-5 py-2.5 text-[14px]"
            >
              {busy ? "Starting…" : "Start task"}
            </button>
            <button
              onClick={() => navigate({ to: "/" })}
              className="btn-quiet ml-auto px-4 py-2 text-[13px]"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
      {signing && <SignInDialog agent={signing} onClose={() => setSigning(null)} />}
    </main>
  );
}
