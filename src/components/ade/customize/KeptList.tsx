import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  removeChange,
  useCustomizeAction,
  type Change,
  type CustomizeState,
} from "@/lib/ade/customizeApi";
import { useNow } from "@/lib/ade/store";
import { changeDate, switchNote } from "./customizeText";
import { StockHint } from "./StockHint";

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

export function KeptList({ state }: { state: CustomizeState }) {
  const now = useNow();
  const [confirming, setConfirming] = useState<string | null>(null);
  const kept = state.changes.filter((change) => change.status === "kept");
  const note = switchNote(state);
  if (!kept.length && !note) return null;

  return (
    <section aria-label="Kept changes">
      <div className="label-section">Kept in your ADE</div>
      <ul className="mt-2 space-y-2">
        {kept.map((change) =>
          confirming === change.id ? (
            <li key={change.id}>
              <RemoveConfirm
                change={change}
                onCancel={() => setConfirming(null)}
                onDone={() => setConfirming(null)}
              />
            </li>
          ) : (
            <li
              key={change.id}
              className="flex items-center gap-3 rounded-md border border-line bg-panel px-3 py-2"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-dim" aria-hidden />
              <div className="min-w-0 flex-1">
                <Link
                  to="/workspace/customize/$changeId"
                  params={{ changeId: change.id }}
                  className="block truncate text-ui text-ink hover:underline"
                >
                  {change.title}
                </Link>
                <p className="truncate text-xs text-dim">
                  Kept {changeDate(now, change.keptAt ?? change.updatedAt)} · {change.files.length}{" "}
                  file{change.files.length === 1 ? "" : "s"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirming(change.id)}
                className="btn-quiet shrink-0 px-3 py-1.5 text-xs"
              >
                Remove
              </button>
            </li>
          ),
        )}
      </ul>
      {note && <p className="mt-3 text-xs leading-5 text-amber-deep">{note}</p>}
      <div className="mt-3">
        <StockHint />
      </div>
    </section>
  );
}
