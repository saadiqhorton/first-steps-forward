import { useState } from "react";
import type { FileChange } from "@/lib/ade/types";

export function DiffView({
  changes,
  unavailable = false,
}: {
  changes: FileChange[];
  unavailable?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (unavailable)
    return <p className="text-[12px] text-dim">Changes unavailable for this earlier task.</p>;
  if (!changes.length) return <p className="text-[12px] text-dim">No files changed yet.</p>;
  const added = changes.reduce((n, c) => n + c.added, 0);
  const removed = changes.reduce((n, c) => n + c.removed, 0);
  return (
    <div>
      <div className="mb-2 font-mono text-[11px] text-dim">
        {changes.length} file{changes.length === 1 ? "" : "s"} ·{" "}
        <span className="text-teal">+{added}</span> /{" "}
        <span className="text-danger">−{removed}</span>
      </div>
      <ul className="card-panel divide-y divide-line overflow-hidden">
        {changes.map((c) => {
          const isOpen = open === c.path;
          return (
            <li key={c.path}>
              <button
                onClick={() => setOpen(isOpen ? null : c.path)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-ink/[0.03]"
              >
                <span className="font-mono text-[10px] text-dim" aria-hidden>
                  {isOpen ? "▾" : "▸"}
                </span>
                <span className="flex-1 truncate font-mono text-[12px]">
                  {c.path}
                  {c.preExisting && (
                    <span
                      className="ml-2 rounded bg-amber/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-amber-deep"
                      title="Already dirty before the agent ran — your uncommitted work"
                    >
                      yours
                    </span>
                  )}
                </span>
                <span className="font-mono text-[10px]">
                  <span className="text-teal">+{c.added}</span>{" "}
                  <span className="text-danger">−{c.removed}</span>
                </span>
              </button>
              {isOpen && (
                <pre className="overflow-x-auto bg-ink px-4 py-3 font-mono text-[11.5px] leading-relaxed text-paper">
                  {c.hunk.map((l, i) => (
                    <div
                      key={i}
                      className={
                        l.startsWith("+")
                          ? "bg-teal/30"
                          : l.startsWith("-")
                            ? "bg-danger/30"
                            : l.startsWith("@@")
                              ? "text-amber"
                              : "text-paper/70"
                      }
                    >
                      {l}
                    </div>
                  ))}
                </pre>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
