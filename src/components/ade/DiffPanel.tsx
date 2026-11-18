import { DiffView } from "@/components/ade/DiffView";
import type { Session } from "@/lib/ade/types";

export function DiffPanel({ session }: { session: Session }) {
  const filesLabel = session.changeCountUnavailable
    ? "Files changed"
    : `Files changed (${session.changes?.length ?? 0})`;

  return (
    <aside
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-panel"
      aria-label="Diff"
    >
      <div className="space-y-6 px-4 py-4">
        <section>
          <h2 className="label-mono">{filesLabel}</h2>
          <div className="mt-2">
            <DiffView
              changes={session.changes ?? []}
              unavailable={!!session.changeCountUnavailable}
            />
          </div>
        </section>
      </div>
    </aside>
  );
}
