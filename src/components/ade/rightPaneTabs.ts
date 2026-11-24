import { Activity, FileDiff, Globe, Server, SquareTerminal, type LucideIcon } from "lucide-react";
import { isRightTabVisible } from "@/lib/ade/rightPane.mjs";
import type { RightTab } from "@/lib/ade/navigation";

export type RightPaneTab = {
  id: RightTab;
  label: string;
  Icon: LucideIcon;
};

export const RIGHT_PANE_TABS: ReadonlyArray<RightPaneTab> = [
  { id: "activity", label: "Activity", Icon: Activity },
  { id: "diff", label: "Diff", Icon: FileDiff },
  { id: "computer", label: "Browser", Icon: Globe },
  { id: "terminal", label: "Terminal", Icon: SquareTerminal },
  { id: "processes", label: "Processes", Icon: Server },
];

/**
 * The tabs this route can actually fill. Luna's chat drops Diff and Terminal;
 * every project route keeps the full set.
 */
export function rightPaneTabsFor(pathname: string): ReadonlyArray<RightPaneTab> {
  return RIGHT_PANE_TABS.filter((tab) => isRightTabVisible(pathname, tab.id));
}
