import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CircleAlert,
  Eye,
  FileText,
  Globe,
  Info,
  ListChecks,
  LoaderCircle,
  MessageSquare,
  Monitor,
  PencilLine,
  Search,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Sparkles,
  SquareTerminal,
  Check,
  type LucideIcon,
} from "lucide-react";
import { AgentActivity, type AgentActivityItem } from "@/components/agents/agent-activity";
import { groupActivityTurns, trimmedFromFront } from "@/lib/ade/activityTurns.mjs";
import type { SummaryPart, TurnGroup, TurnItem } from "@/lib/ade/activityTurns.mjs";
import { currentActivity, formatSessionLogs } from "@/lib/ade/formatLogs.mjs";
import { scrollToEnd } from "@/lib/ade/scrollToEnd";
import { cn } from "@/lib/utils";

const STEP_ICON: Record<string, LucideIcon> = {
  edit: PencilLine,
  read: FileText,
  search: Search,
  fetch: Globe,
  run: SquareTerminal,
  preview: Monitor,
  browse: Eye,
  tool: Sparkles,
  plan: ListChecks,
  message: MessageSquare,
  result: Check,
  notice: Info,
};

function itemIcon(item: TurnItem, running: boolean) {
  if (running) return <LoaderCircle className="size-4 animate-spin" />;
  if (item.status === "failed") return <CircleAlert className="size-4 text-danger" />;
  if (item.kind === "permission") {
    const Icon =
      item.decision === "asked"
        ? ShieldQuestion
        : item.decision === "allowed"
          ? ShieldCheck
          : ShieldX;
    return <Icon className="size-4" />;
  }
  const Icon = STEP_ICON[item.kind] ?? Sparkles;
  return <Icon className="size-4" />;
}

/**
 * The pill beside a row's label: what it acted on, what it came to ("95 lines") when the agent
 * says, and +N/−N for an edit.
 */
function itemDetail(item: TurnItem): ReactNode {
  const outcome = item.status === "failed" ? undefined : item.outcome;
  const text = item.detail && outcome ? `${item.detail} · ${outcome}` : (item.detail ?? outcome);
  const counts = item.status !== "failed" && (item.additions || item.deletions);
  if (!text && !counts) return undefined;
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-2",
        item.status === "failed" ? "text-danger" : "text-[color:var(--text-secondary)]",
      )}
      title={item.reason ?? text}
    >
      {text ? (
        <span
          className={cn(
            "min-w-0 truncate",
            (item.kind === "plan" || item.kind === "message") && "font-sans",
          )}
        >
          {text}
        </span>
      ) : null}
      {counts ? (
        <span className="ml-auto flex shrink-0 items-center gap-1.5 tabular-nums">
          {item.additions ? (
            <span className="text-emerald-700 dark:text-emerald-400">+{item.additions}</span>
          ) : null}
          {item.deletions ? (
            <span className="text-rose-600 dark:text-rose-400">−{item.deletions}</span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/** One row for beUI's activity list. `running` is a call still waiting for its result. */
function beuiItem(item: TurnItem, running: boolean): AgentActivityItem {
  if (item.kind === "output") {
    return {
      id: item.id,
      type: "text",
      content: (
        <span className="block font-mono text-xs [overflow-wrap:anywhere]">{item.label}</span>
      ),
    };
  }
  const failed = item.status === "failed";
  return {
    id: item.id,
    type: "trace",
    kind: item.kind,
    icon: itemIcon(item, running),
    label: (
      <span
        className={cn(
          "[overflow-wrap:anywhere]",
          failed && "text-danger",
          running && "text-muted-foreground",
        )}
        title={failed ? item.reason : undefined}
        // Lets the turn find this row to bring it into view.
        data-step-failed={failed ? "" : undefined}
      >
        {running && item.activeLabel ? item.activeLabel : item.label}
      </span>
    ),
    detail: itemDetail(item),
  };
}

/** "Edited 1 file · ran 2 commands", with a failed step called out in red. */
function TurnSummary({ parts }: { parts: SummaryPart[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={part.text}>
          {index > 0 ? " · " : null}
          {part.bad ? (
            <span className="inline-flex items-center gap-1 text-danger">
              <CircleAlert aria-hidden className="size-3.5" />
              {part.text}
            </span>
          ) : (
            part.text
          )}
        </Fragment>
      ))}
    </>
  );
}

/** The nearest ancestor that scrolls, which is the Activity pane. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * If an activity list has its own scrolling viewport, bring the failed step into view.
 */
function revealFailedStep(root: HTMLElement | null) {
  const row = root?.querySelector<HTMLElement>("[data-step-failed]");
  if (!root || !row) return;
  let viewport: HTMLElement | null = null;
  for (let node = row.parentElement; node && node !== root; node = node.parentElement) {
    if (getComputedStyle(node).overflowY === "auto") {
      viewport = node;
      break;
    }
  }
  // Not capped: every row is already in view.
  if (!viewport) return;
  const box = viewport.getBoundingClientRect();
  const at = row.getBoundingClientRect();
  if (at.top >= box.top && at.bottom <= box.bottom) return;
  viewport.scrollTo({
    top: viewport.scrollTop + (at.top - box.top) - (box.height - at.height) / 2,
  });
}

/** One turn: a disclosure that stays open while it holds a failed step. */
function TurnBlock({
  group,
  working,
  activity,
}: {
  group: TurnGroup;
  working: boolean;
  activity: string;
}) {
  // A failed step keeps its turn open so a problem is never hidden behind a summary.
  const [open, setOpen] = useState(group.failed > 0);
  const rootRef = useRef<HTMLDivElement>(null);
  const items = useMemo(
    () => group.items.map((item) => beuiItem(item, working && item.status === "pending")),
    [group.items, working],
  );
  const failedId = group.items.find((item) => item.status === "failed")?.id;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !open || working || !failedId) return;
    let frame = 0;
    // Wait until the disclosure has opened and its contents have been sized.
    const reveal = () => {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => revealFailedStep(root));
      });
    };
    // The Activity pane stays mounted while another tab shows, so it can open hidden. Reveal
    // again each time it is shown.
    const shown = () => root.getClientRects().length > 0;
    let visible = shown();
    if (visible) reveal();
    const observer = new ResizeObserver(() => {
      const now = shown();
      if (now && !visible) reveal();
      visible = now;
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [open, working, failedId]);

  return (
    <div ref={rootRef}>
      <AgentActivity
        items={items}
        status={working ? "working" : "complete"}
        activeLabel={working ? `${activity}…` : undefined}
        summary={<TurnSummary parts={group.summary.parts} />}
        open={open}
        onOpenChange={setOpen}
        collapseOnComplete={group.failed === 0}
        maxHeight={null}
      />
    </div>
  );
}

