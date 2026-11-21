import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentSelection } from "@/components/ade/AgentPicker";
import { Composer } from "@/components/ade/Composer";
import { ChangeActions } from "@/components/ade/customize/ChangeActions";
import { ChangeConversation } from "@/components/ade/customize/ChangeConversation";
import { ChangeHeader } from "@/components/ade/customize/ChangeHeader";
import { ChangePanel, usePanelTab } from "@/components/ade/customize/ChangePanel";
import { CustomizeFrame, CustomizeGate } from "@/components/ade/customize/CustomizeGate";
import { paneVisibility, useCustomizePane } from "@/components/ade/customize/paneContext";
import { CUSTOMIZE_KEY, NEEDS_YOU, type Change, type CustomizeState } from "@/lib/ade/customizeApi";
import { useAde, useSession } from "@/lib/ade/store";

export const Route = createFileRoute("/workspace/customize/$changeId")({
  component: ChangeRoute,
});

function ChangeRoute() {
  const { changeId } = Route.useParams();
  const { pane } = useCustomizePane();
  return (
    <CustomizeGate>
      {(state) => {
        const change = state.changes.find((c) => c.id === changeId);
        if (!change)
          return (
            <main
              className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden @container ${paneVisibility(pane !== "changes")}`}
            >
              <CustomizeFrame status="Not found">
                <p className="text-ui text-dim">
                  This change is not here anymore. It may have been undone.{" "}
                  <Link
                    to="/workspace/customize"
                    className="text-ink underline-offset-2 hover:underline"
                  >
                    Start a new change
                  </Link>
                </p>
              </CustomizeFrame>
            </main>
          );
        return <ChangeView key={change.id} change={change} state={state} />;
      }}
    </CustomizeGate>
  );
}

function followUpBlocked(change: Change): string | undefined {
  if (NEEDS_YOU.includes(change.status)) return undefined;
  if (change.status === "kept") return "This change is kept. Start a new change to adjust it.";
  if (change.status === "removed") return "This change was removed. Start a new change instead.";
  if (change.status === "checking") return "Checks are running. You can reply when they finish.";
  return "The agent is working. You can reply when it finishes.";
}

function ChangeView({ change, state }: { change: Change; state: CustomizeState }) {
  const { pane, setPane } = useCustomizePane();
  const [tab, setTab] = usePanelTab(change);
  const [reveal, setReveal] = useState(0);
  const showPreview = () => {
    setTab("preview");
    setReveal((n) => n + 1);
    setPane("details");
  };
  const { steer } = useAde();
  const client = useQueryClient();
  const session = useSession(change.sessionId);
  const [selection, setSelection] = useState<AgentSelection | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeSelection: AgentSelection = selection ?? {
    agentId: change.agentId,
    model: session.data?.model ?? "",
    effort: session.data?.effort ?? "",
    speed: session.data?.speed ?? "",
    permission: "build",
  };
  const blocked = followUpBlocked(change);

  const send = async (text: string) => {
    if (!text.trim()) return false;
    setSending(true);
    setError(null);
    try {
      await steer(change.sessionId, text.trim());
      await client.invalidateQueries({ queryKey: CUSTOMIZE_KEY });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <main
        className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden @container ${paneVisibility(pane === "conversation")}`}
      >
        <ChangeHeader change={change} state={state} />
        <ChangeConversation change={change} />
        <div className="shrink-0 border-t border-line px-4 py-3 @lg:px-7">
          <div className="mx-auto w-full max-w-3xl">
            <ChangeActions change={change} onTry={showPreview} />
          </div>
        </div>
        <div className="shrink-0 border-t border-line px-4 py-4 @lg:px-7">
          <div className="mx-auto w-full max-w-3xl">
            <Composer
              mode="follow-up"
              sessionId={change.sessionId}
              selection={activeSelection}
              onSelectionChange={setSelection}
              branch=""
              placeholder="Ask the agent for changes"
              sending={sending}
              error={error}
              onSend={send}
              agentLocked="A change keeps the agent it started with"
              {...(blocked ? { disabledReason: blocked } : {})}
            />
          </div>
        </div>
      </main>
      <ChangePanel
        change={change}
        state={state}
        phoneActive={pane === "details"}
        tab={tab}
        onTabChange={setTab}
        reveal={reveal}
      />
    </>
  );
}
