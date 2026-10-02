import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { GlideIndicator, MotionItem } from "@/components/ade/motion";
import { StatusPill } from "@/components/ade/StatusPill";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { useAde } from "@/lib/ade/store";
import type { Session } from "@/lib/ade/types";
import { sessionTitle } from "@/lib/ade/sessionTitle";
import {
  filterSessions,
  isUnread,
  markViewed,
  useViewed,
  type ConversationFilter,
} from "@/lib/ade/viewed";

const FILTERS: { id: ConversationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs", label: "Needs you" },
  { id: "working", label: "Working" },
  { id: "unread", label: "Unread" },
];

function titleOf(session: Session): string {
  const request = session.request?.trim() ?? "";
  const summary = session.summary?.trim() ?? "";
  if (request) return sessionTitle(request);
  return summary || "Untitled";
}

function latestUserAt(session: Session): number | undefined {
  let latest: number | undefined;
  for (const m of session.messages) {
    if (m.role !== "user") continue;
    if (latest === undefined || m.at > latest) latest = m.at;
  }
  return latest;
}

function formatElapsed(now: number, from: number): string {
  const secs = Math.max(0, Math.floor((now - from) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function ConversationList() {
  const { projectId } = useParams({ from: "/p/$projectId/conversations" });
  const { sessionId: activeSessionId } = useParams({ strict: false });
  const search = useSearch({ from: "/p/$projectId/conversations" });
  const navigate = useNavigate({ from: "/p/$projectId/conversations" });
  const { state } = useAde();
  const viewed = useViewed();
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [query, setQuery] = useState("");

  const showCompleted = search.completed !== false;

  const projectSessions = useMemo(
    () => state.sessions.filter((s) => s.projectId === projectId),
    [state.sessions, projectId],
  );

  const counts = useMemo(() => {
    const opts = { query, showCompleted, viewed };
    const count = (f: ConversationFilter) =>
      filterSessions(projectSessions, { ...opts, filter: f }).length;
    return {
      all: count("all"),
      needs: count("needs"),
      working: count("working"),
      unread: count("unread"),
    };
  }, [projectSessions, query, showCompleted, viewed]);

  const filtered = useMemo(
    () => filterSessions(projectSessions, { filter, query, showCompleted, viewed }),
    [projectSessions, filter, query, showCompleted, viewed],
  );

  const setShowCompleted = (checked: boolean) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        // Default is on; only persist an explicit off in the URL.
        completed: checked ? undefined : false,
      }),
      replace: true,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-5 pb-2">
        <h2 className="text-lg font-medium leading-none">Conversations</h2>
        <Link
          to="/p/$projectId/conversations"
          params={{ projectId }}
          search={(prev) => prev}
          aria-label="New conversation"
          className="ml-auto grid size-7 place-items-center rounded-md text-dim hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
        >
          <Plus className="size-4" aria-hidden strokeWidth={2} />
        </Link>
      </div>

      <div className="shrink-0 px-3 pb-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
          className="w-full rounded-md border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink placeholder:text-dim focus-visible:outline-2 focus-visible:outline-amber"
        />
      </div>

      <div className="flex w-full shrink-0 px-3 pb-3">
        <SegmentedControl
          className="w-full max-w-none"
          label="Filters"
          value={filter}
          onValueChange={(next) => setFilter(next as ConversationFilter)}
          options={FILTERS.map((f) => ({
            value: f.id,
            label: f.label,
            accessory: <span className="tabular-nums opacity-70">{counts[f.id]}</span>,
          }))}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <AnimatePresence initial={false}>
          {filtered.map((session) => {
            const agent = state.agents.find((a) => a.id === session.agentId);
            const active = session.id === activeSessionId;
            const unread = isUnread(session, viewed);
            const turnStart = latestUserAt(session);
            const showElapsed =
              (session.status === "working" || session.status === "verifying") && turnStart != null;
            return (
              <MotionItem key={session.id} layout={false} className="pb-1">
                <Link
                  to="/p/$projectId/conversations/$sessionId"
                  params={{ projectId, sessionId: session.id }}
                  search={(prev) => prev}
                  onClick={() => markViewed(session.id, session.updatedAt)}
                  className={`relative isolate block w-full overflow-hidden rounded-md px-3 py-2.5 text-left transition-colors ${
                    active ? "" : "hover:bg-ink/[0.04]"
                  }`}
                >
                  {active && (
                    <GlideIndicator
                      id="conversation-active"
                      className="absolute inset-0 -z-10 rounded-md bg-amber/10 ring-1 ring-amber/25 ring-inset"
                    />
                  )}
                  <div className="flex items-start gap-2">
                    {unread && (
                      <span
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber"
                        aria-label="Unread"
                      />
                    )}
                    <div className={`min-w-0 flex-1 ${unread ? "" : "pl-0"}`}>
                      <p
                        className="line-clamp-1 text-[13px] leading-snug text-ink"
                        title={session.request}
                      >
                        {titleOf(session)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono text-[10px] text-dim">
                          {agent?.short ?? session.agentId} · {format(session.updatedAt, "MMM d")}
                        </span>
                        <StatusPill status={session.status} />
                        {showElapsed && (
                          <span className="font-mono text-[10px] tabular-nums text-teal">
                            {formatElapsed(state.now, turnStart)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              </MotionItem>
            );
          })}
        </AnimatePresence>
        {filtered.length === 0 && (
          <p className="px-3 py-6 text-center text-[12px] text-dim">No conversations match.</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-2.5">
        <span className="font-mono text-[10px] text-dim tabular-nums">
          {filtered.length} conversation{filtered.length === 1 ? "" : "s"}
        </span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12px] text-dim">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
            className="size-3.5 accent-[var(--amber)]"
          />
          Show completed
        </label>
      </div>
    </div>
  );
}
