import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  FolderOpen,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  WandSparkles,
  X,
} from "lucide-react";
import {
  getAssistant,
  getFrequentWorkflows,
  getInbox,
  getProjectSettings,
  getVoiceSettings,
  inboxBulk,
  launchWorkflow,
  markSessionRead,
  updateProjectSettings,
  updateVoiceSettings,
  type AssistantThread,
  type VoiceSettings,
  type WorkspaceInboxItem,
} from "@/lib/ade/workspaceApi";
import { useAdeState } from "@/lib/ade/store";
import { useShell } from "@/components/ade/shellContext";

const card = "card-panel";
const quietButton =
  "btn-quiet inline-flex items-center justify-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton =
  "btn-amber inline-flex items-center justify-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs font-medium disabled:opacity-50";
const DEFAULT_VOICE: VoiceSettings = {
  muted: false,
  speakReplies: true,
  chimeDuringDictation: true,
};

function usePollingQuery<T>(key: unknown[], queryFn: () => Promise<T>, enabled = true) {
  return useQuery({
    queryKey: key,
    queryFn,
    enabled,
    refetchInterval: 3500,
    refetchOnWindowFocus: true,
  });
}
function timeAgo(at?: number) {
  if (!at) return "Just now";
  const mins = Math.max(0, Math.floor((Date.now() - at) / 60000));
  return mins < 1
    ? "Just now"
    : mins < 60
      ? `${mins}m ago`
      : mins < 1440
        ? `${Math.floor(mins / 60)}h ago`
        : `${Math.floor(mins / 1440)}d ago`;
}
function statusLabel(status: string) {
  return status.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}
function isThreadUnread(thread: AssistantThread) {
  return (thread.readAt ?? 0) < (thread.updatedAt ?? 0);
}
function tomorrowNineAM() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

