import { useState } from "react";
import { Check, ChevronDown, LoaderCircle, Minus } from "lucide-react";
import {
  AMBER_TEXT,
  CustomizeRequestError,
  retryUpdateChange,
  skipUpdateChange,
  stayOnVersion,
  useCustomizeAction,
  type CustomizeState,
  type CustomizeUpdate,
  type UpdateChangeStatus,
} from "@/lib/ade/customizeApi";
import { SwitchCard } from "./SwitchCard";

type UpdateChange = CustomizeUpdate["changes"][number];

const ROW: Record<UpdateChangeStatus, { label: string; text: string }> = {
  applied: { label: "Carried over", text: "text-teal-deep" },
  applying: { label: "Carrying over", text: "text-teal" },
  "needs-you": { label: "Needs you", text: AMBER_TEXT },
  dropped: { label: "Left out", text: "text-dim" },
};

function RowMark({ status }: { status: UpdateChangeStatus }) {
  if (status === "applied")
    return <Check className="size-4 shrink-0 text-teal" strokeWidth={1.5} aria-hidden />;
  if (status === "applying")
    return (
      <LoaderCircle
        className="size-4 shrink-0 animate-spin text-teal"
        strokeWidth={1.5}
        aria-hidden
      />
    );
  if (status === "dropped")
    return <Minus className="size-4 shrink-0 text-dim" strokeWidth={1.5} aria-hidden />;
  return (
    <span className="grid size-4 shrink-0 place-items-center" aria-hidden>
      <span className="size-1.5 rounded-full bg-amber" />
    </span>
  );
}

/** One choice for the update; a local service without the route says so instead of failing. */
function useUpdateAction<T>(fn: (arg: T) => Promise<unknown>) {
  const action = useCustomizeAction(fn);
  const missing = action.error instanceof CustomizeRequestError && action.error.missing;
  const error = !missing && action.error instanceof Error ? action.error.message : null;
  return { action, missing, error };
}

const NOT_HERE = "This ADE can't do that yet. Update ADE's local service and try again.";

/**
 * A kept change that did not fit the new version, and the three ways forward. Without a change
 * the update stopped as a whole, and staying is the one choice. Inside the update notice it is a
 * plain section; on its own (a kept change's page) `framed` gives it the card edge.
 */
