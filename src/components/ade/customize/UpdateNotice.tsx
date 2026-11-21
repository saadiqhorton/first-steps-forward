import { useState } from "react";
import { Check, LoaderCircle, Minus } from "lucide-react";
import {
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

const changesWord = (n: number) => (n === 1 ? "your change" : `your ${n} changes`);

const ROW: Record<UpdateChangeStatus, { label: string; text: string }> = {
  applied: { label: "Carried over", text: "text-teal-deep" },
  applying: { label: "Carrying over", text: "text-teal" },
  "needs-you": { label: "Needs you", text: "text-amber-deep" },
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
 * the update stopped as a whole, and staying is the one choice.
 */
function NeedsYouCard({ change, update }: { change?: UpdateChange; update: CustomizeUpdate }) {
  const retry = useUpdateAction(retryUpdateChange);
  const skip = useUpdateAction(skipUpdateChange);
  const stay = useUpdateAction(stayOnVersion);
  const [asked, setAsked] = useState<"retry" | "skip" | "stay" | null>(null);
  const busy = retry.action.isPending || skip.action.isPending || stay.action.isPending;
  const error = retry.error ?? skip.error ?? stay.error;
  const missing = retry.missing || skip.missing || stay.missing;
  return (
    <div className="mt-3 rounded-md border border-line bg-panel px-4 py-3">
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

/**
 * ADE has a new version and carries kept changes over to it, one by one. Nothing changes for the
 * user until it finishes; a change that does not fit waits for their choice.
 */
export function UpdateNotice({ state }: { state: CustomizeState }) {
  const update = state.update;
  if (!update) return null;
  const done = update.status === "done";
  // Finished and restarted (or nothing to restart into): nothing left to say.
  if (done && state.switch.status === "idle") return null;
  const total = update.changes.length;
  const carried = update.changes.filter((c) => c.status === "applied").length;
  const needsYou = update.status === "needs-you";
  return (
    <section
      aria-label={`ADE ${update.to}`}
      role={needsYou ? "alert" : "status"}
      className={`rounded-md border border-line bg-surface-muted px-4 py-3 ${needsYou ? "border-l-2 border-l-amber" : ""}`}
    >
      <p className="text-ui font-medium text-ink">
        {done
          ? `${changesWord(total).replace(/^your/, "Your")} ${total === 1 ? "is" : "are"} on ADE ${update.to}.`
          : `ADE ${update.to} is out. Carrying ${changesWord(total)} over.`}
      </p>
      <p className="mt-0.5 text-xs leading-5 text-[color:var(--text-secondary)]">
        {done
          ? `${carried} of ${total} carried over. Restart ADE to start using ${update.to}.`
          : `You're still on ${update.from} with your changes until this finishes.`}
      </p>
      {total > 0 && (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {update.changes.map((change) => (
            <li key={change.id} className="py-2">
              <div className="flex items-center gap-3">
                <RowMark status={change.status} />
                <span className="min-w-0 flex-1 truncate text-ui text-ink">{change.title}</span>
                <span className={`shrink-0 text-xs ${ROW[change.status].text}`}>
                  {ROW[change.status].label}
                </span>
              </div>
              {change.status === "needs-you" && <NeedsYouCard change={change} update={update} />}
            </li>
          ))}
        </ul>
      )}
      {needsYou && !update.changes.some((c) => c.status === "needs-you") && (
        <NeedsYouCard update={update} />
      )}
      {done && (
        <div className="mt-3">
          <SwitchCard
            state={state}
            title={`Ready on ADE ${update.to}. Restart ADE to start using it.`}
          />
        </div>
      )}
    </section>
  );
}
