import type { SessionStatus } from "@/lib/ade/types";

const MAP: Record<SessionStatus, { label: string; cls: string; dot: string; pulse?: boolean; glyph: string }> = {
  working: { label: "Working", cls: "text-teal", dot: "bg-teal", pulse: true, glyph: "◐" },
  verifying: { label: "Verifying", cls: "text-teal", dot: "bg-teal", pulse: true, glyph: "◎" },
  needs_input: { label: "Needs you", cls: "text-amber-deep", dot: "bg-amber", glyph: "?" },
  awaiting_approval: { label: "Needs your approval", cls: "text-amber-deep", dot: "bg-amber", glyph: "!" },
  ready: { label: "Ready to review", cls: "text-teal-deep", dot: "bg-teal", glyph: "✓" },
  complete: { label: "Complete", cls: "text-dim", dot: "bg-teal", glyph: "✓" },
  stopped: { label: "Stopped", cls: "text-dim", dot: "bg-dim", glyph: "■" },
  blocked: { label: "Blocked", cls: "text-danger", dot: "bg-danger", glyph: "×" },
};

export function StatusPill({ status, size = "sm" }: { status: SessionStatus; size?: "sm" | "md" }) {
  const m = MAP[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold ${m.cls} ${size === "md" ? "text-[13px]" : "text-[11px]"}`}
      role="status"
    >
      <span className={`size-1.5 rounded-full ${m.dot} ${m.pulse ? "animate-pulse-soft" : ""}`} aria-hidden />
      <span className="font-mono text-[10px] opacity-70" aria-hidden>{m.glyph}</span>
      {m.label}
    </span>
  );
}

export function statusLabel(s: SessionStatus) {
  return MAP[s].label;
}
