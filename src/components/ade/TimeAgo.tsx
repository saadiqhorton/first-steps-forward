import { timeAgo, useNow } from "@/lib/ade/store";

/** A ticking "3m ago" that re-renders only itself. */
export function TimeAgo({ at }: { at: number | undefined }) {
  return <>{timeAgo(useNow(), at)}</>;
}
