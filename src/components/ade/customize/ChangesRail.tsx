import { useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { GlideIndicator } from "@/components/ade/motion";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { BUSY, NEEDS_YOU, type Change, type CustomizeState } from "@/lib/ade/customizeApi";
import { useAdeState, useNow } from "@/lib/ade/store";
import { changeDate } from "./customizeText";
import { ChangeStatusLabel } from "./ChangeStatusLabel";
import { useCustomizePane } from "./paneContext";

type Filter = "all" | "needs" | "working" | "kept";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs", label: "Needs you" },
  { id: "working", label: "Working" },
  { id: "kept", label: "Kept" },
];

// Same compact call-site overrides as the conversation list so all four filters fit.
const FILTER_CONTROL =
  "w-full [&>div]:gap-0! [&>div]:p-0.5! [&_button]:min-h-7! [&_button]:grow! [&_button]:px-1! [&_button]:text-xs! [&_button>span]:gap-1!";

function matches(change: Change, filter: Filter) {
  if (filter === "needs") return NEEDS_YOU.includes(change.status);
  if (filter === "working") return BUSY.includes(change.status);
  if (filter === "kept") return change.status === "kept";
  return true;
}

export function ChangesRail({ state }: { state: CustomizeState | undefined }) {
  const { changeId } = useParams({ strict: false });
  const agents = useAdeState((s) => s.agents);
  const now = useNow();
  const { setPane } = useCustomizePane();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [showRemoved, setShowRemoved] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (state?.changes ?? []).filter(
      (change) =>
        (showRemoved || change.status !== "removed") &&
        (!q || change.title.toLowerCase().includes(q) || change.request.toLowerCase().includes(q)),
    );
  }, [state?.changes, query, showRemoved]);

  const counts = useMemo(
    () => ({
      all: visible.length,
      needs: visible.filter((c) => matches(c, "needs")).length,
      working: visible.filter((c) => matches(c, "working")).length,
      kept: visible.filter((c) => matches(c, "kept")).length,
    }),
    [visible],
  );
  const list = visible.filter((change) => matches(change, filter));
  const ready = state?.available && state.setup.status === "ready";

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-5 pb-2">
        <h2 className="text-lg font-medium leading-none">Changes</h2>
        <Link
          to="/workspace/customize"
          onClick={() => setPane("conversation")}
          aria-label="New change"
          title="New change"
          className="ml-auto grid size-7 place-items-center rounded-lg text-dim transition-colors hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
        >
          <Plus className="size-4" aria-hidden strokeWidth={1.5} />
        </Link>
      </div>

      <div className="shrink-0 px-2 pb-2">
        <label className="relative block">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-dim"
            strokeWidth={1.5}
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search changes"
            aria-label="Search changes"
            className="h-8 w-full rounded-md border border-line bg-paper pr-3 pl-8 text-ui text-ink placeholder:text-dim focus-visible:outline-2 focus-visible:outline-amber"
          />
        </label>
      </div>

      <div className="flex w-full shrink-0 px-2 pb-3">
        <SegmentedControl
          className={FILTER_CONTROL}
          label="Filters"
          value={filter}
          onValueChange={(next) => setFilter(next as Filter)}
          options={FILTERS.map((f) => ({
            value: f.id,
            label: f.label,
            accessory:
              f.id !== "all" && counts[f.id] > 0 ? (
                <span className="tabular-nums opacity-70">{counts[f.id]}</span>
              ) : undefined,
          }))}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {list.map((change) => {
          const active = change.id === changeId;
          const agent = agents.find((a) => a.id === change.agentId);
          return (
            <div key={change.id} className="pb-1">
              <Link
                to="/workspace/customize/$changeId"
                params={{ changeId: change.id }}
                onClick={() => setPane("conversation")}
                aria-current={active ? "page" : undefined}
                className={`relative isolate block w-full overflow-hidden rounded-md px-3 py-2 text-left transition-colors ${
                  active ? "" : "hover:bg-ink/[0.04]"
                }`}
              >
                {active && (
                  <GlideIndicator
                    id="customize-change-active"
                    className="absolute inset-0 -z-10 rounded-md bg-surface-muted ring-1 ring-ink/[0.08] ring-inset"
                  />
                )}
                <p className="line-clamp-1 text-ui leading-5 text-ink" title={change.request}>
                  {change.title}
                </p>
                <div className="mt-1 flex h-4 items-center gap-2 overflow-hidden whitespace-nowrap">
                  <span className="min-w-0 truncate text-xs text-dim tabular-nums">
                    {agent?.short ?? change.agentId} · {changeDate(now, change.createdAt)}
                  </span>
                  <span className="ml-auto">
                    <ChangeStatusLabel status={change.status} />
                  </span>
                </div>
              </Link>
            </div>
          );
        })}
        {list.length === 0 && (
          <p className="px-3 py-6 text-xs text-dim">
            {!ready ? "No changes yet." : query.trim() ? "No changes match." : "No changes here."}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-3 py-3">
        <span className="text-xs whitespace-nowrap text-dim tabular-nums">
          {list.length} change{list.length === 1 ? "" : "s"}
        </span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs whitespace-nowrap text-dim">
          <input
            type="checkbox"
            checked={showRemoved}
            onChange={(e) => setShowRemoved(e.target.checked)}
            className="size-3.5 accent-[var(--text-secondary)]"
          />
          Show removed
        </label>
      </div>
    </div>
  );
}
