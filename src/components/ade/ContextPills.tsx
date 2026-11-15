import { File, Folder, Sparkles, Workflow, X } from "lucide-react";
import type { ContextReference } from "@/lib/ade/types";

export function ContextPills({
  items,
  onRemove,
  disabled = false,
}: {
  items: ContextReference[];
  onRemove?: (index: number) => void;
  disabled?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item, index) => {
        const Icon =
          item.kind === "workflow"
            ? Workflow
            : item.kind === "skill"
              ? Sparkles
              : item.kind === "folder"
                ? Folder
                : File;
        return (
          <span
            key={`${item.kind}:${item.detail}:${index}`}
            title={item.detail || item.label}
            className="inline-flex max-w-full items-center gap-2 rounded-full bg-surface-muted py-1 pr-1 pl-3 text-xs text-ink ring-1 ring-line"
          >
            <Icon className="size-4 shrink-0 text-dim" strokeWidth={1.5} aria-hidden />
            <span className="min-w-0 truncate font-medium">{item.label}</span>
            <span className="hidden shrink-0 capitalize text-dim @[18rem]/composer:inline">
              {item.kind}
            </span>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(index)}
                disabled={disabled}
                aria-label={`Remove ${item.label} ${item.kind}`}
                className="grid size-6 shrink-0 place-items-center rounded-full text-dim transition-colors hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber/40 disabled:opacity-60"
              >
                <X className="size-4" strokeWidth={1.5} aria-hidden />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
