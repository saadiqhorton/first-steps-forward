import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import type { SessionStatus } from "@/lib/ade/types";

const MAP: Record<SessionStatus, { label: string; cls: string; dot: string; pulse?: boolean }> = {
  working: { label: "Working", cls: "text-teal", dot: "bg-teal", pulse: true },
  verifying: { label: "Verifying", cls: "text-teal", dot: "bg-teal", pulse: true },
  ready: { label: "Ready to review", cls: "text-teal-deep", dot: "bg-teal" },
  complete: { label: "Complete", cls: "text-dim", dot: "bg-teal" },
  stopped: { label: "Stopped", cls: "text-dim", dot: "bg-dim" },
  blocked: { label: "Blocked", cls: "text-danger", dot: "bg-danger" },
};

const NEEDS_YOU = { label: "Needs you", cls: "text-amber-deep", dot: "bg-amber" };

export function StatusPill({
  status,
  size = "sm",
  needsYou = false,
}: {
  status: SessionStatus;
  size?: "sm" | "md";
  /** A running turn paused on an agent question (see `needsYou` in the store). */
  needsYou?: boolean;
}) {
  const m: (typeof MAP)[SessionStatus] = needsYou && status === "working" ? NEEDS_YOU : MAP[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium ${m.cls} ${size === "md" ? "text-ui" : "text-xs"}`}
      role="status"
    >
      <span
        className={`size-1.5 rounded-full ${m.dot} ${m.pulse ? "animate-pulse-soft" : ""}`}
        aria-hidden
      />
      <TextShimmer active={!!m.pulse}>{m.label}</TextShimmer>
    </span>
  );
}
