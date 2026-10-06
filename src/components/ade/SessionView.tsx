import { useEffect, useMemo, useRef, useState } from "react";
import { Link, notFound } from "@tanstack/react-router";
import { ActivityPanel } from "@/components/ade/ActivityPanel";
import { type AgentSelection } from "@/components/ade/AgentPicker";
import { Composer } from "@/components/ade/Composer";
import { DiffPanel } from "@/components/ade/DiffPanel";
import { RightPanePortal } from "@/components/ade/RightPanePortal";
import { SessionMessage } from "@/components/ade/SessionMessage";
import { MotionItem } from "@/components/ade/motion";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { AnimatePresence } from "motion/react";
import { StatusPill } from "@/components/ade/StatusPill";
import { useShell } from "@/components/ade/shellContext";
import { resolveModelForAgent, writeLastModel } from "@/lib/ade/lastModels";
import { currentActivity } from "@/lib/ade/formatLogs.mjs";
import { sessionTitle } from "@/lib/ade/sessionTitle";
import { askConfirm, warnUser } from "@/components/ade/NoticeDialog";
import { agentModels, timeAgo, uploadAttachment, useAde } from "@/lib/ade/store";

function waitingPreview(prompt: string) {
  const visible = prompt.split("\n\nThe user attached these files")[0]?.trim() ?? "";
  if (visible.length <= 140) return visible;
  return `${visible.slice(0, 139)}…`;
}

const stopButtonClass =
  "shrink-0 rounded-md border border-line bg-paper px-3 py-1.5 text-[13px] font-medium text-ink";

function selectionFromSession(session: {
  agentId: AgentSelection["agentId"];
  model?: string;
  effort?: string;
  speed?: string;
  permission?: AgentSelection["permission"];
}): AgentSelection {
  return {
    agentId: session.agentId,
    model: session.model ?? "",
    effort: session.effort ?? "",
    speed: session.speed ?? "",
    permission: session.permission ?? "build",
  };
}