export function NeedsYouCard({
  change,
  update,
  framed = false,
}: {
  change?: UpdateChange | undefined;
  update: CustomizeUpdate;
  framed?: boolean;
}) {
  const retry = useUpdateAction(retryUpdateChange);
  const skip = useUpdateAction(skipUpdateChange);
  const stay = useUpdateAction(stayOnVersion);
  const [asked, setAsked] = useState<"retry" | "skip" | "stay" | null>(null);
  const busy = retry.action.isPending || skip.action.isPending || stay.action.isPending;
  const error = retry.error ?? skip.error ?? stay.error;
  const missing = retry.missing || skip.missing || stay.missing;
  return (
    <div
      className={
        framed
          ? "rounded-md border border-line border-l-2 border-l-amber bg-surface-muted px-4 py-3"
          : "border-t border-line px-4 py-3"
      }
    >
      <p className="text-ui font-medium text-ink">
        {change
          ? `“${change.title}” doesn't fit ${update.to}.`
          : `Your changes couldn't move to ${update.to}.`}
      </p>
      <p className="mt-1 text-xs leading-5 break-words text-[color:var(--text-secondary)]">
        {change?.reason ??
          update.reason ??
          (change
            ? `ADE ${update.to} changed a part this change uses.`
            : "The update stopped before it finished.")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {change && (
          <>
            <button
              type="button"
              disabled={busy || missing}
              title={missing ? NOT_HERE : "The agent re-applies this change to ADE " + update.to}
              onClick={() => {
                setAsked("retry");
                if (change) retry.action.mutate(change.id);
              }}
              className="btn-amber inline-flex min-h-[var(--control-height-md)] items-center gap-1.5 px-3 text-xs @lg:min-h-0 @lg:py-1.5"
            >
              {asked === "retry" && retry.action.isPending
                ? "Asking the agent…"
                : "Let the agent try again"}
            </button>
            <button
              type="button"
              disabled={busy || missing}
              title={
                missing
                  ? NOT_HERE
                  : `Move to ${update.to} and leave this change out. You can rebuild it later.`
              }
              onClick={() => {
                setAsked("skip");
                if (change) skip.action.mutate(change.id);
              }}
              className="btn-quiet inline-flex min-h-[var(--control-height-md)] items-center px-3 text-xs @lg:min-h-0 @lg:py-1.5"
            >
              Update without it
            </button>
          </>
        )}
        <button
          type="button"
          disabled={busy || missing}
          title={missing ? NOT_HERE : `Keep ADE ${update.from} with all your changes`}
          onClick={() => {
            setAsked("stay");
            stay.action.mutate(undefined);
          }}
          className="btn-quiet inline-flex min-h-[var(--control-height-md)] items-center px-3 text-xs @lg:min-h-0 @lg:py-1.5"
        >
          Stay on {update.from}
        </button>
      </div>
      {missing && <p className="mt-2 text-xs text-dim">{NOT_HERE}</p>}
      {error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function overallMark(update: CustomizeUpdate): UpdateChangeStatus {
  if (update.status === "done") return "applied";
  if (update.status === "needs-you") return "needs-you";
  return "applying";
}

/**
 * ADE has a new version and carries kept changes over to it, one by one. Nothing changes for the
 * user until it finishes; a change that does not fit waits for their choice. One line says where
 * the update stands; each change's progress sits behind Details, and only a choice stays open.
 */
export function UpdateNotice({ state }: { state: CustomizeState }) {
  const [open, setOpen] = useState(false);
  const update = state.update;
  if (!update) return null;
  const done = update.status === "done";
  // Finished and restarted (or nothing to restart into): nothing left to say.
  if (done && state.switch.status === "idle") return null;
  const total = update.changes.length;
  const carried = update.changes.filter((c) => c.status === "applied").length;
  const needsYou = update.status === "needs-you";
  const waiting = update.changes.filter((c) => c.status === "needs-you");
  const count = total === 1 ? "1 change" : `${total} changes`;
  const summary = done
    ? `${carried} of ${count} carried over`
    : total
      ? `carrying ${count} over`
      : "getting it ready";
  return (
    <section
      aria-label={`ADE ${update.to}`}
      role={needsYou ? "alert" : "status"}
      className={`overflow-hidden rounded-md border border-line bg-surface-muted ${needsYou ? "border-l-2 border-l-amber" : ""}`}
    >
      <div className="flex min-h-10 items-center gap-3 px-4 py-2">
        <RowMark status={overallMark(update)} />
        <p className="min-w-0 flex-1 truncate text-ui text-ink">
          {done ? `On ADE ${update.to}` : `ADE ${update.to} is out`}
          <span className="text-[color:var(--text-secondary)]"> · {summary}</span>
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-dim transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
        >
          Details
          <ChevronDown
            className={`size-3.5 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
            strokeWidth={1.5}
            aria-hidden
          />
        </button>
      </div>
      {open && (
        <div className="border-t border-line px-4 py-2">
          <p className="text-xs leading-5 text-[color:var(--text-secondary)]">
            {done
              ? `Restart ADE to start using ${update.to}.`
              : `You're still on ${update.from} with your changes until this finishes.`}
          </p>
          {total > 0 && (
            <ul className="mt-1 divide-y divide-line">
              {update.changes.map((change) => (
                <li key={change.id} className="flex items-center gap-3 py-1.5">
                  <RowMark status={change.status} />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">{change.title}</span>
                  <span className={`shrink-0 text-xs ${ROW[change.status].text}`}>
                    {ROW[change.status].label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {waiting.map((change) => (
        <NeedsYouCard key={change.id} change={change} update={update} />
      ))}
      {needsYou && !waiting.length && <NeedsYouCard update={update} />}
      {done && (
        <div className="border-t border-line px-4 py-3">
          <SwitchCard
            state={state}
            title={`Ready on ADE ${update.to}. Restart ADE to start using it.`}
          />
        </div>
      )}
    </section>
  );
}
