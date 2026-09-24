import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChecksList } from "@/components/ade/ChecksList";
import { DiffView } from "@/components/ade/DiffView";
import { PreviewPane } from "@/components/ade/PreviewPane";
import { StatusPill } from "@/components/ade/StatusPill";
import type { AgentId } from "@/lib/ade/types";
import { timeAgo, useAde } from "@/lib/ade/store";

export const Route = createFileRoute("/sessions/$sessionId")({
  head: () => ({
    meta: [
      { title: "Work session — ADE" },
      { name: "description", content: "Follow an agent session: request, status, changes, checks, and preview in one place." },
      { property: "og:title", content: "Work session — ADE" },
      { property: "og:description", content: "Steer the agent, review what changed, and mark the task complete." },
    ],
  }),
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
  const { state, answer, decide, steer, complete, reopen, stop, switchAgent } = useAde();
  const session = state.sessions.find((s) => s.id === sessionId);
  const [tab, setTab] = useState<Tab>("changes");
  const [text, setText] = useState("");
  const [switching, setSwitching] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [session?.messages.length, session?.status]);

  if (!session) {
    if (!state.hydrated) return <main className="flex-1" />;
    throw notFound();
  }
  const project = state.projects.find((p) => p.id === session.projectId)!;
  const agent = state.agents.find((a) => a.id === session.agentId)!;
  const creator = state.agents.find((a) => a.id === session.createdBy)!;
  const live = ["working", "verifying", "needs_input", "awaiting_approval"].includes(session.status);
  const failed = session.checks.some((c) => c.status === "failed");

  const send = () => {
    if (!text.trim()) return;
    steer(session.id, text.trim());
    setText("");
  };

  return (
    <>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-line px-7 pt-5 pb-4">
          <div className="flex items-center gap-2">
            <Link to="/" className="label-mono hover:text-ink">
              {project.name}
            </Link>
            <span className="label-mono">/ session</span>
            <span className="ml-auto font-mono text-[10px] text-dim">
              started {timeAgo(state.now, session.createdAt)} · by {creator.short}
              {creator.id !== agent.id ? ` · now ${agent.short}` : ""}
            </span>
          </div>
          <h1 className="mt-2 text-[20px] font-semibold leading-snug">{session.request}</h1>
          {session.criteria && (
            <p className="mt-1 text-[12px] leading-snug text-dim">
              <span className="font-semibold text-ink/70">Done when:</span> {session.criteria}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill status={session.status} size="md" />
            <span className="mx-1 text-line">|</span>
            <div className="relative">
              <button onClick={() => setSwitching((v) => !v)} className="btn-quiet px-2.5 py-1 font-mono text-[11px]" aria-expanded={switching}>
                {agent.name} · {agent.account ?? "not signed in"} ▾
              </button>
              {switching && (
                <div className="absolute left-0 z-20 mt-1 w-80 rounded-md bg-panel p-2 ring-1 ring-ink/10 shadow-lg">
                  <div className="label-mono px-2 py-1">Switch agent for this session</div>
                  {state.agents.map((a) => {
                    const ok = a.installed && a.signedIn;
                    return (
                      <button
                        key={a.id}
                        disabled={!ok || a.id === agent.id}
                        onClick={() => {
                          switchAgent(session.id, a.id as AgentId);
                          setSwitching(false);
                        }}
                        className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-ink/[0.04] disabled:opacity-50"
                      >
                        <span className="text-[13px]">
                          {a.name} {a.id === agent.id && <span className="font-mono text-[10px] text-dim">current</span>}
                        </span>
                        <span className="font-mono text-[10px] text-dim">
                          {!a.installed ? "Not installed" : !a.signedIn ? "Not signed in" : a.carriesConversation ? "Carries over: repo, task, files, conversation" : "Carries over: repo, task, files — not the conversation"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="ml-auto flex gap-2">
              {live && (
                <button onClick={() => stop(session.id)} className="btn-quiet px-3 py-1.5 text-[12px]">
                  Stop
                </button>
              )}
              {session.status === "ready" && (
                <button onClick={() => complete(session.id)} className="btn-amber px-3 py-1.5 text-[12px]">
                  Mark complete
                </button>
              )}
              {(session.status === "complete" || session.status === "stopped") && (
                <button onClick={() => reopen(session.id)} className="btn-quiet px-3 py-1.5 text-[12px]">
                  Reopen
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-7 py-5">
          {session.messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} animate-rise`}>
              <div
                className={`max-w-[78%] rounded-lg px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-ink text-paper"
                    : m.role === "system"
                      ? "border border-amber/40 bg-amber/10"
                      : "card-panel"
                }`}
              >
                {m.role !== "user" && (
                  <div className="label-mono mb-1 tracking-[0.14em]">{m.role === "system" ? "ADE" : agent.short}</div>
                )}
                {m.text}
              </div>
            </div>
          ))}

          {(session.status === "working" || session.status === "verifying") && (
            <div className="flex items-center gap-2 text-[12px] text-dim">
              <span className="size-1.5 rounded-full bg-teal animate-pulse-soft" aria-hidden />
              {session.status === "verifying" ? "Running the project's checks…" : `${agent.short} is working…`}
            </div>
          )}

          {session.status === "needs_input" && session.question && (
            <div className="card-panel p-4 ring-1 ring-amber/40 animate-rise">
              <div className="label-mono text-amber-deep">Needs you</div>
              <p className="mt-1 text-[14px]">{session.question.text}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {session.question.options.map((o, i) => (
                  <button key={o} onClick={() => answer(session.id, o)} className={`px-3 py-1.5 text-[12px] font-medium ${i === 0 ? "btn-amber" : "btn-quiet"}`}>
                    {o}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-dim">Or type a longer answer below.</p>
            </div>
          )}

          {session.status === "awaiting_approval" && session.approval && (
            <div className="card-panel p-4 ring-1 ring-amber/40 animate-rise">
              <div className="label-mono text-amber-deep">Needs your approval</div>
              <p className="mt-1 text-[14px] font-semibold">{session.approval.action}</p>
              <dl className="mt-2 grid grid-cols-[80px_1fr] gap-y-1 text-[12px]">
                <dt className="text-dim">Target</dt>
                <dd>{session.approval.target}</dd>
                <dt className="text-dim">Scope</dt>
                <dd>{session.approval.scope}</dd>
                <dt className="text-dim">Why</dt>
                <dd>{session.approval.risk === "external" ? "Changes something outside this machine." : session.approval.risk === "destructive" ? "Could remove files or data." : "May incur cost."}</dd>
                <dt className="text-dim">Undo</dt>
                <dd>{session.approval.rollback}</dd>
              </dl>
              <div className="mt-3 flex gap-2">
                <button onClick={() => decide(session.id, true)} className="btn-amber px-3 py-1.5 text-[12px]">
                  Allow this once
                </button>
                <button onClick={() => decide(session.id, false)} className="btn-quiet px-3 py-1.5 text-[12px]">
                  Don't allow
                </button>
              </div>
              <p className="mt-2 text-[11px] text-dim">Approval covers only this action, target, and scope.</p>
            </div>
          )}

          {session.status === "ready" && (
            <div className={`card-panel p-4 ring-1 ${failed ? "ring-amber/40" : "ring-teal/40"} animate-rise`}>
              <div className={`label-mono ${failed ? "text-amber-deep" : "text-teal"}`}>{failed ? "Ready to review · a check failed" : "Ready to review"}</div>
              <p className="mt-1 text-[13px] leading-snug">
                {failed
                  ? "The change is in place, but not verified. Ask the agent to investigate the failing test, or review the diff yourself."
                  : "Try it in the preview, look at the changes, then mark the task complete. Nothing is deployed yet."}
              </p>
              <div className="mt-3 flex gap-2">
                {failed && (
                  <button onClick={() => steer(session.id, "Investigate the failing test and fix only that.")} className="btn-amber px-3 py-1.5 text-[12px]">
                    Investigate the failing test
                  </button>
                )}
                <button onClick={() => complete(session.id)} className={`px-3 py-1.5 text-[12px] ${failed ? "btn-quiet" : "btn-amber"}`}>
                  Mark complete
                </button>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-line bg-panel">
          <div className="flex items-center gap-1 px-7 pt-3">
            {(["changes", "checks", "logs"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                aria-selected={tab === t}
                role="tab"
                className={`rounded-md px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${tab === t ? "bg-ink text-paper" : "text-dim hover:text-ink"}`}
              >
                {t === "changes" ? `Files changed (${session.changes.length})` : t === "checks" ? `Checks (${session.checks.length})` : `Logs (${session.logs.length})`}
              </button>
            ))}
          </div>
          <div className="max-h-56 overflow-y-auto px-7 py-3" role="tabpanel">
            {tab === "changes" && <DiffView changes={session.changes} />}
            {tab === "checks" && <ChecksList checks={session.checks} />}
            {tab === "logs" &&
              (session.logs.length ? (
                <pre className="rounded-md bg-ink px-3 py-2 font-mono text-[11px] leading-relaxed text-paper/80">{session.logs.join("\n")}</pre>
              ) : (
                <p className="text-[12px] text-dim">No log output yet.</p>
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
                  ? "Reopen the session to keep going."
                  : session.status === "needs_input"
                    ? "Type an answer…"
                    : "Steer or ask a follow-up…"
              }
              aria-label="Message the agent"
              className="flex-1 rounded-md border border-line bg-paper px-3 py-2 text-[13px] placeholder:text-dim/70 focus:border-amber disabled:opacity-60"
            />
            <button onClick={send} disabled={!text.trim() || session.status === "complete"} className="btn-amber px-4 py-2 text-[13px]">
              Send
            </button>
          </div>
        </div>
      </main>
      <PreviewPane project={project} session={session} />
    </>
  );
}
