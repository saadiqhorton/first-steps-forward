import { Activity, FileDiff, Globe, SquareTerminal, type LucideIcon } from "lucide-react";
import type { RightTab } from "@/lib/ade/navigation";

export const RIGHT_PANE_TABS: ReadonlyArray<{
  id: RightTab;
  label: string;
  Icon: LucideIcon;
}> = [
  { id: "activity", label: "Activity", Icon: Activity },
  { id: "diff", label: "Diff", Icon: FileDiff },
  { id: "computer", label: "Browser", Icon: Globe },
  { id: "terminal", label: "Terminal", Icon: SquareTerminal },
];
