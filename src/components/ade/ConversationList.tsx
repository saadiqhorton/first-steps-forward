import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { GlideIndicator, MotionItem } from "@/components/ade/motion";
import { StatusPill } from "@/components/ade/StatusPill";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { needsYou, searchSessions, useAdeState, useNow } from "@/lib/ade/store";
import type { Session, SessionSummary } from "@/lib/ade/types";
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

// Arc's segmented control styles live in an unlayered CSS module, so these call-site
// overrides need `!` to beat it from Tailwind's utilities layer. Compact enough that
// all four filters fit the default sidebar without clipping a label.
const FILTER_CONTROL =
  "w-full [&>div]:gap-0! [&>div]:p-0.5! [&_button]:min-h-7! [&_button]:grow! [&_button]:px-1! [&_button]:text-xs! [&_button>span]:gap-1!";

function titleOf(session: SessionSummary): string {
  const request = (session.displayRequest ?? session.request)?.trim() ?? "";
  const summary = session.summary?.trim() ?? "";
  if (request) return sessionTitle(request);
  return summary || "Untitled";
}

function latestUserAt(session: Session | SessionSummary): number | undefined {
  return "lastUserMessageAt" in session ? session.lastUserMessageAt : undefined;
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
  const { sessions, agents } = useAdeState((state) => ({
    sessions: state.sessions,
    agents: state.agents,
  }));
  const now = useNow();
  const viewed = useViewed();
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [query, setQuery] = useState("");
  const searchResult = useQuery({
    queryKey: ["session-search", projectId, query.trim()],
    queryFn: () => searchSessions(projectId, query.trim()),
    staleTime: 15_000,
    enabled: query.trim().length > 0,
  });
  const searchMatches = useMemo(
    () => (searchResult.data ? new Set(searchResult.data.ids) : undefined),
    [searchResult.data],
  );

  const showCompleted = search.completed !== false;

  const projectSessions = useMemo(
    () => sessions.filter((s) => s.projectId === projectId),
    [sessions, projectId],
  );

  const counts = useMemo(() => {
    const opts = { query, showCompleted, viewed, searchMatches };
    const count = (f: ConversationFilter) =>
      filterSessions(projectSessions, { ...opts, filter: f }).length;
    return {
      all: count("all"),
      needs: count("needs"),
      working: count("working"),
      unread: count("unread"),
    };
  }, [projectSessions, query, showCompleted, viewed, searchMatches]);

  const filtered = useMemo(
    () => filterSessions(projectSessions, { filter, query, showCompleted, viewed, searchMatches }),
    [projectSessions, filter, query, showCompleted, viewed, searchMatches],
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
          className="ml-auto grid size-7 place-items-center rounded-md text-dim transition-colors hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
        >
          <Plus className="size-4" aria-hidden strokeWidth={1.5} />
        </Link>
      </div>

      <div className="shrink-0 px-2 pb-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
          className="h-8 w-full rounded-lg border border-line bg-paper px-3 text-[13px] text-ink placeholder:text-dim focus-visible:outline-2 focus-visible:outline-amber"
        />
      </div>

      <div className="flex w-full shrink-0 px-2 pb-3">
        <SegmentedControl
          className={FILTER_CONTROL}
          label="Filters"
          value={filter}
          onValueChange={(next) => setFilter(next as ConversationFilter)}
          options={FILTERS.map((f) => ({
            value: f.id,
            label: f.label,
            // The footer already counts the list, so "All" carries no figure; the rest show one only when non-zero.
            accessory:
              f.id !== "all" && counts[f.id] > 0 ? (
                <span className="tabular-nums opacity-70">{counts[f.id]}</span>
              ) : undefined,
          }))}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <AnimatePresence initial={false}>
          {filtered.map((session) => {
            const agent = agents.find((a) => a.id === session.agentId);
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
                  className={`relative isolate block w-full overflow-hidden rounded-lg px-3 py-2 text-left transition-colors ${
                    active ? "" : "hover:bg-ink/[0.04]"
                  }`}
                >
                  {active && (
                    <GlideIndicator
                      id="conversation-active"
                      className="absolute inset-0 -z-10 rounded-lg bg-surface-muted ring-1 ring-ink/[0.08] ring-inset"
                    />
                  )}
                  <div className="flex items-start gap-2">
                    {unread && (
                      <span
                        className="mt-2 size-1.5 shrink-0 rounded-full bg-amber"
                        aria-label="Unread"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className="line-clamp-1 text-[13px] leading-5 text-ink"
                        title={session.displayRequest ?? session.request}
                      >
                        {titleOf(session)}
                      </p>
                      <div className="mt-1 flex h-4 items-center gap-2 overflow-hidden whitespace-nowrap">
                        <span className="text-xs text-dim tabular-nums">
                          {agent?.short ?? session.agentId} · {format(session.updatedAt, "MMM d")}
                        </span>
                        <StatusPill status={session.status} needsYou={needsYou(session)} />
                        {showElapsed && (
                          <span className="font-mono text-xs tabular-nums text-teal">
                            {formatElapsed(now, turnStart)}
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
          <p className="px-3 py-6 text-center text-xs text-dim">No conversations match.</p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-3 py-3">
        <span className="text-xs whitespace-nowrap text-dim tabular-nums">
          {filtered.length} conversation{filtered.length === 1 ? "" : "s"}
        </span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs whitespace-nowrap text-dim">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
            className="size-3.5 accent-[var(--text-secondary)]"
          />
          Show completed
        </label>
      </div>
    </div>
  );
}
