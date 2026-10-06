import { type ReactNode } from "react";
import { PanelRightOpen, PanelBottomOpen } from "lucide-react";
import { RIGHT_PANE_TABS } from "@/components/ade/RightPaneTabs";
import { type RightTab } from "@/lib/ade/navigation";
import { type RightDock, type ComputerTone } from "@/components/ade/rightPaneTypes";

export function RightRail(props: {
  orientation: "vertical" | "horizontal";
  tab: RightTab;
  computerTone: ComputerTone;
  onSelect: (tab: "activity" | "diff" | "computer" | "terminal") => void;
  onExpand: () => void;
  dock: RightDock;
}): ReactNode {
  const { orientation, tab, computerTone, onSelect, onExpand, dock } = props;

  const isVertical = orientation === "vertical";
  const isSideDock = dock === "side";

  const expandIcon = isSideDock ? PanelRightOpen : PanelBottomOpen;
  const ExpandIcon = expandIcon;

  const computerDotColorMap: Record<ComputerTone, string> = {
    idle: "bg-dim/60",
    busy: "bg-amber animate-pulse-soft",
    live: "bg-teal",
    error: "bg-danger",
  };

  const computerDotColor = computerDotColorMap[computerTone];

  const containerClass = isVertical
    ? "flex h-full w-full flex-col items-center gap-1 bg-panel py-2"
    : "flex h-full w-full items-center gap-1 bg-panel px-2";

  const dividerClass = isVertical ? "h-px w-5 bg-line" : "h-5 w-px bg-line";

  return (
    <div className={containerClass}>
      <button
        type="button"
        aria-label="Show right panel"
        title="Show right panel (Ctrl+/)"
        onClick={onExpand}
        className="grid size-7 place-items-center rounded-md text-dim hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
      >
        <ExpandIcon className="size-4" aria-hidden />
      </button>

      <div className={dividerClass} />

      <div className={isVertical ? "flex flex-col items-center gap-1" : "flex items-center gap-1"}>
        {RIGHT_PANE_TABS.map(({ id, label, Icon }) => {
          const isActive = tab === id;
          const isComputer = id === "computer";

          return (
            <div key={id} className="relative">
              <button
                type="button"
                aria-label={label}
                title={label}
                onClick={() => onSelect(id)}
                className={`grid size-7 place-items-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-amber ${
                  isActive
                    ? "bg-ink/[0.06] text-ink"
                    : "text-dim hover:bg-ink/[0.04] hover:text-ink"
                }`}
              >
                <Icon className="size-4" aria-hidden />
              </button>

              {isComputer && (
                <>
                  <div
                    className={`absolute top-0.5 right-0.5 size-1.5 rounded-full ${computerDotColor}`}
                    aria-hidden
                  />
                  <span className="sr-only">computer {computerTone}</span>
                </>
              )}
            </div>
          );
        })}
      </div>

      {!isVertical && (
        <div className="ml-auto flex items-center">
          <span className="text-[12px] text-dim whitespace-nowrap">
            {RIGHT_PANE_TABS.find((t) => t.id === tab)?.label}
          </span>
        </div>
      )}
    </div>
  );
}
