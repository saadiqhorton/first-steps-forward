import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type Layout,
} from "react-resizable-panels";
import { ChecksList } from "@/components/ade/ChecksList";
import { DiffView } from "@/components/ade/DiffView";
import { ModelPicker } from "@/components/ade/ModelPicker";
import { PreviewPane } from "@/components/ade/PreviewPane";
import { RightPanePortal } from "@/components/ade/RightPanePortal";
import { SessionMessage } from "@/components/ade/SessionMessage";
import { usePersistedLayout } from "@/components/ade/persistLayout";
import { StatusPill } from "@/components/ade/StatusPill";
import type { AgentId } from "@/lib/ade/types";
import { timeAgo, useAde } from "@/lib/ade/store";

const SESSION_BODY_LAYOUT_ID = "ade-session-body";
const SESSION_BODY_DEFAULT_LAYOUT: Layout = {
  "session-messages": 75,
  "session-bottom": 25,
};
const SESSION_BOTTOM_MIN_PX = 140;
const SESSION_BOTTOM_MAX_PCT = 70;

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
  const [sending, setSending] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Auto-scroll only if the reader is already near the bottom (or sent the
  // last message); updated from scroll events below.
  const stickToBottomRef = useRef(true);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const modelPanelRef = useRef<HTMLDivElement>(null);
  const switchPanelRef = useRef<HTMLDivElement>(null);
  const modelToggleRef = useRef<HTMLButtonElement>(null);
  const switchToggleRef = useRef<HTMLButtonElement>(null);
  const lastMessageRole = session?.messages[session.messages.length - 1]?.role;
  const lastMessageLength = session?.messages[session.messages.length - 1]?.text.length;

  const onMessagesScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, t: Tab) => {
    const order: Tab[] = ["changes", "checks", "logs"];
    const index = order.indexOf(t);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % order.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + order.length) % order.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = order.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = order[next] as Tab;
    setTab(target);
    tabRefs.current[target]?.focus();
  };
  // Local popover dismissal: Escape and outside pointerdown close the model
  // and switch-agent popovers. Escape is consumed with stopPropagation so the
  // Shell's window-level Escape (nav drawer) does not also fire, and focus
  // returns to the popover's own toggle.
  useEffect(() => {
    if (!editingModel && !switching) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      // Outside click closes and hands focus back to the toggle. A later
      // mousedown on a focusable element still wins, so focus only sticks
      // when the click landed on non-focusable space.
      if (
        editingModel &&
        !modelPanelRef.current?.contains(target) &&
        !modelToggleRef.current?.contains(target)
      ) {
        setEditingModel(false);
        modelToggleRef.current?.focus();
      }
      if (
        switching &&
        !switchPanelRef.current?.contains(target) &&
        !switchToggleRef.current?.contains(target)
      ) {
        setSwitching(false);
        switchToggleRef.current?.focus();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (switching) {
        setSwitching(false);
        switchToggleRef.current?.focus();
      }
      if (editingModel) {
        setEditingModel(false);
        modelToggleRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [editingModel, switching]);
  // Close the switch-agent popover when the session enters a state where the
  // API refuses switching (turn running, or complete).
  useEffect(() => {
    const status = session?.status;
    if (!status) return;
    if (["working", "verifying"].includes(status) || status === "complete") {
      setSwitching(false);
      if (status === "complete") setEditingModel(false);
    }
  }, [session?.status]);
  useEffect(() => {
    if (stickToBottomRef.current || lastMessageRole === "user")
      endRef.current?.scrollIntoView({ block: "end" });
  }, [session?.messages.length, session?.status, lastMessageRole, lastMessageLength]);

  // Plain `find` lookups (not hooks) resolved before the early returns below so
  // the hook order stays stable across every render.
  const project = state.projects.find((p) => p.id === session?.projectId);
  const agent = state.agents.find((a) => a.id === session?.agentId);

  // Resizable bottom (Files / Checks / Logs) panel. Persisted per-session-id;
  // SSR-safe because storage is only touched inside effects.
  const bodyGroupRef = useRef<GroupImperativeHandle | null>(null);
  const sessionLayoutKey = `${SESSION_BODY_LAYOUT_ID}:${sessionId}`;
  const { onLayoutChanged: onBodyLayoutChanged, hydrateGroup: hydrateBody } =
    usePersistedLayout(sessionLayoutKey);
  const hydratedSessionId = session?.id;
  useEffect(() => {
    // Runs after the Group commits (its ref is set during commit), applying any
    // persisted height once per session.
    if (!hydratedSessionId) return;
    hydrateBody(bodyGroupRef, SESSION_BODY_DEFAULT_LAYOUT);
  }, [hydratedSessionId, hydrateBody]);

  if (!session) {
    if (!state.hydrated) return <main className="flex-1" />;
    throw notFound();
  }
  if (!project) return <main className="flex-1 p-8">Project not found.</main>;
  const running = ["working", "verifying"].includes(session.status);
  const dev = state.processes.find((p) => p.projectId === project.id);
  const previewUrl =
    dev?.status === "running" && dev.port > 0 ? `http://127.0.0.1:${dev.port}` : null;
  const switchBlockReason = running
    ? "Unavailable while a turn runs"
    : session.status === "complete"
      ? "Unavailable once complete"
      : null;

  const send = async () => {
    const outgoing = text.trim();
    if (!outgoing || sending) return;
    setSending(true);
    setSendError(null);
    stickToBottomRef.current = true;
    try {
      await steer(session.id, outgoing);
      // Clear only the text we actually sent; anything typed while the
      // request was in flight is kept.
      setText((current) => (current === text ? "" : current));
    } catch (e) {
      // Keep the draft in the composer and surface the failure there.
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };
  const markComplete = async () => {
    if (completing) return;
    setCompleting(true);
    try {
      await complete(session.id);
    } finally {
      setCompleting(false);
    }
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
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Header sits above the resizable main/bottom split so it stays pinned
            at the top regardless of how much vertical space the user gives
            to the messages log. */}
        <header className="shrink-0 border-b border-line px-7 pt-5 pb-4">
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
                  ref={modelToggleRef}
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
                  <div
                    ref={modelPanelRef}
                    className="absolute left-0 z-20 mt-1 w-96 rounded-md bg-panel p-3 shadow-lg ring-1 ring-ink/10"
                  >
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
                ref={switchToggleRef}
                onClick={() => setSwitching((v) => !v)}
                disabled={!!switchBlockReason}
                title={switchBlockReason ?? undefined}
                className="btn-quiet px-2.5 py-1 font-mono text-[11px] disabled:opacity-50"
                aria-expanded={switching}
              >
                Switch agent ▾
              </button>
              {switchBlockReason && (
                <span className="ml-2 font-mono text-[10px] text-dim">{switchBlockReason}</span>
              )}
              {switching && (
                <div
                  ref={switchPanelRef}
                  className="absolute left-0 z-20 mt-1 w-80 rounded-md bg-panel p-2 shadow-lg ring-1 ring-ink/10"
                >
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
                  onClick={() => void markComplete()}
                  disabled={completing}
                  className="btn-amber px-3 py-1.5 text-[12px] disabled:opacity-60"
                >
                  {completing ? "Completing…" : "Mark complete"}
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
          <div
            className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-[11px] text-dim"
            aria-label="Project environment"
          >
            <span className="font-medium text-ink">Project environment</span>
            <span>
              Preview:{" "}
              {previewUrl ? (
                <a
                  className="text-teal underline underline-offset-2"
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {previewUrl}
                </a>
              ) : dev?.status === "starting" ? (
                "starting…"
              ) : (
                "not running in ADE"
              )}
            </span>
            <span>Other services: not verified by ADE</span>
            {session.manifest && (
              <span className="font-mono">
                Last agent snapshot: {timeAgo(state.now, session.manifest.createdAt)}
              </span>
            )}
          </div>
        </header>

        {/* Messages log (above) and the Files / Checks / Logs tabbed panel
            (below) share the remaining vertical space. The seam between them
            is draggable and persisted per-session-id in localStorage. */}
        <Group
          id={SESSION_BODY_LAYOUT_ID}
          groupRef={bodyGroupRef}
          orientation="vertical"
          defaultLayout={SESSION_BODY_DEFAULT_LAYOUT}
          onLayoutChanged={onBodyLayoutChanged}
          style={{ display: "flex", flex: 1, minHeight: 0 }}
        >
          <Panel
            id="session-messages"
            minSize="30%"
            style={{ minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
          >
            <div
              ref={scrollRef}
              onScroll={onMessagesScroll}
              className="min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto px-7 py-5"
            >
              {session.messages.map((m) => (
                <SessionMessage key={m.id} message={m} agentName={agent?.short} />
              ))}
              {session.manifest && (
                <details className="card-panel px-4 py-3 text-[12px]">
                  <summary className="label-mono cursor-pointer select-none">
                    Agent context · {session.manifest.relevantFiles.length} candidate files
                  </summary>
                  <dl className="mt-3 grid min-w-0 grid-cols-[minmax(90px,120px)_minmax(0,1fr)] gap-x-3 gap-y-2 [overflow-wrap:anywhere]">
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
                    <dt className="text-dim">Dev server at turn start</dt>
                    <dd>{session.manifest.devServer ?? "Not recorded"}</dd>
                    <dt className="text-dim">Other services at turn start</dt>
                    <dd>{session.manifest.otherServices ?? "Not verified by ADE"}</dd>
                  </dl>
                  <details className="mt-3 border-t border-line pt-2">
                    <summary className="cursor-pointer text-dim">
                      Technical details · tools, safety rules, files
                    </summary>
                    <div className="mt-2 text-dim">Tools: {session.manifest.tools}</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 [overflow-wrap:anywhere]">
                      {session.manifest.constraints.map((constraint) => (
                        <li key={constraint}>{constraint}</li>
                      ))}
                    </ul>
                    <div className="mt-3 text-dim">Candidate files</div>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed [overflow-wrap:anywhere]">
                      {session.manifest.relevantFiles.join("\n") || "(none listed)"}
                    </pre>
                  </details>
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
                      <strong>Provider limit reached.</strong> The agent could not start: your
                      provider reports no usage left (a billing/rate matter, not an ADE fault).
                      Nothing in the project changed; your task is kept. Wait for the limit to
                      reset, upgrade with your provider, or switch agents on this session.
                    </>
                  ) : session.failureKind === "model_not_found" ? (
                    <>
                      <strong>Model not found.</strong> The agent rejected the selected model
                      {session.model ? ` (“${session.model}”)` : ""}. Nothing in the project
                      changed; your task is kept. Pick a different model with Change model above, or
                      clear it to use the agent's configured default, then send a follow-up. The
                      CLI's own "did you mean" suggestions, if any, are in its message and Logs.
                    </>
                  ) : session.failureKind === "provider_unavailable" ? (
                    <>
                      <strong>Provider unavailable.</strong> The agent reported that its provider
                      could not be used. ADE does not manage provider credentials — check this CLI's
                      own provider setup on the Agents page. Nothing in the project changed.
                    </>
                  ) : session.failureKind === "auth_expired" ? (
                    <>
                      <strong>Sign-in rejected.</strong> The agent's credentials were refused or
                      expired. Re-authenticate with this CLI's own sign-in flow (Agents page → Set
                      up); ADE never collects tokens. Nothing in the project changed; your task is
                      kept.
                    </>
                  ) : session.failureKind === "context_overflow" ? (
                    <>
                      <strong>Context window exceeded.</strong> The conversation outgrew the model's
                      context. Shorten or summarize your follow-up, start a fresh session for a
                      narrower task, or pick a larger-context model with Change model. Any project
                      edits made before the failure were left in place.
                    </>
                  ) : (
                    <>
                      The agent process exited unsuccessfully. Review its real output in Logs;
                      existing files were not reset.
                    </>
                  )}
                </div>
              )}
              {session.status === "ready" && (
                <div className="card-panel p-4 ring-1 ring-teal/40">
                  <div className="label-mono text-teal">Ready to review</div>
                  <p className="mt-1 text-[13px]">
                    The CLI has exited. Inspect the actual project diff and run checks explicitly;
                    ADE did not run checks automatically.
                  </p>
                  <p className="mt-2 font-mono text-[10px] text-dim">
                    Use “Mark complete” in the header when the result looks right.
                  </p>
                </div>
              )}
              <div ref={endRef} />
            </div>
          </Panel>
          <Separator
            id="seam-session-bottom"
            className="panel-seam"
            data-orientation="horizontal"
          />
          <Panel
            id="session-bottom"
            minSize={`${SESSION_BOTTOM_MIN_PX}px`}
            maxSize={`${SESSION_BOTTOM_MAX_PCT}%`}
            style={{ minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
          >
            <div className="flex min-h-0 flex-1 flex-col bg-panel">
              <div
                className="flex shrink-0 flex-wrap items-center gap-1 px-7 pt-3"
                role="tablist"
                aria-label="Session panels"
              >
                {(["changes", "checks", "logs"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    ref={(el) => {
                      tabRefs.current[t] = el;
                    }}
                    id={`session-tab-${t}`}
                    onClick={() => setTab(t)}
                    onKeyDown={(e) => onTabKeyDown(e, t)}
                    aria-selected={tab === t}
                    aria-controls={`session-panel-${t}`}
                    role="tab"
                    tabIndex={tab === t ? 0 : -1}
                    className={`rounded-md px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${tab === t ? "bg-ink text-paper" : "text-dim hover:text-ink"}`}
                  >
                    {t === "changes"
                      ? session.changeCountUnavailable
                        ? "Files changed"
                        : `Files changed (${session.changes.length})`
                      : t === "checks"
                        ? `Checks (${session.checks.length})`
                        : `Logs (${session.logs.length})`}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-7 py-3">
                {(["changes", "checks", "logs"] as Tab[]).map((t) => (
                  <div
                    key={t}
                    id={`session-panel-${t}`}
                    aria-labelledby={`session-tab-${t}`}
                    role="tabpanel"
                    hidden={tab !== t}
                    tabIndex={0}
                  >
                    {t === "changes" && (
                      <DiffView
                        changes={session.changes}
                        unavailable={!!session.changeCountUnavailable}
                      />
                    )}
                    {t === "checks" && (
                      <>
                        <ChecksList checks={session.checks} />
                        {session.status === "ready" && (
                          <button
                            disabled={busy}
                            onClick={() => void checksClick()}
                            className="btn-quiet mt-3 px-3 py-1.5 text-[12px]"
                          >
                            {busy ? "Running…" : "Run project checks"}
                          </button>
                        )}
                        {session.status === "blocked" && (
                          <p className="mt-3 text-[12px] text-dim">
                            Checks run once the session is ready to review. Clear the blocker above
                            — re-authenticate, switch agents, or send a follow-up — then run them
                            here.
                          </p>
                        )}
                      </>
                    )}
                    {t === "logs" &&
                      (session.logs.length ? (
                        <pre className="whitespace-pre-wrap break-words rounded-md bg-ink px-3 py-2 font-mono text-[11px] leading-relaxed text-paper/80 [overflow-wrap:anywhere]">
                          {session.logs.join("\n")}
                        </pre>
                      ) : (
                        <p className="text-[12px] text-dim">No CLI output yet.</p>
                      ))}
                  </div>
                ))}
              </div>
              <div className="flex shrink-0 gap-2 border-t border-line px-7 py-3">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) void send();
                  }}
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
                  onClick={() => void send()}
                  disabled={!text.trim() || session.status === "complete" || sending}
                  className="btn-amber px-4 py-2 text-[13px] disabled:opacity-60"
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
              {sendError && (
                <p role="alert" className="px-7 pb-3 text-[12px] leading-relaxed text-danger">
                  Couldn’t send: {sendError} Your text is still in the composer.
                </p>
              )}
            </div>
          </Panel>
        </Group>
      </main>
      <RightPanePortal>
        <PreviewPane project={project} session={session} />
      </RightPanePortal>
    </>
  );
}
