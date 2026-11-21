import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  runningWithoutChanges,
  TONE_CLASS,
  STATUS_META,
  type Change,
  type CustomizeState,
} from "@/lib/ade/customizeApi";
import { timeAgo, useAdeState, useNow } from "@/lib/ade/store";
import { ChangeStatusLabel } from "./ChangeStatusLabel";
import { changeDetail } from "./customizeText";

export function Breadcrumb({ right }: { right?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Link to="/workspace" className="label-mono hover:text-ink">
        Workspace
      </Link>
      <span className="label-mono">/ customize</span>
      {right ? <span className="label-mono ml-auto truncate">{right}</span> : null}
    </div>
  );
}

export function ChangeHeader({
  change,
  state,
  actions,
}: {
  change: Change;
  state: CustomizeState;
  actions?: ReactNode;
}) {
  const now = useNow();
  const agents = useAdeState((s) => s.agents);
  const agent = agents.find((a) => a.id === change.agentId);
  const tone = TONE_CLASS[STATUS_META[change.status].tone];
  // A kept change's line follows the switch: amber until ADE runs it, red if it didn't start.
  const keptTone =
    change.status !== "kept"
      ? null
      : state.switch.status === "failed"
        ? { text: "text-danger", dot: "bg-danger" }
        : state.switch.status !== "idle"
          ? {
              text: "text-amber-deep",
              dot: `bg-amber ${state.switch.status === "pending" ? "" : "animate-pulse-soft"}`,
            }
          : runningWithoutChanges(state)
            ? { text: "text-dim", dot: "bg-dim" }
            : { text: "text-teal-deep", dot: "bg-teal" };
  const line = keptTone ?? tone;
  const started = Date.parse(change.createdAt);
  return (
    <header className="shrink-0 border-b border-line px-4 pt-5 pb-4 @lg:px-7">
      <div className="mx-auto w-full max-w-3xl">
        <Breadcrumb
          right={`started ${timeAgo(now, Number.isFinite(started) ? started : undefined) || "earlier"} · ${agent?.short ?? change.agentId}`}
        />
        <div className="mt-2 flex min-w-0 items-start gap-3">
          <h1
            className="line-clamp-2 min-w-0 text-lg font-medium leading-snug break-words"
            title={change.request}
          >
            {change.title}
          </h1>
          <span className="mt-1 hidden shrink-0 @lg:inline-flex">
            <ChangeStatusLabel status={change.status} />
          </span>
          {actions ? <div className="ml-auto shrink-0">{actions}</div> : null}
        </div>
        <p className={`mt-2 flex min-w-0 items-center gap-2 text-xs ${line.text}`}>
          <span className={`size-1.5 shrink-0 rounded-full ${line.dot}`} aria-hidden />
          <span className="min-w-0 truncate">{changeDetail(change, state)}</span>
        </p>
      </div>
    </header>
  );
}
