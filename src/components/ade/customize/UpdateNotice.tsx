import type { CustomizeUpdate } from "@/lib/ade/customizeApi";

const LATER = "Arrives in a later round";

/** ADE updated and re-applied kept changes; one could not carry over. */
export function UpdateNotice({ update }: { update: CustomizeUpdate | null }) {
  if (!update || update.status === "done") return null;
  if (update.status === "applying") {
    const applied = update.changes.filter((c) => c.status === "applied").length;
    return (
      <div className="flex items-center gap-3 rounded-md border border-line bg-surface-muted px-4 py-3 text-ui">
        <span className="size-1.5 shrink-0 animate-pulse-soft rounded-full bg-teal" aria-hidden />
        <span className="min-w-0">
          Carrying your changes over to ADE {update.to} · {applied} of {update.changes.length} done
        </span>
      </div>
    );
  }
  const stuck = update.changes.filter((c) => c.status === "needs-you");
  const name = stuck.length === 1 ? `“${stuck[0]!.title}”` : `${stuck.length} of your changes`;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border border-line border-l-2 border-l-amber bg-surface-muted px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <p className="text-ui font-medium text-ink">
          {name} can't carry over to {update.to}
        </p>
        <p className="mt-0.5 text-xs text-[color:var(--text-secondary)]">
          ADE changed the part it used. Choose what to do. Nothing changes until you do.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled title={LATER} className="btn-amber px-3 py-1.5 text-xs">
          Let the agent try again
        </button>
        <button type="button" disabled title={LATER} className="btn-quiet px-3 py-1.5 text-xs">
          Update without it
        </button>
        <button type="button" disabled title={LATER} className="btn-quiet px-3 py-1.5 text-xs">
          Stay on {update.from}
        </button>
      </div>
    </div>
  );
}
