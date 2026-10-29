import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import type { SessionStatus } from "@/lib/ade/types";

const MAP: Record<
  SessionStatus,
  { label: string; cls: string; dot: string; pulse?: boolean; glyph: string }
> = {
  working: { label: "Working", cls: "text-teal", dot: "bg-teal", pulse: true, glyph: "◐" },
  verifying: { label: "Verifying", cls: "text-teal", dot: "bg-teal", pulse: true, glyph: "◎" },
  ready: { label: "Ready to review", cls: "text-teal-deep", dot: "bg-teal", glyph: "✓" },
  complete: { label: "Complete", cls: "text-dim", dot: "bg-teal", glyph: "✓" },
  stopped: { label: "Stopped", cls: "text-dim", dot: "bg-dim", glyph: "■" },
  blocked: { label: "Blocked", cls: "text-danger", dot: "bg-danger", glyph: "×" },
};

const NEEDS_YOU = { label: "Needs you", cls: "text-amber-deep", dot: "bg-amber", glyph: "?" };

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
      className={`inline-flex items-center gap-1.5 font-medium ${m.cls} ${size === "md" ? "text-[13px]" : "text-[11px]"}`}
      role="status"
    >
      <span
        className={`size-1.5 rounded-full ${m.dot} ${m.pulse ? "animate-pulse-soft" : ""}`}
        aria-hidden
      />
      <span className="font-mono text-[10px] opacity-70" aria-hidden>
        {m.glyph}
      </span>
      <TextShimmer active={!!m.pulse}>{m.label}</TextShimmer>
    </span>
  );
}

export function statusLabel(s: SessionStatus) {
  return MAP[s].label;
}
