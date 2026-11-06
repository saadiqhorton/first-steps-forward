import { type ReactNode, type Ref } from "react";
import { X } from "lucide-react";
import { GlideIndicator } from "@/components/ade/motion";
import { RIGHT_PANE_TABS } from "@/components/ade/rightPaneTabs";
import { type RightTab } from "@/lib/ade/navigation";

export function RightPaneTabs(props: {
  tab: RightTab;
  onSelect: (tab: RightTab) => void;
  terminalOpened: boolean;
  terminalClosing: boolean;
  onCloseTerminal: () => void;
  activityTabRef?: Ref<HTMLButtonElement>;
}): ReactNode {
  const { tab, onSelect, terminalOpened, terminalClosing, onCloseTerminal, activityTabRef } = props;

  return (
    <div
      role="tablist"
      aria-label="Right panel"
      className="@container/tabs min-w-0 flex h-9 shrink-0 items-center gap-0.5 border-b border-line bg-panel overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {RIGHT_PANE_TABS.map(({ id, label, Icon }) => {
        const isActive = tab === id;
        const isTerminal = id === "terminal";
        const ariaControls =
          id === "computer"
            ? "right-computer-panel"
            : id === "terminal"
              ? "right-terminal-panel"
              : "right-session-panel";

        return (
          <div key={id} className="relative flex shrink-0 items-center">
            <button
              type="button"
              role="tab"
              id={`right-${id}-tab`}
              ref={id === "activity" ? activityTabRef : undefined}
              aria-selected={isActive}
              aria-controls={ariaControls}
              onClick={() => onSelect(id)}
              title={label}
              aria-label={isActive ? undefined : label}
              className={`relative inline-flex h-9 shrink-0 items-center gap-1.5 px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-amber ${isActive ? "text-ink" : "text-dim hover:text-ink"}`}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
              <span
                className={
                  isActive
                    ? "inline whitespace-nowrap"
                    : "hidden whitespace-nowrap @[26rem]/tabs:inline"
                }
              >
                {label}
              </span>
              {isActive && (
                <GlideIndicator
                  id="right-pane-tab"
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-ink"
                />
              )}
            </button>
            {isTerminal && terminalOpened && (
              <button
                type="button"
                aria-label="Close terminal tab"
                title="Close terminal"
                onClick={onCloseTerminal}
                disabled={terminalClosing}
                className="mx-1 grid size-5 shrink-0 place-items-center rounded-xs text-dim transition-colors hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber disabled:opacity-40"
              >
                <X className="size-3.5" strokeWidth={1.5} aria-hidden />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
