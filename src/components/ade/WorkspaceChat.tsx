import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Clock3,
  History,
  Lock,
  Mail,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { type AgentSelection } from "@/components/ade/AgentPicker";
import { AssistantActivityPanel } from "@/components/ade/AssistantActivityPanel";
import { Composer } from "@/components/ade/Composer";
import { RightPanePortal } from "@/components/ade/RightPanePortal";
import { SessionMessage } from "@/components/ade/SessionMessage";
import { useShell } from "@/components/ade/shellContext";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { selectionMode, threadSelection } from "./workspaceChatSelection.mjs";
import { threadTrace } from "./workspaceChatTrace.mjs";
import { optionCapabilities, uploadAttachment, useAdeState } from "@/lib/ade/store";
import type { Message } from "@/lib/ade/types";
import {
  catchupAssistantThread,
  decideHandoff,
  deleteAssistantThread,
  getAssistantThread,
  getAssistantThreads,
  getHandoffs,
  patchAssistantThread,
  retryHandoff,
  sendAssistantMessage,
  startAssistantThread,
  stopAssistantThread,
  type AssistantThread,
  type Handoff,
} from "@/lib/ade/workspaceApi";

/**
 * Luna uses the same conversation header, messages and Composer as a project
 * session. Only the data source (a host-owned chat thread) is different.
 */