/**
 * The agent's log as one collapsible block per turn. The newest turn shows what the agent is
 * doing while `live` (`activity` names it; by default it is read from the log); finished turns
 * fold into a plain summary, except one with a failed step.
 */
export function ActivityLogs({
  lines,
  live,
  activity,
}: {
  lines: string[];
  live: boolean;
  activity?: string;
}) {
  // ADE keeps the last 500 lines, so once the log is full every new line shifts every index.
  // Count what was dropped from the front so rows and turns keep their ids (and open state).
  // A new array with the same lines (the parent rebuilds it on any update) changes nothing, so
  // it keeps the old one and the log is not read again.
  const [tracked, setTracked] = useState({ lines, offset: 0 });
  let current = tracked.lines;
  let lineOffset = tracked.offset;
  if (lines !== tracked.lines) {
    const dropped = trimmedFromFront(tracked.lines, lines);
    if (dropped || lines.length !== tracked.lines.length) {
      current = lines;
      lineOffset += dropped;
      setTracked({ lines, offset: lineOffset });
    }
  }

  const rootRef = useRef<HTMLDivElement>(null);
  // Gate formatting on a real box (Tailwind `hidden` → no client rects). Default false so a
  // column that mounts already hidden does not format; useLayoutEffect flips true before paint
  // when rects already exist (open assistant drawer / Activity tab).
  const [hasBox, setHasBox] = useState(false);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => root.getClientRects().length > 0;
    setHasBox(measure());
    const observer = new ResizeObserver(() => setHasBox(measure()));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // Last formatted tree while the column has no box. Logs keep updating via `tracked` so the
  // transcript status line and computer line count still see fresh lines; only format is frozen.
  const freezeRef = useRef<{
    current: string[];
    groups: TurnGroup[];
    status: string;
  } | null>(null);

  const formatted = useMemo(() => {
    if (!hasBox) {
      return (
        freezeRef.current ?? { current: [] as string[], groups: [] as TurnGroup[], status: "" }
      );
    }
    const rows = formatSessionLogs(current);
    const groups = groupActivityTurns(rows, lineOffset);
    const status = live ? (activity ?? currentActivity(current)) : "";
    const next = { current, groups, status };
    freezeRef.current = next;
    return next;
  }, [hasBox, current, lineOffset, live, activity]);

  const groups = formatted.groups;
  const status = formatted.status;
  const displayLines = formatted.current;
  const scrollerRef = useRef<HTMLElement | null>(null);
  // Follow new events only while the reader is already near the bottom.
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const scroller = scrollParent(rootRef.current);
    scrollerRef.current = scroller;
    if (!scroller) return;
    const onScroll = () => {
      stickToBottomRef.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  // Keyed on the formatted log: frozen while hidden, so scroll work waits for a box too.
  useEffect(() => {
    if (!stickToBottomRef.current) return undefined;
    return scrollToEnd(scrollerRef.current);
  }, [displayLines]);

  // A turn with nothing to show is left out, unless it is the live one (it says what is next).
  const lastIndex = groups.length - 1;
  const visibleGroups = groups.filter(
    (group, index) => group.items.length || (live && index === lastIndex),
  );

  let content: ReactNode;
  if (!displayLines.length) {
    content = <p className="text-ui text-dim">No CLI output yet.</p>;
  } else if (!visibleGroups.length) {
    content = <p className="text-ui text-dim">No activity events yet.</p>;
  } else {
    content = (
      <div className="space-y-1.5">
        {visibleGroups.map((group) => (
          <TurnBlock
            key={group.id}
            group={group}
            working={live && group === groups[lastIndex]}
            activity={status}
          />
        ))}
      </div>
    );
  }

  return <div ref={rootRef}>{content}</div>;
}
