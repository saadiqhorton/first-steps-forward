import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, Eye, Lock, MessageSquare, RotateCcw, Trash2, Undo2 } from "lucide-react";
import {
  AMBER_TEXT,
  keepChange,
  rerunChecks,
  runningWithoutChanges,
  undoChange,
  updateRowFor,
  useCustomizeAction,
  type Change,
  type CustomizeState,
} from "@/lib/ade/customizeApi";
import { timeAgo, useNow } from "@/lib/ade/store";
import { keepBlockedReason } from "./customizeText";
import { RemoveConfirm } from "./KeptList";
import { canTry, usePreviewAction } from "./PreviewPanel";
import { StockNotice, SwitchCard } from "./SwitchCard";
import { NeedsYouCard } from "./UpdateNotice";

/** Phones get thumb-sized, equal buttons; the wide layout keeps them compact. */
const BUTTON =
  "inline-flex min-h-[var(--control-height-md)] min-w-0 items-center justify-center gap-1.5 px-3 text-xs @lg:min-h-0 @lg:py-1.5";

/** The one line that says where the change stands next to its buttons. */
function StatusLine({ text, tone }: { text: string; tone: "quiet" | "danger" | "attention" }) {
  const color = tone === "danger" ? "text-danger" : tone === "attention" ? AMBER_TEXT : "text-dim";
  const dot = tone === "danger" ? "bg-danger" : tone === "attention" ? "bg-amber" : "bg-dim";
  return (
    <p className={`flex min-w-0 items-center gap-2 text-xs leading-5 ${color}`} role="status">
      <span className={`size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      <span className="min-w-0">{text}</span>
    </p>
  );
}

/** A kept change: where the switch stands, and Remove behind a quiet button. */
function KeptCard({ change, state }: { change: Change; state: CustomizeState }) {
  const [confirm, setConfirm] = useState(false);
  if (confirm)
    return (
      <RemoveConfirm
        change={change}
        onCancel={() => setConfirm(false)}
        onDone={() => setConfirm(false)}
      />
    );
  const updateRow = updateRowFor(state, change.id);
  return (
    <div className="space-y-3">
      {updateRow?.status === "needs-you" && state.update && (
        <NeedsYouCard change={updateRow} update={state.update} framed />
      )}
      {runningWithoutChanges(state) && <StockNotice flag={state.current.withoutChanges} compact />}
      <div className="flex flex-col gap-2 @lg:flex-row @lg:items-start @lg:gap-3">
        <div className="min-w-0 flex-1">
          <SwitchCard state={state} kept />
        </div>
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className={`btn-quiet shrink-0 text-dim hover:text-ink ${BUTTON}`}
        >
          <Trash2 className="size-3.5" strokeWidth={1.5} aria-hidden />
          Remove from my ADE
        </button>
      </div>
    </div>
  );
}

export function ChangeActions({
  change,
  state,
  onTry,
  onAskAgain,
}: {
  change: Change;
  state: CustomizeState;
  onTry: () => void;
  /** Failed checks: put a request for another fix in the composer. */
  onAskAgain: () => void;
}) {
  const navigate = useNavigate();
  const now = useNow();
  const [confirm, setConfirm] = useState(false);
  const keep = useCustomizeAction((id: string) => keepChange(id));
  const undo = useCustomizeAction((id: string) => undoChange(id));
  const preview = usePreviewAction();
  const rerun = useCustomizeAction((id: string) => rerunChecks(id));
  const blocked = keepBlockedReason(change);
  const previewStarting = change.preview.status === "starting";
  const previewOn = change.preview.status === "running";
  const tryIt = () => {
    onTry();
    if (!previewOn) preview.mutate({ id: change.id, action: "start" });
  };
  const error = [keep.error, undo.error, preview.error, rerun.error].find(
    (e) => e instanceof Error,
  ) as Error | undefined;

  if (change.status === "removed") return null;
  if (change.status === "kept") return <KeptCard change={change} state={state} />;

  if (confirm)
    return (
      <div className="rounded-md border border-line bg-surface-muted px-3 py-3" role="group">
        <p className="text-ui text-ink">Undo “{change.title}”?</p>
        <p className="mt-1 text-xs leading-5 text-[color:var(--text-secondary)]">
          {change.status === "working"
            ? "The agent stops and its work on this change is thrown away. Your ADE stays as it is."
            : "The agent's work on this change is thrown away. Your ADE stays as it is."}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={undo.isPending}
            onClick={() =>
              undo.mutate(change.id, {
                onSuccess: () => void navigate({ to: "/workspace/customize" }),
              })
            }
            className={`btn-quiet font-medium text-danger ${BUTTON}`}
          >
            {undo.isPending ? "Undoing…" : "Undo change"}
          </button>
          <button type="button" onClick={() => setConfirm(false)} className={`btn-quiet ${BUTTON}`}>
            Cancel
          </button>
        </div>
        {undo.error instanceof Error && (
          <p className="mt-2 text-xs text-danger" role="alert">
            {undo.error.message}
          </p>
        )}
      </div>
    );

  const failed = change.status === "failed";
  const tried = Date.parse(change.triedAt ?? "");
  const status: { text: string; tone: "quiet" | "danger" | "attention" } | null = blocked
    ? {
        text: blocked,
        tone: failed ? "danger" : change.status === "needs-you" ? "attention" : "quiet",
      }
    : change.status === "ready"
      ? Number.isFinite(tried)
        ? { text: `Ready · tried ${timeAgo(now, tried) || "earlier"}`, tone: "quiet" }
        : { text: "Not tried yet", tone: "quiet" }
      : null;

  const keepButton = (
    <button
      type="button"
      disabled={!!blocked || keep.isPending}
      title={blocked ?? "Add this change to your ADE"}
      onClick={() => keep.mutate(change.id)}
      className={`${blocked ? "btn-quiet text-dim" : "btn-amber font-medium"} ${BUTTON} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {blocked ? (
        <Lock className="size-3.5" strokeWidth={1.5} aria-hidden />
      ) : (
        <Check className="size-3.5" strokeWidth={1.5} aria-hidden />
      )}
      {keep.isPending ? "Keeping…" : "Keep it"}
      {blocked && <span className="sr-only">: {blocked}</span>}
    </button>
  );

  return (
    <div className="flex flex-col gap-2 @lg:flex-row @lg:items-center @lg:gap-3">
      <div className="grid grid-cols-3 gap-2 @lg:flex @lg:shrink-0 @lg:items-center">
        {failed ? (
          <button
            type="button"
            onClick={onAskAgain}
            className={`btn-amber font-medium ${BUTTON}`}
            title="Ask the agent to try again"
          >
            <MessageSquare className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
            <span className="truncate @lg:hidden">Ask again</span>
            <span className="hidden @lg:inline">Ask the agent to try again</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={!canTry(change) || preview.isPending || previewStarting}
            title={
              previewStarting
                ? "The preview is starting"
                : previewOn
                  ? "Expand the running preview"
                  : canTry(change)
                    ? "Run this change in a separate ADE with a sample project"
                    : "You can try it when the agent and the checks finish"
            }
            onClick={tryIt}
            className={`btn-quiet ${BUTTON}`}
          >
            <Eye className="size-3.5" strokeWidth={1.5} aria-hidden />
            {previewStarting ? "Starting…" : previewOn ? "Expand preview" : "Try it"}
          </button>
        )}
        {failed ? (
          <>
            <button
              type="button"
              onClick={() => rerun.mutate(change.id)}
              disabled={rerun.isPending}
              title="Run every check again on the change as it is"
              className={`btn-quiet ${BUTTON}`}
            >
              <RotateCcw className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
              <span className="truncate @lg:hidden">Check again</span>
              <span className="hidden @lg:inline">
                {rerun.isPending ? "Starting checks…" : "Run checks again"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className={`btn-quiet ${BUTTON}`}
            >
              <Undo2 className="size-3.5" strokeWidth={1.5} aria-hidden />
              Undo
            </button>
            {/* Locked while a check fails; phones say so in the status line instead. */}
            <span className="hidden @lg:contents">{keepButton}</span>
          </>
        ) : (
          <>
            {keepButton}
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className={`btn-quiet ${BUTTON}`}
            >
              <Undo2 className="size-3.5" strokeWidth={1.5} aria-hidden />
              Undo
            </button>
          </>
        )}
      </div>
      {status && (
        <div className="order-first min-w-0 @lg:order-none @lg:border-l @lg:border-line @lg:pl-3">
          <StatusLine text={status.text} tone={status.tone} />
        </div>
      )}
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}
