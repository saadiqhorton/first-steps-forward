import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { STATUS_META, TONE_CLASS, type ChangeStatus } from "@/lib/ade/customizeApi";

export function ChangeStatusLabel({
  status,
  size = "sm",
}: {
  status: ChangeStatus;
  size?: "sm" | "md";
}) {
  const meta = STATUS_META[status];
  const tone = TONE_CLASS[meta.tone];
  return (
    <span
      role="status"
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap ${tone.text} ${size === "md" ? "text-ui" : "text-xs"}`}
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${tone.dot} ${tone.pulse ? "animate-pulse-soft" : ""}`}
        aria-hidden
      />
      <TextShimmer active={tone.pulse}>{meta.label}</TextShimmer>
    </span>
  );
}
