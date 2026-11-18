/**
 * Deterministic project colors from the ADE token palette: the badge tint pair, plus `tone`,
 * a CSS color for solid fills such as folder icons. Same id always maps to the same entry.
 */
const PALETTE = [
  { bg: "bg-amber/20", fg: "text-amber-deep", tone: "var(--amber)" },
  { bg: "bg-teal/20", fg: "text-teal-deep", tone: "var(--teal)" },
  // A solid ink folder reads as a hole in the page, so the neutral entry fills with dim.
  { bg: "bg-ink/10", fg: "text-ink", tone: "var(--dim)" },
  { bg: "bg-amber-deep/15", fg: "text-amber-deep", tone: "var(--amber-deep)" },
  { bg: "bg-teal-deep/15", fg: "text-teal-deep", tone: "var(--teal-deep)" },
  { bg: "bg-danger/15", fg: "text-danger", tone: "var(--danger)" },
] as const;

export type ProjectColor = { bg: string; fg: string; tone: string };

export function projectColor(projectId: string): ProjectColor {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * 31 + projectId.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % PALETTE.length;
  return PALETTE[index]!;
}
