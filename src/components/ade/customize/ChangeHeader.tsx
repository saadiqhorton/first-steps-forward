import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { TONE_CLASS, STATUS_META, type Change, type CustomizeState } from "@/lib/ade/customizeApi";
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
  const kept = change.status === "kept" && !state.current.stock && state.switch.status === "idle";
  const started = Date.parse(change.createdAt);
  return (
    <header className="shrink-0 border-b border-line px-4 pt-5 pb-4 @lg:px-7">
      <div className="mx-auto w-full max-w-3xl">
        <Breadcrumb
          right={`started ${timeAgo(now, Number.isFinite(started) ? started : undefined) || "earlier"} · ${agent?.short ?? change.agentId}`}
        />
        <div className="mt-2 flex min-w-0 items-center gap-3">
          <h1 className="min-w-0 truncate text-lg font-medium leading-snug" title={change.request}>
            {change.title}
          </h1>
          <ChangeStatusLabel status={change.status} />
          {actions ? <div className="ml-auto shrink-0">{actions}</div> : null}
        </div>
        <p
          className={`mt-2 flex min-w-0 items-center gap-2 text-xs ${kept ? "text-teal-deep" : tone.text}`}
        >
          <span
            className={`size-1.5 shrink-0 rounded-full ${kept ? "bg-teal" : tone.dot}`}
            aria-hidden
          />
          <span className="min-w-0 truncate">{changeDetail(change, state)}</span>
        </p>
      </div>
    </header>
  );
}
