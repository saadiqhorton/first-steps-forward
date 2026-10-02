/** One-line title from a task request — first line, capped for headers/lists. */
export function sessionTitle(request: string | undefined, max = 96): string {
  const first = (request ?? "").trim().split(/\n/)[0]?.trim() ?? "";
  if (!first) return "Untitled";
  if (first.length <= max) return first;
  return `${first.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
