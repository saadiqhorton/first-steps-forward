import { createFileRoute } from "@tanstack/react-router";
import { CustomizeFrame, CustomizeGate } from "@/components/ade/customize/CustomizeGate";
import { CustomizeStart } from "@/components/ade/customize/CustomizeStart";
import { KeptList } from "@/components/ade/customize/KeptList";
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
    <>
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
      <aside
        aria-label="Details"
        className={`${pane === "details" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col overflow-y-auto border-line px-4 py-5 lg:hidden`}
      >
        <CustomizeGate>
          {(state) => (
            <div className="space-y-6">
              <section className="space-y-2">
                <h1 className="heading-display text-xl">Your copy of ADE</h1>
                <p className="text-ui text-dim">Version {state.version}</p>
                <p className="text-ui text-dim">
                  {state.setup.status === "ready"
                    ? state.current.stock
                      ? "ADE is running without your changes."
                      : state.switch.status === "pending"
                        ? "Restart ADE to start using your kept changes."
                        : "Your private copy is ready for changes."
                    : `Customization: ${SETUP_STATUS[state.setup.status]}.`}
                </p>
              </section>
              {state.setup.status === "ready" ? (
                <KeptList state={state} />
              ) : (
                <p className="text-ui text-dim">
                  Set up customization from the Conversation tab to create your private copy.
                </p>
              )}
            </div>
          )}
        </CustomizeGate>
      </aside>
    </>
  );
}
