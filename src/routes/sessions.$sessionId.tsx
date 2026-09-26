import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChecksList } from "@/components/ade/ChecksList";
import { DiffView } from "@/components/ade/DiffView";
import { ModelPicker } from "@/components/ade/ModelPicker";
import { PreviewPane } from "@/components/ade/PreviewPane";
import { StatusPill } from "@/components/ade/StatusPill";
import type { AgentId } from "@/lib/ade/types";
import { timeAgo, useAde } from "@/lib/ade/store";

export const Route = createFileRoute("/sessions/$sessionId")({
  head: () => ({ meta: [{ title: "Work session — ADE" }] }),
  component: SessionPage,
  notFoundComponent: () => (
    <main className="grid flex-1 place-items-center">
      <div className="text-center">
        <div className="font-display text-3xl">Session not found</div>
        <Link to="/" className="btn-quiet mt-3 inline-block px-3 py-1.5 text-[12px]">
          Back home
        </Link>
      </div>
    </main>
  ),
});
type Tab = "changes" | "checks" | "logs";
function SessionPage() {
  const { sessionId } = Route.useParams();
  const { state, steer, complete, reopen, stop, runChecks, switchAgent, setSessionModel } =
    useAde();
  const session = state.sessions.find((s) => s.id === sessionId);
  const [tab, setTab] = useState<Tab>("changes");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [editingModel, setEditingModel] = useState(false);
  const [modelDraft, setModelDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [session?.messages.length, session?.status]);
  if (!session) {
    if (!state.hydrated) return <main className="flex-1" />;
    throw notFound();
  }
  const project = state.projects.find((p) => p.id === session.projectId);
  const agent = state.agents.find((a) => a.id === session.agentId);
  if (!project) return <main className="flex-1 p-8">Project not found.</main>;
  const running = ["working", "verifying"].includes(session.status);
  const send = () => {
    if (!text.trim()) return;
    steer(session.id, text.trim());
    setText("");
  };
  const applyModel = async (next: string) => {
    if ((session.model ?? "") === next.trim()) return;
    try {
      await setSessionModel(session.id, next.trim());
      setEditingModel(false);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };
  const checksClick = async () => {
    if (
      !window.confirm(
        "Run this project's detected check scripts now? Project scripts can execute code and may access the network.",
      )
    )
      return;
    setBusy(true);
    try {
      await runChecks(session.id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-line px-7 pt-5 pb-4">
          <div className="flex items-center gap-2">
            <Link to="/" className="label-mono hover:text-ink">
              {project.name}
            </Link>
            <span className="label-mono">/ task</span>
            <span className="ml-auto font-mono text-[10px] text-dim">
              started {timeAgo(state.now, session.createdAt)} · {agent?.short ?? session.agentId}
            </span>
          </div>
          <h1 className="mt-2 text-[20px] font-semibold leading-snug">{session.request}</h1>
          {session.criteria && (
            <p className="mt-1 text-[12px] text-dim">
              <strong className="text-ink/70">Done when:</strong> {session.criteria}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <StatusPill status={session.status} size="md" />
            <span className="font-mono text-[10px] text-dim">
              {agent?.name} · model: {session.model ?? "agent default"} · real local CLI process
            </span>
            {session.status !== "complete" && (
              <div className="relative">
                <button
                  onClick={() => {
                    if (!editingModel) setModelDraft(session.model ?? "");
                    setEditingModel((v) => !v);
                  }}
                  className="btn-quiet px-2.5 py-1 font-mono text-[11px]"
                  aria-expanded={editingModel}
                >
                  Change model ▾
                </button>
                {editingModel && (
                  <div className="absolute left-0 z-20 mt-1 w-96 rounded-md bg-panel p-3 shadow-lg ring-1 ring-ink/10">
                    <ModelPicker
                      agentId={session.agentId}
                      agentName={agent?.name ?? session.agentId}
                      value={modelDraft}
                      onChange={setModelDraft}
                      idSuffix="-session"
                    />
                    <p className="mt-2 text-[11px] leading-relaxed text-dim">
                      {running
                        ? "The turn already running keeps its current model; an applied change takes effect from the next turn."
                        : "An applied change takes effect from the next turn. The current conversation continues — per-CLI semantics of changing models mid-conversation are not verified."}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => void applyModel(modelDraft)}
                        disabled={modelDraft.trim() === (session.model ?? "")}
                        className="btn-amber px-3 py-1 text-[12px]"
                      >
                        Apply
                      </button>
                      <button
                        onClick={() => setEditingModel(false)}
                        className="btn-quiet px-3 py-1 text-[12px]"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="relative">
              <button
                onClick={() => setSwitching((v) => !v)}
                className="btn-quiet px-2.5 py-1 font-mono text-[11px]"
                aria-expanded={switching}
              >
                Switch agent ▾
              </button>
              {switching && (
                <div className="absolute left-0 z-20 mt-1 w-80 rounded-md bg-panel p-2 shadow-lg ring-1 ring-ink/10">
                  <div className="label-mono px-2 py-1">
                    New agent continues the task, not the conversation
                  </div>
                  {state.agents.map((a) => {
                    const ok = a.installed && a.signedIn;
                    return (
                      <button
                        key={a.id}
                        disabled={!ok || a.id === session.agentId}
                        onClick={() => {
                          setSwitching(false);
                          void switchAgent(session.id, a.id as AgentId).catch((e) =>
                            window.alert(e instanceof Error ? e.message : String(e)),
                          );
                        }}
                        className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-ink/[0.04] disabled:opacity-50"
                      >
                        <span className="text-[13px]">
                          {a.name}
                          {a.id === session.agentId && (
                            <span className="ml-1 font-mono text-[10px] text-dim">current</span>
                          )}
                        </span>
                        <span className="font-mono text-[10px] text-dim">
                          {!a.installed
                            ? "Not installed"
                            : !a.signedIn
                              ? "Not signed in"
                              : "Carries over: repo, task, diff — not the conversation"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="ml-auto flex gap-2">
              {running && (
                <button
                  onClick={() => stop(session.id)}
                  className="btn-quiet px-3 py-1.5 text-[12px]"
                >
                  Stop
                </button>
              )}
              {["ready", "blocked", "stopped"].includes(session.status) && (
                <button
                  onClick={() => complete(session.id)}
                  className="btn-amber px-3 py-1.5 text-[12px]"
                >
                  Mark complete
                </button>
              )}
              {session.status === "complete" && (
                <button
                  onClick={() => reopen(session.id)}
                  className="btn-quiet px-3 py-1.5 text-[12px]"
                >
                  Reopen
                </button>
              )}
            </div>
          </div>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto px-7 py-5">
          {session.messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-4 py-2.5 text-[13.5px] leading-relaxed ${m.role === "user" ? "bg-ink text-paper" : m.role === "system" ? "border border-amber/40 bg-amber/10" : "card-panel"}`}
              >
                {m.role !== "user" && (
                  <div className="label-mono mb-1">
                    {m.role === "system" ? "ADE" : agent?.short}
                  </div>
                )}
                {m.text}
              </div>
            </div>
          ))}
          {session.manifest && (
            <details className="card-panel px-4 py-3 text-[12px]">
              <summary className="label-mono cursor-pointer select-none">
                Context manifest · {session.manifest.relevantFiles.length} candidate files ·{" "}
                {session.manifest.tools}
              </summary>
              <dl className="mt-2 grid grid-cols-[100px_1fr] gap-y-1">
                <dt className="text-dim">Project</dt>
                <dd>
                  {session.manifest.project.name} · {session.manifest.project.branch}
                </dd>
                <dt className="text-dim">Agent</dt>
                <dd>
                  {session.manifest.agent.id}
                  {session.manifest.agent.account ? ` · ${session.manifest.agent.account}` : ""}
                </dd>
                <dt className="text-dim">Model</dt>
                <dd>{session.manifest.agent.model ?? session.model ?? "agent default"}</dd>
                <dt className="text-dim">Constraints</dt>
                <dd>{session.manifest.constraints.join("; ")}</dd>
                <dt className="text-dim">Files</dt>
                <dd className="max-h-32 overflow-y-auto font-mono text-[10.5px] leading-relaxed">
                  {session.manifest.relevantFiles.join("\n") || "(none listed)"}
                </dd>
              </dl>
            </details>
          )}
          {running && (
            <div className="flex items-center gap-2 text-[12px] text-dim">
              <span className="size-1.5 animate-pulse-soft rounded-full bg-teal" />
              {session.status === "verifying"
                ? "Running checks…"
                : `${agent?.short ?? "Agent"} is running locally…`}
              {session.queuedMessages?.length ? " · follow-up queued" : ""}
            </div>
          )}
          {session.status === "blocked" && (
            <div
              className={`rounded border p-3 text-[12px] ${session.failureKind && session.failureKind !== "process" ? "border-amber/40 bg-amber/5" : "border-danger/30 bg-danger/5"}`}
            >
              {session.failureKind === "provider_quota" ? (
                <>
                  <strong>Provider limit reached.</strong> The agent could not start: your provider
                  reports no usage left (a billing/rate matter, not an ADE fault). Nothing in the
                  project changed; your task is kept. Wait for the limit to reset, upgrade with your
                  provider, or switch agents on this session.
                </>
              ) : session.failureKind === "model_not_found" ? (
                <>
                  <strong>Model not found.</strong> The agent rejected the selected model
                  {session.model ? ` (“${session.model}”)` : ""}. Nothing in the project changed;
                  your task is kept. Pick a different model with Change model above, or clear it to
                  use the agent's configured default, then send a follow-up. The CLI's own "did you
                  mean" suggestions, if any, are in its message and Logs.
                </>
              ) : session.failureKind === "provider_unavailable" ? (
                <>
                  <strong>Provider unavailable.</strong> The agent reported that its provider could
                  not be used. ADE does not manage provider credentials — check this CLI's own
                  provider setup on the Agents page. Nothing in the project changed.
                </>
              ) : session.failureKind === "auth_expired" ? (
                <>
                  <strong>Sign-in rejected.</strong> The agent's credentials were refused or
                  expired. Re-authenticate with this CLI's own sign-in flow (Agents page → Set up);
                  ADE never collects tokens. Nothing in the project changed; your task is kept.
                </>
              ) : session.failureKind === "context_overflow" ? (
                <>
                  <strong>Context window exceeded.</strong> The conversation outgrew the model's
                  context. Shorten or summarize your follow-up, start a fresh session for a narrower
                  task, or pick a larger-context model with Change model. Any project edits made
                  before the failure were left in place.
                </>
              ) : (
                <>
                  The agent process exited unsuccessfully. Review its real output in Logs; existing
                  files were not reset.
                </>
              )}
            </div>
          )}
          {session.status === "ready" && (
            <div className="card-panel p-4 ring-1 ring-teal/40">
              <div className="label-mono text-teal">Ready to review</div>
              <p className="mt-1 text-[13px]">
                The CLI has exited. Inspect the actual project diff and run checks explicitly; ADE
                did not run checks automatically.
              </p>
              <button
                onClick={() => complete(session.id)}
                className="btn-amber mt-3 px-3 py-1.5 text-[12px]"
              >
                Mark complete
              </button>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <div className="border-t border-line bg-panel">
          <div className="flex items-center gap-1 px-7 pt-3" role="tablist">
            {(["changes", "checks", "logs"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                aria-selected={tab === t}
                role="tab"
                className={`rounded-md px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${tab === t ? "bg-ink text-paper" : "text-dim hover:text-ink"}`}
              >
                {t === "changes"
                  ? `Files changed (${session.changes.length})`
                  : t === "checks"
                    ? `Checks (${session.checks.length})`
                    : `Logs (${session.logs.length})`}
              </button>
            ))}
          </div>
          <div className="max-h-56 overflow-y-auto px-7 py-3" role="tabpanel">
            {tab === "changes" && <DiffView changes={session.changes} />}
            {tab === "checks" && (
              <>
                <ChecksList checks={session.checks} />
                {!running && (
                  <button
                    disabled={busy}
                    onClick={() => void checksClick()}
                    className="btn-quiet mt-3 px-3 py-1.5 text-[12px]"
                  >
                    {busy ? "Running…" : "Run project checks"}
                  </button>
                )}
              </>
            )}
            {tab === "logs" &&
              (session.logs.length ? (
                <pre className="whitespace-pre-wrap rounded-md bg-ink px-3 py-2 font-mono text-[11px] leading-relaxed text-paper/80">
                  {session.logs.join("\n")}
                </pre>
              ) : (
                <p className="text-[12px] text-dim">No CLI output yet.</p>
              ))}
          </div>
          <div className="flex gap-2 border-t border-line px-7 py-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              disabled={session.status === "complete"}
              placeholder={
                session.status === "complete"
                  ? "Reopen the session to continue."
                  : running
                    ? "Queue a follow-up for after this turn…"
                    : "Send a follow-up to the same agent session…"
              }
              aria-label="Message the agent"
              className="flex-1 rounded-md border border-line bg-paper px-3 py-2 text-[13px] placeholder:text-dim/70 disabled:opacity-60"
            />
            <button
              onClick={send}
              disabled={!text.trim() || session.status === "complete"}
              className="btn-amber px-4 py-2 text-[13px]"
            >
              Send
            </button>
          </div>
        </div>
      </main>
      <PreviewPane project={project} session={session} />
    </>
  );
}
