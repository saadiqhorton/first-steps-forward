import { useEffect, useMemo, useRef, useState } from "react";
import { Link, notFound } from "@tanstack/react-router";
import { ActivityPanel } from "@/components/ade/ActivityPanel";
import { type AgentSelection } from "@/components/ade/AgentPicker";
import { Composer } from "@/components/ade/Composer";
import { DiffPanel } from "@/components/ade/DiffPanel";
import { RightPanePortal } from "@/components/ade/RightPanePortal";
import { SessionThread } from "@/components/ade/SessionThread";
import { TimeAgo } from "@/components/ade/TimeAgo";
import { ConversationProcesses } from "@/components/ade/processes/ConversationProcesses";
import { DevCommandRequestCard } from "@/components/ade/DevCommandRequestCard";
import { PermissionRequestCard } from "@/components/ade/PermissionRequestCard";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { StatusPill } from "@/components/ade/StatusPill";
import { useShell } from "@/components/ade/shellContext";
import { writeLastModel } from "@/lib/ade/lastModels";
import { currentActivity } from "@/lib/ade/formatLogs.mjs";
import { scrollToEnd } from "@/lib/ade/scrollToEnd";
import { sessionTitle } from "@/lib/ade/sessionTitle";
import { askConfirm, warnUser } from "@/lib/ade/userNotices";
import { sessionPairKey } from "@/shared/session-scope.mjs";
import {
  answerDevCommand,
  needsYou,
  uploadAttachment,
  uploadBrowserRecording,
  useAde,
  useSession,
  useSessionLogs,
  useAdeState,
} from "@/lib/ade/store";
import { isBrowserRecording } from "@/lib/ade/browser/composerFeedback";

function waitingPreview(prompt: string) {
  if (prompt.startsWith("Selected context:\n")) return "Selected context";
  const visible =
    (prompt.split("\n\nThe user attached these files")[0] ?? "")
      .split("\n\nSelected context:\n")[0]
      ?.trim() ?? "";
  if (visible.length <= 140) return visible;
  return `${visible.slice(0, 139)}…`;
}

