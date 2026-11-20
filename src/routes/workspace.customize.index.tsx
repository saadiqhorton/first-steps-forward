import { createFileRoute } from "@tanstack/react-router";
import { CustomizeFrame, CustomizeGate } from "@/components/ade/customize/CustomizeGate";
import { CustomizeStart } from "@/components/ade/customize/CustomizeStart";
import { SetupPanel } from "@/components/ade/customize/SetupPanel";
import { paneVisibility, useCustomizePane } from "@/components/ade/customize/paneContext";

export const Route = createFileRoute("/workspace/customize/")({
  component: CustomizeIndex,
});

const SETUP_STATUS = {
  none: "Not set up yet",
  running: "Setting up",
  failed: "Setup stopped",
  ready: "Ready",
} as const;

function CustomizeIndex() {
  const { pane } = useCustomizePane();
  return (
    <main
      className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden @container ${paneVisibility(pane === "conversation")}`}
    >
      <CustomizeGate>
        {(state) =>
          state.setup.status === "ready" ? (
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              <CustomizeStart state={state} />
            </div>
          ) : (
            <CustomizeFrame
              status={SETUP_STATUS[state.setup.status]}
              dot={
                state.setup.status === "running"
                  ? "bg-teal animate-pulse-soft"
                  : state.setup.status === "failed"
                    ? "bg-danger"
                    : "bg-dim"
              }
            >
              <SetupPanel setup={state.setup} />
            </CustomizeFrame>
          )
        }
      </CustomizeGate>
    </main>
  );
}
