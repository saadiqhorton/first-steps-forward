import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { SignInDialog } from "@/components/ade/SignInDialog";
import type { Agent, AgentId } from "@/lib/ade/types";
import { isActive, useActiveProject, useAde } from "@/lib/ade/store";

export const Route = createFileRoute("/tasks/new")({
  head: () => ({
    meta: [
      { title: "New task — ADE" },
      { name: "description", content: "Describe a change in plain language and choose which coding agent should make it." },
      { property: "og:title", content: "New task — ADE" },
      { property: "og:description", content: "Start a fresh agent session for a project." },
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
  const [request, setRequest] = useState("");
  const [criteria, setCriteria] = useState("");
  const [ackUncommitted, setAck] = useState(false);
  const [signing, setSigning] = useState<Agent | null>(null);

  const agent = state.agents.find((a) => a.id === agentId)!;
  const usable = agent.installed && agent.signedIn;
  const overlapping = state.sessions.filter((s) => s.projectId === project.id && isActive(s) && s.status !== "ready");
  const needsAck = project.uncommittedFiles.length > 0 && !ackUncommitted;
  const canStart = request.trim().length > 3 && usable && !needsAck;

  const submit = () => {
    if (!canStart) return;
    const s = startTask({ projectId: project.id, agentId, request: request.trim(), criteria: criteria.trim() });
    navigate({ to: "/sessions/$sessionId", params: { sessionId: s.id } });
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-7 pt-8 pb-12">
        <div className="label-mono">New task</div>
        <h1 className="mt-1 font-display text-[44px] leading-[0.9] tracking-wide">What should change?</h1>
        <p className="mt-2 text-[13px] text-dim">A few plain sentences is enough. Add acceptance criteria if you know how you'll judge it.</p>

        <div className="mt-6 space-y-5">
          <div>
            <label className="label-mono block" htmlFor="project">
              Project
            </label>
            <div className="mt-2 flex flex-wrap gap-2" id="project" role="radiogroup">
              {state.projects.map((p) => (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={p.id === project.id}
                  onClick={() => {
                    setProjectId(p.id);
                    setAgentId(p.defaultAgent);
                    setAck(false);
                  }}
                  className={`rounded-md px-3 py-1.5 text-[13px] ring-1 transition-colors ${p.id === project.id ? "bg-amber/15 ring-amber/40 font-medium" : "bg-panel ring-line hover:bg-ink/[0.03]"}`}
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
              onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && submit()}
              rows={4}
              placeholder='e.g. Add a "Back in stock" email signup to sold-out product pages.'
              className="mt-2 w-full resize-y rounded-lg border border-line bg-panel px-4 py-3 text-[15px] leading-relaxed placeholder:text-dim/70 focus:border-amber"
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
              placeholder="How will you know it's done? If you skip this, the agent may ask a question first."
              className="mt-2 w-full resize-y rounded-lg border border-line bg-panel px-4 py-3 text-[13px] leading-relaxed placeholder:text-dim/70 focus:border-amber"
            />
          </div>

          <div>
            <div className="label-mono">Agent</div>
            <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup">
              {state.agents.map((a) => {
                const sel = a.id === agentId;
                return (
                  <button
                    key={a.id}
                    role="radio"
                    aria-checked={sel}
                    onClick={() => setAgentId(a.id)}
                    className={`rounded-lg p-3 text-left ring-1 transition-colors ${sel ? "bg-amber/15 ring-amber/40" : "bg-panel ring-line hover:bg-ink/[0.03]"}`}
                  >
                    <div className="text-[13px] font-medium">{a.name}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-dim">
                      {!a.installed ? "Not installed" : a.signedIn ? a.account : "Not signed in"}
                    </div>
                    {a.id === project.defaultAgent && <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-teal">Project default</div>}
                  </button>
                );
              })}
            </div>
            {!agent.installed && (
              <p className="mt-2 rounded-md bg-amber/10 px-3 py-2 text-[12px] leading-snug">
                {agent.name} isn't installed on this machine. Install it with <code className="font-mono">{agent.installHint}</code>, then ADE will detect it. Pick another agent for now.
              </p>
            )}
            {agent.installed && !agent.signedIn && (
              <div className="mt-2 flex items-center gap-3 rounded-md bg-amber/10 px-3 py-2 text-[12px] leading-snug">
                <span>{agent.name} is installed but not signed in yet.</span>
                <button onClick={() => setSigning(agent)} className="btn-amber ml-auto shrink-0 px-3 py-1 text-[12px]">
                  Sign in
                </button>
              </div>
            )}
          </div>

          {project.uncommittedFiles.length > 0 && (
            <div className="rounded-lg border border-amber/40 bg-amber/10 p-4">
              <div className="text-[13px] font-semibold">You have uncommitted work in {project.name}</div>
              <ul className="mt-1 font-mono text-[11px] text-dim">
                {project.uncommittedFiles.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <label className="mt-3 flex items-start gap-2 text-[12px] leading-snug">
                <input type="checkbox" checked={ackUncommitted} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-amber" />
                <span>The agent must leave these files alone and stop if the task requires touching them. It will never revert or overwrite your changes.</span>
              </label>
            </div>
          )}

          {overlapping.length > 0 && (
            <div className="rounded-lg border border-line bg-panel p-4 text-[12px] leading-snug">
              <span className="font-semibold">Heads up:</span> {overlapping.length} other task{overlapping.length === 1 ? " is" : "s are"} still running in {project.name}. ADE will flag it if both touch the same files and offer to sequence them.
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button onClick={submit} disabled={!canStart} className="btn-amber px-5 py-2.5 text-[14px]">
              Start task
            </button>
            <span className="font-mono text-[10px] text-dim">⌘↵ to start</span>
            <button onClick={() => navigate({ to: "/" })} className="btn-quiet ml-auto px-4 py-2 text-[13px]">
              Cancel
            </button>
          </div>
        </div>
      </div>
      {signing && <SignInDialog agent={signing} onClose={() => setSigning(null)} />}
    </main>
  );
}