const stopButtonClass = "btn-quiet shrink-0 px-3 py-1.5 text-xs font-medium";

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
  const { steer, complete, reopen, stop, switchAgent, setSessionOptions, runChecks, refresh } =
    useAde();
  // Only this conversation's rows: another session's progress must not re-render this one.
  const { summary, project, agent, hydrated } = useAdeState((state) => {
    const summary = state.sessions.find((s) => s.id === sessionId);
    return {
      summary,
      project: state.projects.find((p) => p.id === summary?.projectId),
      agent: state.agents.find((a) => a.id === summary?.agentId),
      hydrated: state.hydrated,
    };
  });
  const { rightTab } = useShell();
  const detailQuery = useSession(summary?.id ?? "");
  const logsQuery = useSessionLogs(summary?.id ?? "");
  const session = useMemo(
    () =>
      summary && detailQuery.data
        ? {
            ...summary,
            ...detailQuery.data,
            logs: logsQuery.data?.lines.map((line) => line.text) ?? [],
          }
        : null,
    [summary, detailQuery.data, logsQuery.data],
  );
  const [selection, setSelection] = useState<AgentSelection | null>(null);
  const pendingAgentSelection = useRef<AgentSelection | null>(null);
  const [sending, setSending] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [checksBusy, setChecksBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Auto-scroll only if the reader is already near the bottom (or sent the
  // last message); updated from scroll events below.
  const stickToBottomRef = useRef(true);
  const lastMessageRole = session?.messages[session.messages.length - 1]?.role;
  const lastMessageLength = session?.messages[session.messages.length - 1]?.text.length;
  const agentPermissions = (session?.pendingPermissions ?? []).filter(
    (request) => request.kind !== "dev_command",
  );
  const pendingCount = agentPermissions.length + (session?.pendingDevCommand ? 1 : 0);

  const onMessagesScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (stickToBottomRef.current || lastMessageRole === "user")
      return scrollToEnd(scrollRef.current);
    return undefined;
  }, [session?.messages.length, session?.status, lastMessageRole, lastMessageLength, pendingCount]);

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

  // Opening user turn duplicates session.request in the header — skip it so the
  // thread starts on agent work instead of a second wall of the same brief.
  const messages = session?.messages;
  const request = session?.request;
  const threadMessages = useMemo(() => {
    if (!messages) return [];
    const first = messages[0];
    if (first?.role === "user" && !first.presentation && first.text.trim() === request?.trim()) {
      return messages.slice(1);
    }
    return messages;
  }, [messages, request]);

  if (!summary) {
    if (!hydrated) return <main className="flex-1" />;
    throw notFound();
  }
  if (!session)
    return (
      <div className="grid h-full place-items-center text-sm text-dim" role="status">
        {detailQuery.error ? "Could not load this conversation" : "Loading conversation…"}
      </div>
    );
  if (!project) return <main className="flex-1 p-8">Project not found</main>;

  const running = ["working", "verifying"].includes(session.status);
  const switchBlockReason = running
    ? "Unavailable while a turn runs"
    : session.status === "complete"
      ? "Unavailable once complete"
      : undefined;
  const activeSelection = selection ?? selectionFromSession(session);

  const send = async (
    outgoing: string,
    files: File[],
    delivery?: "now" | "later",
    presentation?: import("@/lib/ade/types").MessagePresentation,
  ) => {
    if (sending) return false;
    setSending(true);
    setSendError(null);
    stickToBottomRef.current = true;
    try {
      let attachmentIds: string[] = [];
      if (files.length) {
        attachmentIds = (
          await Promise.all(
            files.map((file) =>
              isBrowserRecording(file) ? uploadBrowserRecording(file) : uploadAttachment(file),
            ),
          )
        ).map((a) => a.id);
      }
      await steer(
        session.id,
        outgoing,
        attachmentIds.length ? attachmentIds : undefined,
        running ? (delivery ?? "later") : undefined,
        presentation,
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
    // The picker may resolve the new provider's default model while the
    // provider-switch request is still in flight. Keep that choice with the
    // switch so it is never sent to the previous provider's session options.
    if (pendingAgentSelection.current) {
      pendingAgentSelection.current = next;
      return;
    }
    if (next.agentId !== prev.agentId) {
      pendingAgentSelection.current = next;
      let applied = prev;
      void switchAgent(session.id, next.agentId, {
        model: next.model,
        effort: next.effort,
        speed: next.speed,
        permission: next.permission,
      })
        .then(async () => {
          applied = next;
          while (true) {
            const latest = pendingAgentSelection.current ?? applied;
            if (
              latest.agentId === applied.agentId &&
              latest.model === applied.model &&
              latest.effort === applied.effort &&
              latest.speed === applied.speed &&
              latest.permission === applied.permission
            ) {
              pendingAgentSelection.current = null;
              return;
            }
            if (latest.agentId !== applied.agentId) {
              await switchAgent(session.id, latest.agentId, {
                model: latest.model,
                effort: latest.effort,
                speed: latest.speed,
                permission: latest.permission,
              });
            } else {
              await setSessionOptions(session.id, {
                model: latest.model,
                effort: latest.effort,
                speed: latest.speed,
                permission: latest.permission,
              });
            }
            applied = latest;
          }
        })
        .catch((e) => {
          pendingAgentSelection.current = null;
          setSelection(applied);
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
            <span className="ml-auto font-mono text-xs text-dim">
              started <TimeAgo at={session.createdAt} /> · {agent?.short ?? session.agentId}
            </span>
          </div>
          <h1
            className="mt-2 line-clamp-1 text-lg font-medium leading-snug"
            title={session.displayRequest ?? session.request}
          >
            {sessionTitle(session.displayRequest ?? session.request)}
          </h1>
          {session.criteria && (
            <p className="mt-1 line-clamp-2 text-xs text-dim" title={session.criteria}>
              <strong className="font-medium text-ink/70">Done when:</strong> {session.criteria}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <StatusPill status={session.status} size="md" needsYou={needsYou(session)} />
            <span className="text-xs text-dim">
              {agent?.name ?? session.agentId} ·{" "}
              {session.model ? <span className="font-mono">{session.model}</span> : "agent default"}
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
                  className="btn-quiet px-3 py-1.5 text-xs disabled:opacity-60"
                >
                  {completing ? "Completing…" : "Mark complete"}
                </button>
              )}
              {session.status === "complete" && (
                <button
                  type="button"
                  onClick={() => reopen(session.id)}
                  className="btn-quiet px-3 py-1.5 text-xs"
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
          <SessionThread
            key={session.id}
            messages={threadMessages}
            agentName={agent?.short}
            projectId={project.id}
          />
          <ConversationProcesses sessionId={session.id} />
          {session.pendingDevCommand && (
            <DevCommandRequestCard
              key={session.pendingDevCommand.id}
              request={session.pendingDevCommand}
              onAnswer={async (allow) => {
                await answerDevCommand(project.id, session.pendingDevCommand!.id, allow);
                await refresh();
              }}
            />
          )}
          {agentPermissions.map((request) => (
            <PermissionRequestCard
              key={request.id}
              sessionId={session.id}
              request={request}
              agentName={agent?.short ?? session.agentId}
            />
          ))}
          {running && (
            <div className="flex flex-wrap items-center gap-3 text-ui text-dim">
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
              className={`rounded-md border px-4 py-3 text-ui leading-5 [&_strong]:font-medium ${session.failureKind && session.failureKind !== "process" ? "border-amber/40 bg-amber/5" : "border-danger/30 bg-danger/5"}`}
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
            <div className="card-panel p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <span className="size-1.5 rounded-full bg-teal" aria-hidden />
                Ready to review
              </div>
              <p className="mt-1 text-ui leading-5 text-[color:var(--text-secondary)]">
                The CLI has exited. Inspect the project diff, then run checks explicitly — ADE does
                not run them automatically.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={checksBusy}
                  onClick={() => void runProjectChecks()}
                  className="btn-amber px-3 py-1.5 text-xs disabled:opacity-60"
                >
                  {checksBusy ? "Running…" : "Run project checks"}
                </button>
                <span className="text-xs text-dim">
                  Or use Mark complete in the header when the result looks right
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-line px-4 @lg:px-7 py-4">
          {(session.queuedMessages?.length ?? 0) > 0 && (
            <div className="mb-3 rounded-md border border-line bg-paper px-4 py-3">
              <p className="text-xs font-medium text-ink">Waiting to send</p>
              <ul className="mt-1 space-y-1">
                {session.queuedMessages?.map((prompt, index) => (
                  <li key={`${index}-${waitingPreview(prompt)}`} className="text-ui text-dim">
                    {waitingPreview(prompt)}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                {!running && (
                  <button
                    type="button"
                    className="btn-amber px-3 py-1.5 text-xs disabled:opacity-60"
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
                  className="btn-quiet px-3 py-1.5 text-xs"
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
            projectId={project.id}
            key={`${project.id}:${session.id}`}
            draftStorageKey={sessionPairKey(project.id, session.id)}
            sessionId={session.id}
            mode="follow-up"
            selection={activeSelection}
            onSelectionChange={onSelectionChange}
            branch={project.branch}
            running={running}
            {...(session.status === "complete"
              ? { disabledReason: "Reopen the session to continue" }
              : {})}
            placeholder={
              running
                ? "Write a message"
                : session.agentStartFresh
                  ? "Send a message to start with this agent"
                  : "Send a follow-up"
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
