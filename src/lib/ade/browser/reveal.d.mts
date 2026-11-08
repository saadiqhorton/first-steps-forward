export declare function browserPageKey(
  projectId: string,
  sessionId: string,
  tabId: string | null | undefined,
  url: string,
): string;
/**
 * True only for the first page of a tab, while the docked browser is not on screen and this
 * window has not already surfaced that page.
 */
export declare function shouldRevealBrowser(input: {
  opened: boolean;
  url: string;
  visible: boolean;
  place: "dock" | "float" | "hidden";
  revealed: boolean;
}): boolean;
