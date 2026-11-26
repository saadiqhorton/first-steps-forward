/**
 * Which right-pane tabs a route can actually use.
 *
 * Luna's chat keeps the Shell's right pane for its Activity tab, but a read-only
 * conversation has no project diff and no project terminal behind it. Showing
 * those tabs there only offered an empty panel ("Diffs are available in a project
 * conversation") and a terminal for whatever project happened to be active.
 */

/** Tabs the assistant (Luna) screens hide because nothing backs them there. */
export const LUNA_HIDDEN_RIGHT_TABS = Object.freeze(["diff", "terminal"]);

export function isAssistantPath(pathname) {
  return pathname === "/workspace/assistant" || pathname.startsWith("/workspace/assistant/");
}

/** False when `tab` is one of the tabs Luna's screens deliberately hide. */
export function isRightTabVisible(pathname, tab) {
  return !(isAssistantPath(pathname) && LUNA_HIDDEN_RIGHT_TABS.includes(tab));
}

/**
 * Whether a right-rail tab's content should run (selected and rail expanded).
 * Computer and Terminal both gate poll/stream work on this — keep them paired.
 */
export function isRightRailTabActive(rightTab, tab, collapsedRight) {
  return rightTab === tab && !collapsedRight;
}
