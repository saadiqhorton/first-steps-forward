export const LAST_PROJECT_KEY = "ade-last-project";

export function readLastProject(): string | null {
  try {
    return window.localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function writeLastProject(projectId: string): void {
  try {
    window.localStorage.setItem(LAST_PROJECT_KEY, projectId);
  } catch {
    // Ignore quota / private-mode failures; selection still works in-memory.
  }
}

export const RIGHT_TABS = ["activity", "diff", "computer", "terminal"] as const;
export type RightTab = (typeof RIGHT_TABS)[number];

export const PROJECT_SECTIONS = ["conversations", "files", "workflows"] as const;
export type ProjectSection = (typeof PROJECT_SECTIONS)[number];

export function projectIdFromPath(pathname: string): string | null {
  return pathname.match(/^\/p\/([^/]+)/)?.[1] ?? null;
}

export function projectSectionFromPath(pathname: string): ProjectSection | null {
  const projectId = projectIdFromPath(pathname);
  if (!projectId) return null;
  const rest = pathname.slice(`/p/${projectId}/`.length);
  return (
    PROJECT_SECTIONS.find((section) => rest === section || rest.startsWith(`${section}/`)) ?? null
  );
}