export function WorkspaceChat({ threadId }: { threadId?: string }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const agents = useAdeState((state) => state.agents);
  const [selection, setSelection] = useState<AgentSelection | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [catchup, setCatchup] = useState<{ text: string; href?: string | null }[]>([]);
  // A prompt chip must fill the composer every time it is pressed, even when
  // the same chip was pressed before (or the text was edited in between).
  const [promptSeed, setPromptSeed] = useState({ text: "", nonce: 0 });
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  // The thread a pick is being saved to, so a fetch from before the save cannot put the old
  // permission back on screen.
  const localPickRef = useRef<string | null>(null);

  const threads = useQuery({
    queryKey: ["workspace-assistant-threads", search],
    queryFn: () => getAssistantThreads(search ? `query=${encodeURIComponent(search)}` : ""),
    refetchInterval: 5000,
  });
  const detail = useQuery({
    queryKey: ["workspace-assistant-thread", threadId],
    queryFn: () => getAssistantThread(threadId!),
    enabled: !!threadId,
    refetchInterval: 2500,
  });
  const handoffs = useQuery({
    queryKey: ["workspace-handoffs", threadId],
    queryFn: () => getHandoffs(threadId),
    enabled: !!threadId,
    refetchInterval: 3500,
  });

  const thread = detail.data?.thread;
  const messages = useMemo(() => detail.data?.messages ?? [], [detail.data?.messages]);
  const running = thread?.status === "thinking";
  const agent = agents.find((item) => item.id === (selection?.agentId ?? thread?.agentId));
  // Luna's activity belongs in the Shell's right pane, exactly where a project
  // conversation keeps its Activity tab.
  const { rightTab, selectTab } = useShell();
  // The Shell rebuilds `selectTab` on every render. Keep it in a ref so entering the
  // chat (or opening another thread) picks Activity once, instead of re-expanding the
  // pane every render and undoing a collapse the reader asked for.
  const selectTabRef = useRef(selectTab);
  useEffect(() => {
    selectTabRef.current = selectTab;
  }, [selectTab]);
  useEffect(() => {
    selectTabRef.current("activity");
  }, [threadId]);
  const threadPermission = (thread?.permission ?? "plan") as AgentSelection["permission"];
  const activeSelection: AgentSelection =
    selection ??
    ({
      agentId: thread?.agentId ?? agents.find((a) => a.installed && a.signedIn)?.id ?? "",
      model: thread?.model ?? "",
      effort: thread?.effort ?? "",
      speed: "",
      permission: threadPermission,
    } satisfies AgentSelection);
  const caps = useQuery({
    queryKey: ["agent-caps", activeSelection.agentId, activeSelection.model],
    queryFn: () => optionCapabilities(activeSelection.agentId, activeSelection.model || undefined),
    enabled: !!activeSelection.agentId,
  });
  const mode = selectionMode(activeSelection);
  const writablePermissions = (caps.data?.permissions ?? []).filter(
    (permission) => permission !== "plan",
  );
  // Do not flash "unavailable" while the capability request is still in flight.
  const workAvailable = caps.isPending || writablePermissions.length > 0;
  const workBlockedReason =
    caps.data?.permissionNotes?.build ||
    "This agent cannot approve actions in a non-interactive run.";
  const workNote =
    activeSelection.agentId === "opencode"
      ? "OpenCode rejects permission requests in non-interactive runs; only actions it already allows will run."
      : null;
  const pendingApprovals = (handoffs.data?.handoffs ?? []).filter(
    (item) => item.status === "approval_pending",
  );
  const otherHandoffs = (handoffs.data?.handoffs ?? []).filter(
    (item) => item.status !== "approval_pending",
  );
  const rows = useMemo<Message[]>(
    () =>
      messages.map((message) => ({
        id: message.id,
        role: message.role === "assistant" ? "agent" : message.role,
        text: message.text,
        at: message.at,
        ...(message.attachments?.length
          ? {
              attachments: message.attachments.map((attachment) => ({
                id: attachment.id,
                name: attachment.name,
                mime: attachment.mime,
                size: attachment.size,
                kind: attachment.mime.startsWith("image/") ? ("image" as const) : ("file" as const),
              })),
            }
          : {}),
      })),
    [messages],
  );

  const threadKey = thread?.id ?? "";
  const threadAgent = thread?.agentId ?? "";
  const threadModel = thread?.model ?? "";
  const threadEffort = thread?.effort ?? "";
  const trace = useMemo(() => threadTrace(detail.data?.activity), [detail.data?.activity]);
  // Like a project conversation, the opening request already sits in the
  // header. Hide it from the transcript only when the title is the same text
  // (a truncated title keeps the full prompt visible below).
  const visibleRows = useMemo(() => {
    const first = messages[0];
    if (
      threadId &&
      first?.role === "user" &&
      !first.attachments?.length &&
      thread?.title &&
      first.text.trim() === thread.title.trim()
    )
      return rows.slice(1);
    return rows;
  }, [messages, rows, thread?.title, threadId]);
  useEffect(() => {
    if (!threadKey) return;
    const saved = {
      agentId: threadAgent,
      model: threadModel,
      effort: threadEffort,
      permission: threadPermission,
    };
    // The thread's permission is what Chat/Work follows. While a pick is being saved, a fetch
    // from before that save still carries the old value; the pick stays on screen until then.
    if (localPickRef.current === threadKey) return;
    setSelection(threadSelection(saved));
  }, [threadKey, threadAgent, threadModel, threadEffort, threadPermission]);

  useEffect(() => {
    if (!threadId) return;
    void patchAssistantThread(threadId, { readAt: Date.now() }).catch(() => {});
  }, [threadId, thread?.updatedAt]);

  // A different chat is a different conversation: drop the previous chat's
  // catch-up list, error, and scroll position instead of carrying them over.
  useEffect(() => {
    setCatchup([]);
    setError(null);
    localPickRef.current = null;
    stickToBottomRef.current = true;
  }, [threadId]);

  const lastMessageRole = messages.at(-1)?.role;
  const lastMessageLength = messages.at(-1)?.text.length;
  useEffect(() => {
    if (stickToBottomRef.current || lastMessageRole === "user")
      endRef.current?.scrollIntoView({ block: "end" });
  }, [
    messages.length,
    lastMessageRole,
    lastMessageLength,
    handoffs.data?.handoffs.length,
    pendingApprovals.length,
    otherHandoffs.length,
    catchup.length,
    running,
  ]);

  useEffect(() => {
    if (!historyOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (historyRef.current?.contains(target) || historyButtonRef.current?.contains(target))
        return;
      setHistoryOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHistoryOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [historyOpen]);

  const send = async (outgoing: string, files: File[]): Promise<boolean> => {
    if (sending) return false;
    setSending(true);
    setError(null);
    stickToBottomRef.current = true;
    try {
      const attachmentIds = files.length
        ? (await Promise.all(files.map((file) => uploadAttachment(file)))).map((a) => a.id)
        : [];
      if (threadId) {
        await sendAssistantMessage(threadId, {
          text: outgoing,
          ...(attachmentIds.length ? { attachmentIds } : {}),
        });
        void client.invalidateQueries({ queryKey: ["workspace-assistant-thread", threadId] });
      } else {
        const created = await startAssistantThread({
          text: outgoing,
          ...(attachmentIds.length ? { attachmentIds } : {}),
          ...(activeSelection.agentId ? { agentId: activeSelection.agentId } : {}),
          ...(activeSelection.model ? { model: activeSelection.model } : {}),
          ...(activeSelection.effort ? { effort: activeSelection.effort } : {}),
          ...(activeSelection.permission ? { permission: activeSelection.permission } : {}),
        });
        await navigate({
          to: "/workspace/assistant/$threadId",
          params: { threadId: created.thread.id },
        });
      }
      void client.invalidateQueries({ queryKey: ["workspace-assistant-threads"] });
      // The chip's seed text belongs to the message just sent, so do not let a
      // later composer mount prefill it again.
      setPromptSeed((seed) => (seed.text ? { ...seed, text: "" } : seed));
      return true;
    } catch (e) {
      setError(`Couldn't send: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setSending(false);
    }
  };

  const onSelectionChange = (next: AgentSelection) => {
    setSelection(next);
    if (!threadId || running) return;
    localPickRef.current = threadId;
    // Permission is only written when it actually changed; a stale value from a
    // previous agent must not follow the thread into a new adapter.
    const permissionChanged = next.permission !== threadPermission;
    const agentChanged = next.agentId !== thread?.agentId;
    void patchAssistantThread(threadId, {
      agentId: next.agentId,
      model: next.model,
      effort: next.effort,
      ...(permissionChanged ? { permission: next.permission } : {}),
    })
      .then(() => {
        localPickRef.current = null;
        // The service resets model/effort/permission when the agent changes; let
        // the thread be the source of truth again.
        if (agentChanged) setSelection(null);
        return client.invalidateQueries({ queryKey: ["workspace-assistant-thread", threadId] });
      })
      .catch((e) => {
        localPickRef.current = null;
        setSelection(null);
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  const setMode = (next: string) => {
    if (running) {
      setError("Wait for Luna to finish before changing mode.");
      return;
    }
    const permission: AgentSelection["permission"] =
      next === "work" ? (writablePermissions[0] ?? "build") : "plan";
    if (next === "work" && !workAvailable) {
      setError(`Work is unavailable here. ${workBlockedReason}`);
      return;
    }
    const updated: AgentSelection = { ...activeSelection, permission };
    setSelection(updated);
    if (!threadId) return;
    localPickRef.current = threadId;
    void patchAssistantThread(threadId, { permission })
      .then(() => {
        localPickRef.current = null;
        return client.invalidateQueries({ queryKey: ["workspace-assistant-thread", threadId] });
      })
      .catch((e) => {
        localPickRef.current = null;
        setSelection(null);
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  const newChat = async () => {
    setError(null);
    try {
      const created = await startAssistantThread({
        ...(activeSelection.agentId ? { agentId: activeSelection.agentId } : {}),
        ...(activeSelection.model ? { model: activeSelection.model } : {}),
        ...(activeSelection.permission ? { permission: activeSelection.permission } : {}),
      });
      await client.invalidateQueries({ queryKey: ["workspace-assistant-threads"] });
      await navigate({
        to: "/workspace/assistant/$threadId",
        params: { threadId: created.thread.id },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start a chat.");
    }
  };

  const stop = useMutation({
    mutationFn: () => stopAssistantThread(threadId!),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["workspace-assistant-thread", threadId] }),
  });

  const catchMeUp = async () => {
    if (!threadId) return;
    setError(null);
    try {
      const result = await catchupAssistantThread(threadId);
      setCatchup(result.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not catch up.");
    }
  };

  const onMessagesScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const title = thread?.title || "Luna";
  const status =
    thread?.status === "thinking"
      ? "Working"
      : thread?.status === "awaiting_input"
        ? "Needs input"
        : thread?.status === "failed"
          ? "Failed"
          : "Ready";
  // The title is already Luna for a fresh chat, so the metadata only names a
  // project agent when one is actually in use.
  const agentLabel = agent?.name && agent.name !== "Luna" ? agent.name : null;

  return (
    <>
      <main className="workspace-chat workspace-assistant relative flex min-h-0 min-w-0 flex-1 flex-col @container">
        <header className="relative shrink-0 border-b border-line px-4 pb-4 pt-5 @lg:px-7">
          <div className="relative mx-auto w-full max-w-3xl">
            <div className="flex items-center gap-2">
              <Link to="/workspace" className="label-mono hover:text-ink">
                Workspace
              </Link>
              <span className="label-mono">/ Luna</span>
            </div>
            <h1 className="mt-2 line-clamp-1 text-lg font-medium leading-snug">{title}</h1>
            <div className="mt-3 flex items-center gap-3">
              <span
                className={`size-1.5 shrink-0 rounded-full ${running ? "animate-pulse-soft bg-teal" : thread?.status === "failed" ? "bg-danger" : "bg-line"}`}
                aria-hidden
              />
              <span className="min-w-0 truncate text-xs text-dim">
                {status}
                {agentLabel ? ` · ${agentLabel}` : null} ·{" "}
                {activeSelection.model ? (
                  <span className="font-mono">{activeSelection.model}</span>
                ) : (
                  "agent default"
                )}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <button
                  ref={historyButtonRef}
                  type="button"
                  className="btn-quiet inline-flex h-7 w-7 shrink-0 items-center justify-center gap-2 whitespace-nowrap text-xs @md:w-auto @md:px-3"
                  onClick={() => setHistoryOpen((open) => !open)}
                  aria-expanded={historyOpen}
                  aria-label="Chat history"
                  title="Chat history"
                >
                  <History className="size-4" strokeWidth={1.5} aria-hidden />
                  <span className="hidden @md:inline">History</span>
                </button>
                <button
                  type="button"
                  className="btn-quiet inline-flex h-7 w-7 shrink-0 items-center justify-center gap-2 whitespace-nowrap text-xs @md:w-auto @md:px-3"
                  onClick={() => void newChat()}
                  aria-label="New chat"
                  title="New chat"
                >
                  <Plus className="size-4" strokeWidth={1.5} aria-hidden />
                  <span className="hidden @md:inline">New chat</span>
                </button>
                {running && (
                  <button
                    type="button"
                    className="btn-quiet inline-flex h-7 w-7 shrink-0 items-center justify-center gap-2 whitespace-nowrap text-xs @md:w-auto @md:px-3"
                    onClick={() => stop.mutate()}
                    aria-label="Stop Luna"
                    title="Stop Luna"
                  >
                    <Square className="size-4" strokeWidth={1.5} aria-hidden />
                    <span className="hidden @md:inline">Stop</span>
                  </button>
                )}
                <Link
                  to="/workspace/settings"
                  className="btn-quiet inline-flex size-7 shrink-0 items-center justify-center"
                  aria-label="Luna settings"
                  title="Luna settings"
                >
                  <Settings2 className="size-4" strokeWidth={1.5} aria-hidden />
                </Link>
              </div>
            </div>

            {historyOpen && (
              <div
                ref={historyRef}
                className="card-panel absolute right-0 top-[calc(100%-4px)] z-20 w-[min(380px,calc(100vw-2rem))] p-2 shadow-lg"
              >
                <label className="flex items-center gap-2 border-b border-line px-2 pb-2">
                  <History className="size-4 shrink-0 text-dim" strokeWidth={1.5} aria-hidden />
                  <span className="sr-only">Search chat history</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search chat history"
                    className="min-w-0 flex-1 bg-transparent py-1 text-sm focus-visible:outline-none"
                    autoFocus
                  />
                </label>
                <div className="max-h-[min(420px,60vh)] overflow-y-auto py-1">
                  {(threads.data?.threads ?? []).length === 0 && (
                    <p className="px-2 py-3 text-xs text-dim">
                      {search.trim() ? "No matching chats." : "No chats yet."}
                    </p>
                  )}
                  {(threads.data?.threads ?? []).map((item) => (
                    <HistoryRow
                      key={item.id}
                      thread={item}
                      active={item.id === threadId}
                      onOpen={() => {
                        setHistoryOpen(false);
                        void navigate({
                          to: "/workspace/assistant/$threadId",
                          params: { threadId: item.id },
                        });
                      }}
                      onDeleted={() => {
                        void client.invalidateQueries({
                          queryKey: ["workspace-assistant-threads"],
                        });
                        if (item.id === threadId) {
                          setHistoryOpen(false);
                          void navigate({ to: "/workspace/assistant" });
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </header>

        <div
          ref={scrollRef}
          onScroll={onMessagesScroll}
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 @lg:px-7"
        >
          <div className="mx-auto w-full max-w-3xl space-y-3">
            {threadId && (
              <div className="flex justify-end">
                <button
                  type="button"
                  className="workspace-text-link text-xs disabled:opacity-60"
                  onClick={() => void catchMeUp()}
                >
                  <Clock3 className="size-4" strokeWidth={1.5} aria-hidden />
                  Catch me up
                </button>
              </div>
            )}

            {!messages.length && (
              <div className="max-w-2xl">
                <div className="card-panel px-4 py-3">
                  <div className="label-section mb-1">Luna</div>
                  <p className="text-sm leading-5.5 text-ink">
                    I can catch you up on what changed, start work in another project, or ask a
                    project how its work is going.
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    "What changed while I was away?",
                    "Start a task in another project",
                    "Ask a project how its work is going",
                  ].map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="btn-quiet px-3 py-1.5 text-xs"
                      onClick={() =>
                        setPromptSeed((seed) => ({ text: prompt, nonce: seed.nonce + 1 }))
                      }
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {visibleRows.map((message) => (
              <SessionMessage
                key={message.id}
                message={message}
                agentName={agent?.short ?? "Luna"}
              />
            ))}

            {running && (
              <div className="flex flex-wrap items-center gap-3 text-ui text-dim">
                <span className="size-1.5 animate-pulse-soft rounded-full bg-teal" aria-hidden />
                <TextShimmer>Luna is working…</TextShimmer>
              </div>
            )}

            {catchup.length > 0 && (
              <div className="card-panel p-4">
                <div className="flex items-center gap-2">
                  <Clock3 className="size-4 shrink-0 text-dim" strokeWidth={1.5} aria-hidden />
                  <span className="text-sm font-medium">Since your last catch-up</span>
                  <button
                    type="button"
                    className="ml-auto text-dim hover:text-ink"
                    aria-label="Dismiss catch-up"
                    onClick={() => setCatchup([])}
                  >
                    <X className="size-4" strokeWidth={1.5} aria-hidden />
                  </button>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {catchup.map((item, index) => (
                    <li key={`${item.href ?? index}:${index}`} className="text-ui leading-5">
                      {item.href ? (
                        <a className="text-teal-deep underline underline-offset-2" href={item.href}>
                          {item.text}
                        </a>
                      ) : (
                        item.text
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {pendingApprovals.map((handoff) => (
              <ApprovalCard
                key={handoff.id}
                handoff={handoff}
                onDone={() =>
                  void client.invalidateQueries({ queryKey: ["workspace-handoffs", threadId] })
                }
              />
            ))}

            {otherHandoffs.length > 0 && (
              <details className="card-panel px-4 py-3">
                <summary className="cursor-pointer text-xs text-dim">
                  Project updates · {otherHandoffs.length}
                </summary>
                <div className="mt-2 space-y-2">
                  {otherHandoffs.map((item) => (
                    <HandoffLine key={item.id} handoff={item} />
                  ))}
                </div>
              </details>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <div className="shrink-0 border-t border-line px-4 py-4 @lg:px-7">
          <div className="mx-auto w-full max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <SegmentedControl
                label="Luna mode"
                value={mode}
                onValueChange={setMode}
                options={[
                  { value: "chat", label: "Chat" },
                  {
                    value: "work",
                    label: "Work",
                    ...(workAvailable
                      ? {}
                      : { accessory: <Lock className="size-3" aria-hidden /> }),
                  },
                ]}
              />
              <span className="min-w-0 truncate text-xs text-dim">
                {!workAvailable
                  ? `Work unavailable: ${workBlockedReason}`
                  : mode === "work"
                    ? (workNote ?? thread?.workspacePath ?? "Files stay in this chat's folder")
                    : "Read-only answers"}
              </span>
            </div>
            <Composer
              key={`${threadId ?? "new"}:${promptSeed.nonce}`}
              mode={threadId ? "follow-up" : "new"}
              selection={activeSelection}
              onSelectionChange={onSelectionChange}
              branch=""
              placeholder={threadId ? "Ask a follow-up" : "Ask Luna"}
              initialText={promptSeed.text}
              sending={sending}
              error={error}
              onSend={send}
              running={running}
              {...(running ? { agentLocked: "Unavailable while Luna is working" } : {})}
            />
          </div>
        </div>
      </main>
      <RightPanePortal>
        <div
          className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${rightTab === "activity" ? "flex" : "hidden"}`}
        >
          <AssistantActivityPanel
            agentId={activeSelection.agentId}
            agentName={agent?.name}
            model={activeSelection.model}
            mode={mode}
            workspacePath={thread?.workspacePath}
            status={status}
            trace={trace}
            live={running}
          />
        </div>
      </RightPanePortal>
    </>
  );
}

function HistoryRow({
  thread,
  active,
  onOpen,
  onDeleted,
}: {
  thread: AssistantThread;
  active: boolean;
  onOpen: () => void;
  onDeleted: () => void;
}) {
  const client = useQueryClient();
  const unread = (thread.readAt ?? 0) < (thread.updatedAt ?? 0);
  return (
    <div className={`flex items-center gap-1 rounded-md px-1 ${active ? "bg-ink/[0.04]" : ""}`}>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
        onClick={onOpen}
      >
        <span className={`size-1.5 shrink-0 rounded-full ${unread ? "bg-amber" : "bg-line"}`} />
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium">{thread.title || "New chat"}</span>
          <span className="block truncate text-caption text-dim">
            {thread.preview || "No reply yet"}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="grid size-8 shrink-0 place-items-center rounded-lg text-dim hover:bg-ink/[0.04] hover:text-ink"
        aria-label={
          unread ? `Mark ${thread.title || "chat"} read` : `Mark ${thread.title || "chat"} unread`
        }
        onClick={async () => {
          await patchAssistantThread(thread.id, unread ? { readAt: Date.now() } : { unread: true });
          await client.invalidateQueries({ queryKey: ["workspace-assistant-threads"] });
        }}
      >
        {unread ? (
          <Check className="size-4" strokeWidth={1.5} aria-hidden />
        ) : (
          <Mail className="size-4" strokeWidth={1.5} aria-hidden />
        )}
      </button>
      <button
        type="button"
        className="grid size-8 shrink-0 place-items-center rounded-lg text-dim hover:bg-ink/[0.04] hover:text-danger"
        aria-label={`Delete ${thread.title || "chat"}`}
        onClick={async () => {
          if (!window.confirm("Delete this chat? Delivered project work continues.")) return;
          await deleteAssistantThread(thread.id);
          onDeleted();
        }}
      >
        <Trash2 className="size-4" strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  );
}

function ApprovalCard({ handoff, onDone }: { handoff: Handoff; onDone: () => void }) {
  const [draft, setDraft] = useState(handoff.request ?? "");
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "send" | "decline") => {
    setBusy(true);
    try {
      await decideHandoff(handoff.id, decision, decision === "send" ? draft : undefined);
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card-panel border-amber/40 bg-amber/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-amber-deep" strokeWidth={1.5} aria-hidden />
        Send to {handoff.targetProjectName || handoff.targetName || "project"}?
      </div>
      <p className="mt-1 text-ui leading-5 text-[color:var(--text-secondary)]">
        {handoff.approval?.reason === "chain"
          ? "This project-to-project chain is long. Confirm that it should continue."
          : `That project runs with ${handoff.permission || "more"} access. Edit the request or send it.`}
      </p>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={2}
        aria-label="Request draft"
        className="mt-2 w-full resize-none rounded-md border border-line bg-paper px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber/40"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-amber px-3 py-1.5 text-xs disabled:opacity-60"
          disabled={busy || !draft.trim()}
          onClick={() => void decide("send")}
        >
          <Send className="size-4" strokeWidth={1.5} aria-hidden />
          Send
        </button>
        <button
          type="button"
          className="btn-quiet px-3 py-1.5 text-xs disabled:opacity-60"
          disabled={busy}
          onClick={() => void decide("decline")}
        >
          Decline
        </button>
      </div>
    </div>
  );
}

function HandoffLine({ handoff }: { handoff: Handoff }) {
  const [busy, setBusy] = useState(false);
  const retryable = ["failed", "interrupted", "missing_target"].includes(handoff.status);
  return (
    <div className="flex items-start gap-2 text-xs leading-5">
      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-line" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {handoff.targetProjectName || handoff.targetName || "Project"}
          </span>
          <span className="label-mono">{handoff.status.replaceAll("_", " ")}</span>
          {handoff.href && (
            <a className="text-teal-deep underline underline-offset-2" href={handoff.href}>
              Open
            </a>
          )}
          {retryable && (
            <button
              type="button"
              className="text-teal-deep underline underline-offset-2 disabled:opacity-60"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await retryHandoff(handoff.id);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Retry
            </button>
          )}
        </div>
        <p className="text-dim">{handoff.answer || handoff.error || handoff.request}</p>
      </div>
    </div>
  );
}
