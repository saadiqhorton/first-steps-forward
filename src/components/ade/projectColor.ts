/**
 * Deterministic project-tab badge colors from the ADE token palette.
 * Same id always maps to the same tint pair.
 */
const PALETTE = [
  { bg: "bg-amber/20", fg: "text-amber-deep" },
  { bg: "bg-teal/20", fg: "text-teal-deep" },
  { bg: "bg-ink/10", fg: "text-ink" },
  { bg: "bg-amber-deep/15", fg: "text-amber-deep" },
  { bg: "bg-teal-deep/15", fg: "text-teal-deep" },
  { bg: "bg-danger/15", fg: "text-danger" },
] as const;

export function projectColor(projectId: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * 31 + projectId.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % PALETTE.length;
  return PALETTE[index]!;
}
