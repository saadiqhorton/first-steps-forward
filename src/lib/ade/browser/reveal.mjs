// When a page the agent opened should float over the conversation, as T3's preview does.

/** A page is identified by its conversation, tab and address. */
export function browserPageKey(projectId, sessionId, tabId, url) {
  return `${projectId}:${sessionId}:${tabId ?? ""}:${url}`;
}

/**
 * True only for the first page of a tab, while the docked browser is not on screen and this
 * window has not already surfaced that page.
 * @param {{ opened: boolean, url: string, visible: boolean, place: string, revealed: boolean }} input
 */
export function shouldRevealBrowser({ opened, url, visible, place, revealed }) {
  if (!opened || !/^https?:\/\//i.test(url ?? "")) return false;
  if (visible || place === "float") return false;
  return !revealed;
}