export function WorkspaceOverview() {
  const { projects, sessions } = useAdeState((s) => ({
    projects: s.projects,
    sessions: s.sessions,
  }));
  const inboxQuery = usePollingQuery(["workspace-inbox"], () => getInbox());
  const assistantQuery = usePollingQuery(["workspace-assistant"], getAssistant);
  const workflowsQuery = usePollingQuery(["workspace-workflows"], getFrequentWorkflows);
  const inbox = inboxQuery.data;
  const assistant = assistantQuery.data;
  const workflows = workflowsQuery.data;
  const { openDialog } = useShell();
  const queryError =
    inboxQuery.error instanceof Error
      ? inboxQuery.error
      : assistantQuery.error instanceof Error
        ? assistantQuery.error
        : workflowsQuery.error instanceof Error
          ? workflowsQuery.error
          : null;
  const retry = () =>
    void Promise.all([inboxQuery.refetch(), assistantQuery.refetch(), workflowsQuery.refetch()]);
  // A pinned session also appears in its own group; count each conversation once.
  const inboxCount = new Set(
    Object.values(inbox?.groups ?? {})
      .flat()
      .map((item) => item.sessionId ?? item.id),
  ).size;
  return (
    <main className="workspace-page workspace-overview">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="label-mono">Workspace</span>
            <span className="label-mono">/ home</span>
          </div>
          <h1 className="mt-2 text-lg font-medium leading-snug">Home</h1>
          <p className="mt-1 text-xs leading-5 text-dim">
            Projects, decisions and Luna in one local workspace.
          </p>
        </div>
        <Link to="/workspace/assistant" className={primaryButton}>
          <MessageCircle size={16} strokeWidth={1.5} aria-hidden /> Ask Luna <kbd>⌘ J</kbd>
        </Link>
      </div>
      {queryError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 text-xs text-danger">
          <span>Some workspace data could not be loaded. {queryError.message}</span>
          <button className={quietButton} onClick={retry}>
            Try again
          </button>
        </div>
      )}
      <section className="workspace-stats" aria-label="Workspace activity">
        <Link
          to="/workspace/inbox"
          className={`${card} workspace-stat flex items-center justify-between gap-3 p-5`}
        >
          <span className="grid gap-1">
            <span className="text-2xl font-medium leading-none tabular-nums">
              {inboxQuery.isPending || inboxQuery.isError ? "—" : inboxCount}
            </span>
            <span className="text-xs text-dim">Inbox</span>
          </span>
          <ArrowUpRight className="size-4 text-dim" strokeWidth={1.5} aria-hidden />
        </Link>
        <Link
          to="/workspace/projects"
          className={`${card} workspace-stat flex items-center justify-between gap-3 p-5`}
        >
          <span className="grid gap-1">
            <span className="text-2xl font-medium leading-none tabular-nums">
              {sessions.filter((s) => ["working", "verifying", "queued"].includes(s.status)).length}
            </span>
            <span className="text-xs text-dim">Active sessions</span>
          </span>
          <ArrowUpRight className="size-4 shrink-0 text-dim" strokeWidth={1.5} aria-hidden />
        </Link>
        <Link
          to="/workspace/assistant"
          className={`${card} workspace-stat flex items-center justify-between gap-3 p-5`}
        >
          <span className="grid gap-1">
            <span className="text-2xl font-medium leading-none tabular-nums">
              {assistantQuery.isPending || assistantQuery.isError
                ? "—"
                : (assistant?.threads?.length ?? 0)}
            </span>
            <span className="text-xs text-dim">Luna chats</span>
          </span>
          <ArrowUpRight className="size-4 text-dim" strokeWidth={1.5} aria-hidden />
        </Link>
      </section>
      <div className="workspace-columns">
        <section className="workspace-section">
          <div className="workspace-section-head">
            <div>
              <h2>Frequent workflows</h2>
              <p>Start a familiar task in one action.</p>
            </div>
          </div>
          {workflowsQuery.isPending ? (
            <div className="workspace-empty">
              <span>Loading workflows…</span>
            </div>
          ) : workflowsQuery.isError ? (
            <div className="workspace-empty">
              <span className="text-xs text-danger">
                Could not load frequent workflows.{" "}
                {workflowsQuery.error instanceof Error ? workflowsQuery.error.message : ""}
              </span>
              <button className="workspace-text-link" onClick={retry}>
                Try again
              </button>
            </div>
          ) : workflows?.items?.length ? (
            <div className="workspace-workflows">
              {workflows.items.slice(0, 4).map((w) => (
                <WorkflowCard
                  key={`${w.projectId}:${w.workflowId}`}
                  workflow={w}
                  {...(projects.find((p) => p.id === w.projectId)
                    ? { project: projects.find((p) => p.id === w.projectId)! }
                    : {})}
                />
              ))}
            </div>
          ) : (
            <div className="workspace-empty">
              <span>Launch a workflow twice and it will appear here.</span>
              {projects[0] ? (
                <Link
                  to="/p/$projectId/workflows"
                  params={{ projectId: projects[0].id }}
                  className="workspace-text-link"
                >
                  Browse workflows <ArrowUpRight className="size-4" strokeWidth={1.5} />
                </Link>
              ) : (
                <Link to="/workspace/projects" className="workspace-text-link">
                  Browse projects <ArrowUpRight className="size-4" strokeWidth={1.5} />
                </Link>
              )}
            </div>
          )}
        </section>
        <section className="workspace-section">
          <div className="workspace-section-head">
            <div>
              <h2>Projects</h2>
              <p>
                {projects.length} registered {projects.length === 1 ? "project" : "projects"}
              </p>
            </div>
            <button className={quietButton} onClick={() => openDialog("add-project")}>
              <Plus size={16} strokeWidth={1.5} aria-hidden /> Add project
            </button>
          </div>
          {projects.length ? (
            <div className="workspace-projects">
              {projects.slice(0, 8).map((p) => {
                const active = sessions.filter(
                  (s) =>
                    s.projectId === p.id && ["working", "verifying", "queued"].includes(s.status),
                ).length;
                return (
                  <Link
                    key={p.id}
                    to="/p/$projectId/conversations"
                    params={{ projectId: p.id }}
                    className={`${card} workspace-project`}
                  >
                    <ProjectAvatar project={p} />
                    <span className="workspace-project-name">
                      <b>{p.name}</b>
                      <small>{p.path}</small>
                    </span>
                    <span className="workspace-project-count">
                      {active ? `${active} active` : "Idle"}
                    </span>
                    <ArrowUpRight size={16} strokeWidth={1.5} />
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="workspace-empty">
              <span>No projects yet. Add a folder to see its sessions.</span>
              <button className="workspace-text-link" onClick={() => openDialog("add-project")}>
                Discover a folder <ArrowUpRight className="size-4" strokeWidth={1.5} />
              </button>
            </div>
          )}
        </section>
      </div>
      <section className="workspace-section">
        <div className="workspace-section-head">
          <div>
            <h2>Recent Luna chats</h2>
            <p>Pick up where the last conversation stopped.</p>
          </div>
          {!!assistant?.threads?.length && (
            <Link to="/workspace/assistant" className="workspace-text-link">
              All chats <ArrowUpRight size={16} strokeWidth={1.5} />
            </Link>
          )}
        </div>
        {assistantQuery.isPending ? (
          <div className="workspace-empty">
            <span>Loading Luna chats…</span>
          </div>
        ) : assistantQuery.isError ? (
          <div className="workspace-empty">
            <span className="text-xs text-danger">
              Could not load Luna chats.{" "}
              {assistantQuery.error instanceof Error ? assistantQuery.error.message : ""}
            </span>
            <button className="workspace-text-link" onClick={retry}>
              Try again
            </button>
          </div>
        ) : assistant?.threads?.length ? (
          <div className="workspace-chat-grid">
            {assistant.threads.slice(0, 3).map((t) => (
              <ThreadCard key={t.id} thread={t} />
            ))}
          </div>
        ) : (
          <div className="workspace-empty">
            <span>No Luna chats yet.</span>
            <Link to="/workspace/assistant" className="workspace-text-link">
              Start a chat <ArrowUpRight className="size-4" strokeWidth={1.5} />
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}

function WorkflowCard({
  workflow,
  project,
}: {
  workflow: { projectId: string; workflowId: string; name: string; count: number };
  project?: { name: string };
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: () => launchWorkflow(workflow.workflowId, workflow.projectId),
    onSuccess: (r) => {
      void client.invalidateQueries({ queryKey: ["bootstrap"] });
      void navigate({
        to: "/p/$projectId/conversations/$sessionId",
        params: { projectId: workflow.projectId, sessionId: r.session.id },
      });
    },
  });
  return (
    <button
      className={`${card} workspace-workflow`}
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
    >
      <span className="workflow-glyph">
        <WandSparkles size={16} strokeWidth={1.5} aria-hidden />
      </span>
      <b>{workflow.name}</b>
      <small>
        {project?.name ?? "Project"} · used {workflow.count} times
      </small>
      {mutation.isError && (
        <small className="text-danger">
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Could not start this workflow."}
        </small>
      )}
      <span className="workspace-text-link">
        {mutation.isPending ? "Starting…" : "Run now"}
        <ArrowUpRight size={16} strokeWidth={1.5} />
      </span>
    </button>
  );
}
function ThreadCard({ thread }: { thread: AssistantThread }) {
  return (
    <Link
      to="/workspace/assistant/$threadId"
      params={{ threadId: thread.id }}
      className={`${card} workspace-thread-card`}
    >
      <span className={`status-dot ${thread.status}`} />
      <b>{thread.title || "New conversation"}</b>
      <small>
        {thread.preview || statusLabel(thread.status)} · {timeAgo(thread.updatedAt)}
      </small>
      {isThreadUnread(thread) && <span className="workspace-unread">New reply</span>}
    </Link>
  );
}

const GROUP_LABELS: Record<string, string> = {
  pinned: "Pinned",
  pending: "Needs your decision",
  failed: "Needs attention",
  unread: "Unread",
  active: "In progress",
  ready: "Ready to review",
  snoozed: "Snoozed",
  completed: "Completed",
};
export function WorkspaceInbox() {
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState("");
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [manualUnread, setManualUnread] = useState<string[]>([]);
  const [openMenu, setOpenMenu] = useState("");
  const [bulkNotice, setBulkNotice] = useState<{ error: boolean; text: string } | null>(null);
  const autoRead = useRef(new Map<string, number>());
  const projects = useAdeState((s) => s.projects);
  const client = useQueryClient();
  const projectNames = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const queryString = new URLSearchParams({
    ...(query ? { query } : {}),
    ...(projectId ? { projectId } : {}),
    ...(showSnoozed ? { includeSnoozed: "true" } : {}),
    ...(showCompleted ? { includeCompleted: "true" } : {}),
  }).toString();
  const inboxQuery = usePollingQuery(["workspace-inbox", queryString], () => getInbox(queryString));
  const items = inboxQuery.data?.groups ?? {};
  // Search makes the API include snoozed and completed work; the checkboxes
  // still decide what this page shows.
  const groups = Object.entries(items).filter(
    ([group, list]) =>
      list?.length &&
      (group !== "snoozed" || showSnoozed) &&
      (group !== "completed" || showCompleted),
  );
  const flatItems = groups.flatMap(([, list]) => list);
  const pinnedIds = new Set(
    (items["pinned"] ?? []).map((item) => item.sessionId).filter((id): id is string => !!id),
  );
  const selectedItems = selected
    .map((id) => flatItems.find((item) => item.sessionId === id))
    .filter((item): item is WorkspaceInboxItem => !!item);
  const selectedComplete = selectedItems.filter((item) => item.status === "complete");
  const selectedOpen = selectedItems.filter((item) => item.status !== "complete");
  const manualUnreadSet = useMemo(() => new Set(manualUnread), [manualUnread]);
  const bulk = useMutation({
    mutationFn: ({ action, ids }: { action: string; ids: string[] }) =>
      inboxBulk(ids.map((sessionId) => ({ sessionId, action }))),
    onSuccess: (data, { action, ids }) => {
      const failed = data.results.filter((result) => !result.ok);
      if (failed.length) {
        setBulkNotice({
          error: true,
          text: `${failed.length} of ${data.results.length} could not be updated. ${
            failed[0]?.error ?? "Try again."
          }`,
        });
        setSelected(failed.map((result) => result.sessionId));
      } else {
        setBulkNotice(null);
        setSelected([]);
      }
      if (action === "read") setManualUnread((list) => list.filter((id) => !ids.includes(id)));
      void client.invalidateQueries({ queryKey: ["workspace-inbox"] });
      void client.invalidateQueries({ queryKey: ["bootstrap"] });
    },
    onError: (error) =>
      setBulkNotice({
        error: true,
        text: error instanceof Error ? error.message : "Could not update the selection.",
      }),
  });
  useEffect(() => {
    setSelected([]);
    setOpenMenu("");
    setBulkNotice(null);
  }, [query, projectId, showSnoozed, showCompleted]);
  // Opening the inbox settles unread replies. Skip rows the user is selecting,
  // and rows they explicitly marked unread again. One request per session even
  // when a pinned row also appears in its own group.
  useEffect(() => {
    for (const item of flatItems) {
      const sessionId = item.sessionId;
      if (
        !sessionId ||
        selected.includes(sessionId) ||
        manualUnreadSet.has(sessionId) ||
        item.manualUnread === true
      )
        continue;
      if (item.unread !== true && item.group !== "unread") continue;
      const updatedAt = item.updatedAt ?? 0;
      if (updatedAt <= (item.readAt ?? 0) || autoRead.current.get(sessionId) === updatedAt)
        continue;
      autoRead.current.set(sessionId, updatedAt);
      void markSessionRead(sessionId)
        .then(() => client.invalidateQueries({ queryKey: ["workspace-inbox"] }))
        .catch(() => autoRead.current.delete(sessionId));
    }
  }, [flatItems, selected, manualUnreadSet, client]);
  const runBulk = (action: string) => {
    if (!selected.length) return;
    setBulkNotice(null);
    bulk.mutate({ action, ids: selected });
  };
  const toggle = (sessionId: string) =>
    setSelected((list) =>
      list.includes(sessionId) ? list.filter((id) => id !== sessionId) : [...list, sessionId],
    );
  return (
    <main className="workspace-page">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="label-mono">Workspace</span>
            <span className="label-mono">/ inbox</span>
          </div>
          <h1 className="mt-2 text-lg font-medium leading-snug">Inbox</h1>
          <p className="mt-1 text-xs leading-5 text-dim">
            Decisions, updates and work that needs a look.
          </p>
        </div>
        <Link to="/workspace/assistant" className={primaryButton}>
          <MessageCircle size={16} strokeWidth={1.5} aria-hidden /> Ask Luna
        </Link>
      </div>
      <div className="workspace-inbox-body">
        <div className="workspace-inbox-toolbar">
          <label className="workspace-search">
            <Search size={16} strokeWidth={1.5} aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              aria-label="Search inbox"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear search">
                <X size={16} strokeWidth={1.5} />
              </button>
            )}
          </label>
          <select
            aria-label="Filter by project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="workspace-filter-check">
            <input
              type="checkbox"
              checked={showSnoozed}
              onChange={(e) => setShowSnoozed(e.target.checked)}
            />{" "}
            Snoozed
          </label>
          <label className="workspace-filter-check">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(e) => setShowCompleted(e.target.checked)}
            />{" "}
            Completed
          </label>
        </div>
        {selected.length > 0 && (
          <div className="workspace-bulk">
            <b>{selected.length} selected</b>
            <button
              className={quietButton}
              disabled={bulk.isPending}
              onClick={() => runBulk("read")}
            >
              Mark read
            </button>
            {selectedOpen.length > 0 && (
              <button
                className={quietButton}
                disabled={bulk.isPending}
                onClick={() => runBulk("complete")}
              >
                Complete
              </button>
            )}
            {selectedComplete.length > 0 && (
              <button
                className={quietButton}
                disabled={bulk.isPending}
                onClick={() => runBulk("reopen")}
              >
                Reopen
              </button>
            )}
            {bulkNotice && (
              <span
                role="alert"
                className={`text-xs ${bulkNotice.error ? "text-danger" : "text-dim"}`}
              >
                {bulkNotice.text}
              </span>
            )}
            <button
              className="workspace-icon-button"
              aria-label="Clear selection"
              onClick={() => setSelected([])}
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
        )}
        {inboxQuery.isError ? (
          <div className={`${card} workspace-empty`} role="alert">
            <span className="grid gap-0.5">
              <b className="text-ui font-medium text-ink">Could not load the inbox</b>
              <span className="text-danger">
                {inboxQuery.error instanceof Error
                  ? inboxQuery.error.message
                  : "The local service did not return the inbox."}
              </span>
            </span>
            <button className={quietButton} onClick={() => void inboxQuery.refetch()}>
              Try again
            </button>
          </div>
        ) : inboxQuery.isLoading ? (
          <p className="workspace-muted">Loading inbox…</p>
        ) : groups.length === 0 ? (
          <div className={`${card} workspace-empty`}>
            <Check className="size-4 shrink-0 text-teal-deep" strokeWidth={1.5} aria-hidden />
            <span className="grid gap-0.5">
              <b className="text-ui font-medium text-ink">
                {query || projectId ? "No conversations match" : "All caught up"}
              </b>
              <span>
                {query || projectId
                  ? "Clear the search or project filter to widen the inbox."
                  : "Questions and completed work show up here."}
              </span>
            </span>
          </div>
        ) : (
          <div className="workspace-inbox-groups">
            {groups.map(([group, list]) => (
              <section key={group} className="workspace-section">
                <div className="workspace-section-head">
                  <div>
                    <h2>{GROUP_LABELS[group] ?? statusLabel(group)}</h2>
                    <p>
                      {list.length}
                      {inboxQuery.data?.totals?.[group] &&
                      inboxQuery.data.totals[group] > list.length
                        ? ` of ${inboxQuery.data.totals[group]}`
                        : ""}{" "}
                      {list.length === 1 ? "conversation" : "conversations"}
                    </p>
                  </div>
                </div>
                <div className="workspace-inbox-list">
                  {list.map((item) => {
                    const sessionId = item.sessionId;
                    const rowKey = `${group}:${item.projectId}:${sessionId ?? item.id}`;
                    return (
                      <InboxRow
                        key={rowKey}
                        item={item}
                        selected={!!sessionId && selected.includes(sessionId)}
                        pinned={!!sessionId && pinnedIds.has(sessionId)}
                        menuOpen={openMenu === rowKey}
                        onMenuChange={(open) => setOpenMenu(open ? rowKey : "")}
                        projectName={
                          item.projectName ??
                          (sessionId ? projectNames.get(item.projectId) : undefined)
                        }
                        onToggle={() => {
                          if (sessionId) toggle(sessionId);
                        }}
                        onManualUnread={(id) =>
                          setManualUnread((list) => (list.includes(id) ? list : [...list, id]))
                        }
                        onOpen={() => {
                          const id = item.sessionId;
                          if (!id) return;
                          setManualUnread((list) => list.filter((x) => x !== id));
                          void markSessionRead(id).then(() =>
                            client.invalidateQueries({ queryKey: ["workspace-inbox"] }),
                          );
                        }}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
            {inboxQuery.data?.nextCursor && (
              <p className="workspace-muted">
                Showing the first page. Search or filter by project to see more.
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
function InboxRow({
  item,
  selected,
  pinned,
  menuOpen,
  projectName,
  onToggle,
  onMenuChange,
  onManualUnread,
  onOpen,
}: {
  item: WorkspaceInboxItem;
  selected: boolean;
  pinned: boolean;
  menuOpen: boolean;
  projectName?: string | undefined;
  onToggle: () => void;
  onMenuChange: (open: boolean) => void;
  onManualUnread: (sessionId: string) => void;
  onOpen: () => void;
}) {
  const client = useQueryClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isProjectDev = item.kind === "project-dev-command" || item.sessionId == null;
  const isSnoozed = item.group === "snoozed" || (!!item.snooze && !item.snooze.returnedAt);
  const canSnooze = item.group !== "pending" && !isSnoozed;
  const act = async (action: string, extra?: { until?: number | "finished"; preset?: string }) => {
    const sessionId = item.sessionId;
    if (!sessionId) return;
    setError("");
    setBusy(true);
    try {
      const data = await inboxBulk([{ sessionId, action, ...extra }]);
      const result = data.results[0];
      if (!result?.ok) throw new Error(result?.error ?? "Could not update this conversation.");
      if (action === "unread") onManualUnread(sessionId);
      onMenuChange(false);
      void client.invalidateQueries({ queryKey: ["workspace-inbox"] });
      void client.invalidateQueries({ queryKey: ["bootstrap"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this conversation.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`${card} workspace-inbox-row ${selected ? "selected" : ""}`}>
      {!isProjectDev && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${item.title}`}
        />
      )}
      <span className={`status-dot ${item.status}`} />
      {isProjectDev ? (
        <Link
          to="/p/$projectId/conversations"
          params={{ projectId: item.projectId }}
          className="workspace-inbox-main"
        >
          <b>{item.title || "Development command needs approval"}</b>
          <span>{item.summary || item.request || statusLabel(item.status)}</span>
        </Link>
      ) : (
        <Link
          to="/p/$projectId/conversations/$sessionId"
          params={{ projectId: item.projectId, sessionId: item.sessionId! }}
          className="workspace-inbox-main"
          onClick={onOpen}
        >
          <b>{item.title || "Untitled conversation"}</b>
          <span>{item.summary || statusLabel(item.status)}</span>
        </Link>
      )}
      <span className="workspace-inbox-project">{projectName || "Project"}</span>
      <time>{timeAgo(item.updatedAt)}</time>
      {!isProjectDev && (
        <div className="workspace-row-menu">
          <button
            className="workspace-icon-button"
            aria-label="Conversation actions"
            disabled={busy}
            onClick={() => {
              setError("");
              onMenuChange(!menuOpen);
            }}
          >
            <MoreHorizontal size={16} strokeWidth={1.5} aria-hidden />
          </button>
          {menuOpen && (
            <div className="workspace-menu">
              {error && (
                <span role="alert" className="px-2 py-1 text-caption text-danger">
                  {error}
                </span>
              )}
              {pinned ? (
                <button disabled={busy} onClick={() => void act("unpin")}>
                  Unpin
                </button>
              ) : (
                <button disabled={busy} onClick={() => void act("pin")}>
                  Pin
                </button>
              )}
              {isSnoozed ? (
                <button disabled={busy} onClick={() => void act("unsnooze")}>
                  Unsnooze
                </button>
              ) : canSnooze ? (
                <>
                  <div className="workspace-menu-label">Snooze</div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act("snooze", { until: Date.now() + 3600_000, preset: "In 1 hour" })
                    }
                  >
                    In 1 hour
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act("snooze", { until: tomorrowNineAM(), preset: "Tomorrow 9am" })
                    }
                  >
                    Tomorrow 9am
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act("snooze", { until: "finished", preset: "When work finishes" })
                    }
                  >
                    When work finishes
                  </button>
                </>
              ) : null}
              <button disabled={busy} onClick={() => void act("unread")}>
                Mark unread
              </button>
              {item.status === "complete" ? (
                <button disabled={busy} onClick={() => void act("reopen")}>
                  Reopen
                </button>
              ) : (
                <button disabled={busy} onClick={() => void act("complete")}>
                  Complete
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function WorkspaceSettings() {
  const client = useQueryClient();
  const { data, error: loadError } = useQuery({
    queryKey: ["workspace-voice"],
    queryFn: getVoiceSettings,
  });
  const [voice, setVoice] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [error, setError] = useState("");
  useEffect(() => {
    if (data?.voice) setVoice({ ...DEFAULT_VOICE, ...data.voice });
  }, [data]);
  const save = useMutation({
    mutationFn: (patch: Partial<VoiceSettings>) => updateVoiceSettings(patch),
    onSuccess: (saved) => {
      setError("");
      setVoice({ ...DEFAULT_VOICE, ...saved.voice });
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : "Could not save this voice setting.");
      void client.invalidateQueries({ queryKey: ["workspace-voice"] });
    },
  });
  const toggle = (key: keyof VoiceSettings, value: boolean) => {
    setError("");
    setVoice((current) => ({ ...current, [key]: value }));
    save.mutate({ [key]: value });
  };
  return (
    <main className="workspace-page @container">
      <div className="max-w-3xl">
        <div className="flex items-center gap-2">
          <Link to="/workspace" className="label-mono hover:text-ink">
            Workspace
          </Link>
          <span className="label-mono">/ settings</span>
        </div>
        <h1 className="mt-2 text-lg font-medium leading-snug">Luna settings</h1>
        <p className="mt-1 text-sm leading-5 text-dim">
          Choose how Luna speaks and listens in this browser.
        </p>
        <div className="label-section mb-2 mt-6">Voice</div>
        <section className="card-panel divide-y divide-line">
          <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
            <span>
              <span className="block text-sm font-medium">Mute voice</span>
              <span className="block text-xs leading-5 text-dim">
                Silence spoken replies and dictation chimes.
              </span>
            </span>
            <input
              type="checkbox"
              checked={voice.muted}
              onChange={(event) => toggle("muted", event.target.checked)}
              className="size-4 shrink-0 accent-amber"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
            <span>
              <span className="block text-sm font-medium">Speak replies</span>
              <span className="block text-xs leading-5 text-dim">
                Read new replies aloud on supported desktop browsers.
              </span>
            </span>
            <input
              type="checkbox"
              checked={voice.speakReplies}
              disabled={voice.muted}
              onChange={(event) => toggle("speakReplies", event.target.checked)}
              className="size-4 shrink-0 accent-amber disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3">
            <span>
              <span className="block text-sm font-medium">Dictation chime</span>
              <span className="block text-xs leading-5 text-dim">
                Play a short cue when microphone capture starts.
              </span>
            </span>
            <input
              type="checkbox"
              checked={voice.chimeDuringDictation}
              disabled={voice.muted}
              onChange={(event) => toggle("chimeDuringDictation", event.target.checked)}
              className="size-4 shrink-0 accent-amber disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
        </section>
        {(error || loadError) && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {error ||
              (loadError instanceof Error ? loadError.message : "Could not load voice settings.")}
          </p>
        )}
      </div>
    </main>
  );
}

function ProjectAvatar({
  project,
  large = false,
}: {
  project: { name: string; color?: string | null; icon?: string | null };
  large?: boolean;
}) {
  const icon = project.icon ?? "";
  const image = /^(data:image\/|https?:)/i.test(icon);
  return (
    <div
      className={`workspace-project-avatar ${large ? "large" : ""}`}
      style={project.color ? { background: `${project.color}24`, color: project.color } : undefined}
    >
      {image ? (
        <img src={icon} alt="" />
      ) : icon ? (
        icon
      ) : (
        (project.name.trim().charAt(0) || "?").toUpperCase()
      )}
    </div>
  );
}

/** A simple icon from a plain-language description, stored as an emoji. */
function iconFromDescription(text: string) {
  const value = text.toLowerCase();
  if (/leaf|tree|forest|plant|garden|green/.test(value)) return "🌿";
  if (/sun|solar|light|warm/.test(value)) return "☀️";
  if (/sea|ocean|water|wave|river/.test(value)) return "🌊";
  if (/rocket|launch|ship|fast/.test(value)) return "🚀";
  if (/book|read|write|doc|note/.test(value)) return "📚";
  if (/web|globe|browser|site/.test(value)) return "🌐";
  if (/chart|data|metric|graph|growth/.test(value)) return "📈";
  if (/music|sound|audio|voice/.test(value)) return "🎵";
  if (/camera|photo|image|picture/.test(value)) return "📷";
  if (/code|dev|build|tool|wrench/.test(value)) return "🧩";
  if (/star|night|space|moon/.test(value)) return "✦";
  return "✨";
}

function ProjectSettingsPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["workspace-project-settings", projectId],
    queryFn: () => getProjectSettings(projectId),
  });
  const [instructions, setInstructions] = useState("");
  const [color, setColor] = useState("#c48739");
  const [icon, setIcon] = useState("");
  const [description, setDescription] = useState("");
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    setDescription("");
    setFeedback("");
  }, [projectId]);
  useEffect(() => {
    if (!settings.data) return;
    setInstructions(settings.data.instructions ?? "");
    setColor(settings.data.color ?? "#c48739");
    setIcon(settings.data.icon ?? "");
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () =>
      updateProjectSettings(projectId, {
        expectedRevision: settings.data?.revision ?? 0,
        instructions,
        color,
        icon: icon.trim(),
      }),
    onSuccess: (data) => {
      setInstructions(data.instructions ?? "");
      setColor(data.color ?? "#c48739");
      setIcon(data.icon ?? "");
      setFeedback(`Saved revision ${data.revision}. Every new turn receives it.`);
      void client.invalidateQueries({ queryKey: ["workspace-project-settings", projectId] });
      void client.invalidateQueries({ queryKey: ["bootstrap"] });
    },
    onError: (error) => {
      setFeedback(
        error instanceof Error
          ? `${error.message} Reload the panel to get the current revision.`
          : "Could not save project settings.",
      );
    },
  });
  return (
    <section className={`${card} workspace-project-settings-panel`}>
      <div className="workspace-section-head">
        <div>
          <h2>{settings.data?.project.name ?? "Project"} settings</h2>
          <p>Instructions apply to every agent turn. Revision {settings.data?.revision ?? "…"}.</p>
        </div>
        <button
          className="workspace-icon-button"
          aria-label="Close project settings"
          onClick={onClose}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>
      {settings.isLoading ? (
        <p className="workspace-muted">Loading settings…</p>
      ) : settings.isError ? (
        <div className="workspace-empty">
          <span className="text-xs text-danger">{(settings.error as Error).message}</span>
          <button className={quietButton} onClick={() => void settings.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <div className="project-settings-grid">
          <label className="grid gap-1.5 text-xs font-medium">
            ADE-managed instructions
            <textarea
              rows={5}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Keep changes small and safe. Run the checks before reporting done."
            />
          </label>
          <div className="project-identity-row">
            <label>
              Color
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </label>
            <label>
              Icon (emoji or image URL)
              <input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="🌿"
                aria-label="Project icon"
              />
            </label>
            <div className="project-icon-preview" aria-hidden>
              <ProjectAvatar project={{ name: "", color, icon }} />
            </div>
          </div>
          <div className="project-icon-generate">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe an icon: a calm forest, a launch rocket…"
              aria-label="Describe an icon"
            />
            <button
              className={quietButton}
              disabled={!description.trim()}
              onClick={() => setIcon(iconFromDescription(description))}
            >
              <WandSparkles size={16} strokeWidth={1.5} /> Make icon
            </button>
          </div>
          <div className="project-settings-actions">
            <span
              role="status"
              aria-live="polite"
              className={save.isError ? "text-xs text-danger" : "workspace-muted"}
            >
              {feedback}
            </span>
            <button
              className={primaryButton}
              disabled={save.isPending || !settings.data}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save project settings"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function WorkspaceProjects() {
  const { projects, sessions } = useAdeState((s) => ({
    projects: s.projects,
    sessions: s.sessions,
  }));
  const { openDialog } = useShell();
  const [editing, setEditing] = useState("");
  return (
    <main className="workspace-page">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="label-mono">Workspace</span>
            <span className="label-mono">/ projects</span>
          </div>
          <h1 className="mt-2 text-lg font-medium leading-snug">Projects</h1>
          <p className="mt-1 text-xs leading-5 text-dim">
            A home for every codebase and the work happening inside it.
          </p>
        </div>
        <button className={primaryButton} onClick={() => openDialog("add-project")}>
          <Plus size={16} strokeWidth={1.5} aria-hidden /> Add project
        </button>
      </div>
      <div className="workspace-project-grid">
        {projects.map((p) => {
          const count = sessions.filter(
            (s) => s.projectId === p.id && ["working", "verifying", "queued"].includes(s.status),
          ).length;
          return (
            <div className="workspace-project-tile-wrap" key={p.id}>
              <Link
                to="/p/$projectId/conversations"
                params={{ projectId: p.id }}
                className={`${card} workspace-project-tile`}
              >
                <ProjectAvatar project={p} large />
                <div>
                  <b>{p.name}</b>
                  <small>{p.path}</small>
                </div>
                <span className="workspace-project-count">
                  {count ? `${count} active` : "Idle"}
                </span>
              </Link>
              <button
                className="workspace-icon-button workspace-project-settings"
                aria-label={`Settings for ${p.name}`}
                title={`Instructions, color and icon for ${p.name}`}
                onClick={() => setEditing(editing === p.id ? "" : p.id)}
              >
                <Settings2 size={16} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
      {editing && <ProjectSettingsPanel projectId={editing} onClose={() => setEditing("")} />}
      <div className={`${card} workspace-discover-callout`}>
        <div>
          <b>Add a project from a folder</b>
          <small>Register an existing project or create a fresh workspace.</small>
        </div>
        <button className={quietButton} onClick={() => openDialog("add-project")}>
          <FolderOpen size={16} strokeWidth={1.5} aria-hidden /> Add folder
        </button>
      </div>
    </main>
  );
}
