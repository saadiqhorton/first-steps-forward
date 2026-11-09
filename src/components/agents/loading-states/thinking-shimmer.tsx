// Vendored from beUI (https://beui.dev), MIT — see src/components/agents/BEUI-LICENSE
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { cn } from "@/lib/utils";

export interface ThinkingShimmerProps {
  /** Loading message shown to the user. */
  children?: string;
  /** Seconds taken for one shimmer pass. */
  duration?: number;
  className?: string;
}

export function ThinkingShimmer({
  children = "Thinking…",
  duration = 1.8,
  className,
}: ThinkingShimmerProps) {
  return (
    <TextShimmer as="span" duration={duration} className={cn("font-medium", className)}>
      {children}
    </TextShimmer>
  );
}
