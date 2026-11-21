import { useEffect, useState } from "react";
import { Outlet, createFileRoute, useParams } from "@tanstack/react-router";
import { GlideIndicator } from "@/components/ade/motion";
import { ChangesRail } from "@/components/ade/customize/ChangesRail";
import { RestartOverlay } from "@/components/ade/customize/SwitchCard";
import {
  CustomizePaneContext,
  paneVisibility,
  type CustomizePane,
} from "@/components/ade/customize/paneContext";
import { useCustomize } from "@/lib/ade/customizeApi";

export const Route = createFileRoute("/workspace/customize")({
  component: CustomizeLayout,
  head: () => ({ meta: [{ title: "ADE — Customize ADE" }] }),
});

const PANES: { id: CustomizePane; label: string }[] = [
  { id: "changes", label: "Changes" },
  { id: "conversation", label: "Conversation" },
  { id: "details", label: "Details" },
];

/**
 * The workbench owns its three columns: Changes rail, the change, and its details panel.
 * `workspace-chat` keeps the shell's right pane hidden from the first paint.
 */
function CustomizeLayout() {
  const { changeId } = useParams({ strict: false });
  const [pane, setPane] = useState<CustomizePane>("conversation");
  const query = useCustomize();

  useEffect(() => {
    if (!changeId && pane === "details") setPane("conversation");
  }, [changeId, pane]);

  const tabs = PANES.filter((p) => p.id !== "details" || changeId);

  return (
    <CustomizePaneContext.Provider value={{ pane, setPane }}>
      <div className="workspace-chat relative flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
        {/* Phones: one pane at a time, picked from a plain underline tab row (as in Luna). */}
        <div
          role="tablist"
          aria-label="Customize ADE"
          className="flex shrink-0 items-stretch gap-1 border-b border-line bg-paper px-2 lg:hidden"
        >
          {tabs.map((tab) => {
            const active = pane === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPane(tab.id)}
                className={`relative inline-flex min-h-[var(--control-height-md)] min-w-0 items-center px-3 text-ui transition-colors focus-visible:outline-2 focus-visible:outline-amber ${active ? "text-ink" : "text-dim hover:text-ink"}`}
              >
                <span className="truncate">{tab.label}</span>
                {active && (
                  <GlideIndicator
                    id="customize-phone-tab"
                    className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-ink"
                  />
                )}
              </button>
            );
          })}
        </div>
        <aside
          aria-label="Changes"
          className={`min-h-0 w-full shrink-0 flex-1 border-line lg:w-60 lg:flex-none lg:border-r ${paneVisibility(pane === "changes")}`}
        >
          <ChangesRail state={query.data} />
        </aside>
        <Outlet />
        <RestartOverlay />
      </div>
    </CustomizePaneContext.Provider>
  );
}
