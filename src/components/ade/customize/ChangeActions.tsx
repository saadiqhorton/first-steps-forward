import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, Eye, Trash2, Undo2 } from "lucide-react";
import { keepChange, undoChange, useCustomizeAction, type Change } from "@/lib/ade/customizeApi";
import { keepBlockedReason } from "./customizeText";
import { RemoveConfirm } from "./KeptList";
import { canTry, usePreviewAction } from "./PreviewPanel";

export function ChangeActions({ change, onTry }: { change: Change; onTry: () => void }) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<"undo" | "remove" | null>(null);
  const keep = useCustomizeAction((id: string) => keepChange(id));
  const undo = useCustomizeAction((id: string) => undoChange(id));
  const preview = usePreviewAction();
  const blocked = keepBlockedReason(change);
  const previewOn = change.preview.status === "running" || change.preview.status === "starting";
  const tryIt = () => {
    onTry();
    if (!previewOn) preview.mutate({ id: change.id, action: "start" });
  };
  const error = [keep.error, undo.error, preview.error].find((e) => e instanceof Error) as
    Error | undefined;

  if (change.status === "removed") return null;

  if (confirm === "remove")
    return (
      <RemoveConfirm
        change={change}
        onCancel={() => setConfirm(null)}
        onDone={() => setConfirm(null)}
      />
    );

  if (confirm === "undo")
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
            className="btn-quiet px-3 py-1.5 text-xs font-medium text-danger"
          >
            {undo.isPending ? "Undoing…" : "Undo change"}
          </button>
          <button
            type="button"
            onClick={() => setConfirm(null)}
            className="btn-quiet px-3 py-1.5 text-xs"
          >
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

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {change.status !== "kept" && (
          <button
            type="button"
            disabled={!canTry(change) || preview.isPending}
            title={
              canTry(change)
                ? "Run this change in a separate ADE with test data"
                : "You can try it when the agent and the checks finish"
            }
            onClick={tryIt}
            aria-pressed={previewOn}
            className="btn-quiet inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <Eye className="size-3.5" strokeWidth={1.5} aria-hidden />
            {previewOn ? "Show preview" : "Try it"}
          </button>
        )}
        {change.status === "kept" ? (
          <button
            type="button"
            onClick={() => setConfirm("remove")}
            className="btn-quiet inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <Trash2 className="size-3.5" strokeWidth={1.5} aria-hidden />
            Remove
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={!!blocked || keep.isPending}
              title={blocked ?? "Add this change to your ADE"}
              onClick={() => keep.mutate(change.id)}
              className="btn-amber inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <Check className="size-3.5" strokeWidth={1.5} aria-hidden />
              {keep.isPending ? "Keeping…" : "Keep it"}
            </button>
            <button
              type="button"
              onClick={() => setConfirm("undo")}
              className="btn-quiet inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <Undo2 className="size-3.5" strokeWidth={1.5} aria-hidden />
              Undo
            </button>
          </>
        )}
        {blocked && change.status !== "kept" ? (
          <span className="min-w-0 text-xs text-dim">{blocked}</span>
        ) : (
          change.status === "ready" &&
          !change.triedAt && <span className="min-w-0 text-xs text-dim">Not tried yet</span>
        )}
      </div>
      {error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}
