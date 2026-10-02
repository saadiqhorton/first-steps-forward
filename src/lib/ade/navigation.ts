export const LAST_PROJECT_KEY = "ade-last-project";

export function readLastProject(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function writeLastProject(projectId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_PROJECT_KEY, projectId);
  } catch {
    // Ignore quota / private-mode failures; selection still works in-memory.
  }
}

export type RightTab = "activity" | "diff" | "computer" | "editor" | "terminal";

export function projectConversationsPath(projectId: string): string {
  return `/p/${projectId}/conversations`;
}
