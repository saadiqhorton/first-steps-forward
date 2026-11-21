import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  removeChange,
  runningWithoutChanges,
  useCustomizeAction,
  type Change,
  type CustomizeState,
} from "@/lib/ade/customizeApi";
import { useNow } from "@/lib/ade/store";
import { CircleCheck, Trash2 } from "lucide-react";
import { changeDate } from "./customizeText";
import { StockHint } from "./StockHint";
import { StockNotice, SwitchCard } from "./SwitchCard";

export function RemoveConfirm({
  change,
  onDone,
  onCancel,
}: {
  change: Change;
  onDone?: () => void;
  onCancel: () => void;
}) {
  const remove = useCustomizeAction((id: string) => removeChange(id));
  return (
    <div className="rounded-md border border-line bg-surface-muted px-3 py-3" role="group">
      <p className="text-ui text-ink">Remove “{change.title}” from your ADE?</p>
      <p className="mt-1 text-xs leading-5 text-[color:var(--text-secondary)]">
        It is taken out of your version. You can ask for it again later.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => remove.mutate(change.id, { onSuccess: () => onDone?.() })}
          disabled={remove.isPending}
          className="btn-quiet px-3 py-1.5 text-xs font-medium text-danger"
        >
          {remove.isPending ? "Removing…" : "Remove"}
        </button>
        <button type="button" onClick={onCancel} className="btn-quiet px-3 py-1.5 text-xs">
          Cancel
        </button>
      </div>
      {remove.error instanceof Error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {remove.error.message}
        </p>
      )}
    </div>
  );
}

/** Kept changes as cards; the switch state (restart, stock) on top when `showSwitch`. */
export function KeptList({
  state,
  showSwitch = true,
  currentId,
}: {
  state: CustomizeState;
  showSwitch?: boolean;
  /** The change on screen; its row does not link to itself. */
  currentId?: string;
}) {
  const now = useNow();
  const [confirming, setConfirming] = useState<string | null>(null);
  const kept = state.changes.filter((change) => change.status === "kept");
  // After an update, the update notice owns the restart card.
  const switching = showSwitch && state.switch.status !== "idle" && state.update?.status !== "done";
  const without = runningWithoutChanges(state);
  if (!kept.length && !switching && !without) return null;

  return (
    <section aria-label="Kept changes" className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="label-section">Kept in your ADE</h2>
        {kept.length > 0 && <span className="text-xs text-dim tabular-nums">{kept.length}</span>}
      </div>
      {without && <StockNotice flag={state.current.withoutChanges} compact />}
      {switching && <SwitchCard state={state} />}
      {kept.length > 0 && (
        <ul className="card-panel divide-y divide-line overflow-hidden">
          {kept.map((change) => {
            const files = `${change.files.length} file${change.files.length === 1 ? "" : "s"}`;
            if (confirming === change.id)
              return (
                <li key={change.id} className="p-2">
                  <RemoveConfirm
                    change={change}
                    onCancel={() => setConfirming(null)}
                    onDone={() => setConfirming(null)}
                  />
                </li>
              );
            return (
              <li key={change.id} className="flex items-center gap-3 px-3 py-2.5">
                <CircleCheck
                  className={`size-4 shrink-0 ${without ? "text-dim" : "text-teal"}`}
                  strokeWidth={1.5}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  {change.id === currentId ? (
                    <p className="truncate text-ui text-ink">{change.title}</p>
                  ) : (
                    <Link
                      to="/workspace/customize/$changeId"
                      params={{ changeId: change.id }}
                      className="block truncate text-ui text-ink hover:underline"
                      title={change.request}
                    >
                      {change.title}
                    </Link>
                  )}
                  <p className="truncate text-xs text-dim tabular-nums">
                    Kept {changeDate(now, change.keptAt ?? change.updatedAt)} · {files}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirming(change.id)}
                  aria-label={`Remove “${change.title}”`}
                  className="btn-quiet inline-flex min-h-[var(--control-height-md)] shrink-0 items-center gap-1.5 px-3 text-xs text-dim hover:text-ink lg:min-h-0 lg:py-1.5"
                >
                  <Trash2 className="size-3.5" strokeWidth={1.5} aria-hidden />
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <StockHint />
    </section>
  );
}