export function SessionView({ sessionId }: { sessionId: string }) {
  const { state, steer, complete, reopen, stop, switchAgent, setSessionOptions, runChecks } =
    useAde();
  const { rightTab } = useShell();
  const session = state.sessions.find((s) => s.id === sessionId);
  const [selection, setSelection] = useState<AgentSelection | null>(null);
  const [sending, setSending] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [checksBusy, setChecksBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Auto-scroll only if the reader is already near the bottom (or sent the
  // last message); updated from scroll events below.
  const stickToBottomRef = useRef(true);
  const lastMessageRole = session?.messages[session.messages.length - 1]?.role;
  const lastMessageLength = session?.messages[session.messages.length - 1]?.text.length;

  const onMessagesScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (stickToBottomRef.current || lastMessageRole === "user")
      endRef.current?.scrollIntoView({ block: "end" });
  }, [session?.messages.length, session?.status, lastMessageRole, lastMessageLength]);

  useEffect(() => {
    if (!session) return;
    setSelection(selectionFromSession(session));
    // Intentionally keyed on option fields only so bootstrap polling does not
    // clobber in-flight picker edits when the Session object identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync on option fields
  }, [
    session?.id,
    session?.agentId,
    session?.model,
    session?.effort,
    session?.speed,
    session?.permission,
  ]);

  // Prefer last model for this agent when the session has none pinned.
  useEffect(() => {
    if (!session) return;
    const agentId = session.agentId;
    if (session.model?.trim()) {
      writeLastModel(agentId, session.model);
      return;
    }
    let cancelled = false;
    void agentModels(agentId)
      .then((result) => {
        if (cancelled) return;
        const catalogIds = result.available ? (result.models ?? []).map((m) => m.id) : [];
        setSelection((prev) => {
          const base = prev ?? selectionFromSession(session);
          if (base.agentId !== agentId || base.model.trim()) return prev;
          const resolved = resolveModelForAgent(agentId, catalogIds, "");
          if (!resolved) return prev;
          return { ...base, model: resolved, effort: "", speed: "" };
        });
      })
      .catch(() => {
        if (cancelled) return;
        setSelection((prev) => {
          const base = prev ?? selectionFromSession(session);
          if (base.agentId !== agentId || base.model.trim()) return prev;
          const resolved = resolveModelForAgent(agentId, [], "");
          if (!resolved) return prev;
          return { ...base, model: resolved, effort: "", speed: "" };
        });
      });
    return () => {
      cancelled = true;
    };
  }, [session, session?.id, session?.agentId, session?.model]);

  const project = state.projects.find((p) => p.id === session?.projectId);
  const agent = state.agents.find((a) => a.id === session?.agentId);

  // Opening user turn duplicates session.request in the header — skip it so the
  // thread starts on agent work instead of a second wall of the same brief.
  const threadMessages = useMemo(() => {
    if (!session) return [];
    const msgs = session.messages;
    const first = msgs[0];
    if (first?.role === "user" && first.text.trim() === session.request.trim()) {
      return msgs.slice(1);
    }
    return msgs;
  }, [session]);

  if (!session) {
    if (!state.hydrated) return <main className="flex-1" />;
    throw notFound();
  }
  if (!project) return <main className="flex-1 p-8">Project not found.</main>;

  const running = ["working", "verifying"].includes(session.status);
  const switchBlockReason = running
    ? "Unavailable while a turn runs"
    : session.status === "complete"
      ? "Unavailable once complete"
      : undefined;
  const activeSelection = selection ?? selectionFromSession(session);

  const send = async (outgoing: string, files: File[], delivery?: "now" | "later") => {
    if (sending) return false;
    setSending(true);
    setSendError(null);
    stickToBottomRef.current = true;
    try {
      let attachmentIds: string[] = [];
      if (files.length) {
        attachmentIds = (await Promise.all(files.map(uploadAttachment))).map((a) => a.id);
      }
      await steer(
        session.id,
        outgoing,
        attachmentIds.length ? attachmentIds : undefined,
        running ? (delivery ?? "later") : undefined,
      );
      return true;
    } catch (e) {
      setSendError(
        `Couldn't send: ${e instanceof Error ? e.message : String(e)} Your text is still in the composer.`,
      );
      return false;
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

  const runProjectChecks = async () => {
    if (checksBusy) return;
    if (
      !(await askConfirm({
        title: "Run this project's detected check scripts now?",
        description: "Project scripts can execute code and may access the network.",
        confirmLabel: "Run",
      }))
    )
      return;
    setChecksBusy(true);
    try {
      await runChecks(session.id);
    } catch (e) {
      void warnUser(e instanceof Error ? e.message : String(e));
    } finally {
      setChecksBusy(false);
    }
  };

  const onSelectionChange = (next: AgentSelection) => {
    const prev = activeSelection;
    setSelection(next);
    if (next.model.trim()) writeLastModel(next.agentId, next.model);
    if (next.agentId !== prev.agentId) {
      void switchAgent(session.id, next.agentId)
        .then(() =>
          setSessionOptions(session.id, {
            model: next.model,
            effort: next.effort,
            speed: next.speed,
            permission: next.permission,
          }),
        )
        .catch((e) => {
          setSelection(prev);
          void warnUser(e instanceof Error ? e.message : String(e));
        });
      return;
    }
    if (
      next.model === prev.model &&
      next.effort === prev.effort &&
      next.speed === prev.speed &&
      next.permission === prev.permission
    ) {
      return;
    }
    void setSessionOptions(session.id, {
      model: next.model,
      effort: next.effort,
      speed: next.speed,
      permission: next.permission,
    }).catch((e) => {
      setSelection(prev);
      void warnUser(e instanceof Error ? e.message : String(e));
    });
  };

  return (
    <>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col @container">
        <header className="shrink-0 border-b border-line px-4 @lg:px-7 pt-5 pb-4">
          <div className="flex items-center gap-2">
            <Link
              to="/p/$projectId/conversations"
              params={{ projectId: project.id }}
              className="label-mono hover:text-ink"
            >
              {project.name}
            </Link>
            <span className="label-mono">/ task</span>
            <span className="ml-auto font-mono text-[10px] text-dim">
              started {timeAgo(state.now, session.createdAt)} · {agent?.short ?? session.agentId}
            </span>
          </div>
          <h1
            className="mt-2 line-clamp-1 text-[18px] font-medium leading-snug"
            title={session.request}
          >
            {sessionTitle(session.request)}
          </h1>
          {session.criteria && (
            <p className="mt-1 line-clamp-2 text-[12px] text-dim" title={session.criteria}>
              <strong className="text-ink/70">Done when:</strong> {session.criteria}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <StatusPill status={session.status} size="md" />
            <span className="font-mono text-[10px] text-dim">
              {agent?.name} · model: {session.model ?? "agent default"} · real local CLI process
            </span>
            <div className="ml-auto flex gap-2">
              {running && (
                <button type="button" onClick={() => stop(session.id)} className={stopButtonClass}>
                  Stop
                </button>
              )}
              {["ready", "blocked", "stopped"].includes(session.status) && (
                <button
                  type="button"
                  onClick={() => void markComplete()}
                  disabled={completing}
                  className="btn-amber px-3 py-1.5 text-[12px] disabled:opacity-60"
                >
                  {completing ? "Completing…" : "Mark complete"}
                </button>
              )}
              {session.status === "complete" && (
                <button
                  type="button"
                  onClick={() => reopen(session.id)}
                  className="btn-quiet px-3 py-1.5 text-[12px]"
                >
                  Reopen
                </button>
              )}
            </div>
          </div>
        </header>

        <div
          ref={scrollRef}
          onScroll={onMessagesScroll}
          className="min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto px-4 @lg:px-7 py-5"
        >
          <AnimatePresence initial={false}>
            {threadMessages.map((m) => (
              <MotionItem key={m.id} layout={false}>
                <SessionMessage message={m} agentName={agent?.short} />
              </MotionItem>
            ))}
          </AnimatePresence>
          {running && (
            <div className="flex flex-wrap items-center gap-3 text-[13px] text-dim">
              <span className="size-1.5 animate-pulse-soft rounded-full bg-teal" aria-hidden />
              <TextShimmer>
                {session.status === "verifying" ? "Running checks" : currentActivity(session.logs)}
              </TextShimmer>
              <button type="button" onClick={() => stop(session.id)} className={stopButtonClass}>
                Stop
              </button>
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
                  your task is kept. Change the model in the agent picker below, or clear it to use
                  the agent's configured default, then send a follow-up. The CLI's own "did you
                  mean" suggestions, if any, are in its message and Logs.
                </>
              ) : session.failureKind === "provider_unavailable" ? (
                <>
                  <strong>Provider unavailable.</strong> The agent reported that its provider could
                  not be used. ADE does not manage provider credentials — check this CLI's own
                  provider setup on the Agents (settings). Nothing in the project changed.
                </>
              ) : session.failureKind === "auth_expired" ? (
                <>
                  <strong>Sign-in rejected.</strong> The agent's credentials were refused or
                  expired. Re-authenticate with this CLI's own sign-in flow (Agents (settings) → Set
                  up); ADE never collects tokens. Nothing in the project changed; your task is kept.
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
                The CLI has exited. Inspect the project diff, then run checks explicitly — ADE does
                not run them automatically.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={checksBusy}
                  onClick={() => void runProjectChecks()}
                  className="btn-amber px-3 py-1.5 text-[12px] disabled:opacity-60"
                >
                  {checksBusy ? "Running…" : "Run project checks"}
                </button>
                <span className="font-mono text-[10px] text-dim">
                  Or use Mark complete in the header when the result looks right.
                </span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="shrink-0 border-t border-line px-4 @lg:px-7 py-4">
          {(session.queuedMessages?.length ?? 0) > 0 && (
            <div className="mb-3 rounded-md border border-line bg-paper px-3 py-2.5">
              <p className="text-[12px] font-medium text-ink">Waiting to send</p>
              <ul className="mt-1 space-y-1">
                {session.queuedMessages?.map((prompt, index) => (
                  <li key={`${index}-${waitingPreview(prompt)}`} className="text-[13px] text-dim">
                    {waitingPreview(prompt)}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                {!running && (
                  <button
                    type="button"
                    className="btn-amber px-3 py-1.5 text-[12px] disabled:opacity-60"
                    disabled={sending}
                    onClick={() => {
                      setSendError(null);
                      void steer(session.id, "", undefined, "release").catch((e) =>
                        setSendError(
                          `Couldn't send: ${e instanceof Error ? e.message : String(e)}`,
                        ),
                      );
                    }}
                  >
                    Send these
                  </button>
                )}
                <button
                  type="button"
                  className="btn-quiet px-3 py-1.5 text-[12px]"
                  disabled={sending}
                  onClick={() => {
                    setSendError(null);
                    void steer(session.id, "", undefined, "drop").catch((e) =>
                      setSendError(
                        `Couldn't update the waiting message: ${e instanceof Error ? e.message : String(e)}`,
                      ),
                    );
                  }}
                >
                  Don't send
                </button>
              </div>
            </div>
          )}
          <Composer
            mode="follow-up"
            selection={activeSelection}
            onSelectionChange={onSelectionChange}
            branch={project.branch}
            running={running}
            {...(session.status === "complete"
              ? { disabledReason: "Reopen the session to continue." }
              : {})}
            placeholder={
              running ? "Write a message" : "Send a follow-up to the same agent session…"
            }
            sending={sending}
            error={sendError}
            onSend={send}
            {...(switchBlockReason ? { agentLocked: switchBlockReason } : {})}
          />
        </div>
      </main>
      <RightPanePortal>
        <div
          className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${rightTab === "activity" ? "flex" : "hidden"}`}
        >
          <ActivityPanel session={session} />
        </div>
        <div
          className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${rightTab === "diff" ? "flex" : "hidden"}`}
        >
          <DiffPanel session={session} />
        </div>
      </RightPanePortal>
    </>
  );
}
