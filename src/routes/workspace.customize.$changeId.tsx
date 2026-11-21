import { useCallback, useEffect, useRef, useState } from "react";
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
import { checkLabel } from "@/components/ade/customize/customizeText";
import {
  CUSTOMIZE_KEY,
  NEEDS_YOU,
  previewRunning,
  type Change,
  type CustomizeState,
} from "@/lib/ade/customizeApi";
import { saveComposerDraft } from "@/lib/ade/browser/composerFeedback";
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

/** What "Ask the agent to try again" puts in the composer, naming the checks that fail. */
function askAgainText(change: Change) {
  const failing = change.checks.filter((c) => c.status === "failed").map(checkLabel);
  const which = failing.length ? failing.join(" and ") : "A";
  return `${which} check${failing.length > 1 ? "s" : ""} still fail${failing.length > 1 ? "" : "s"}. Look at the failing output again, find the cause and fix it. Keep the tests meaningful: don't skip or weaken them.`;
}

/** Phones: the agent chip may use the full row, so the model name is not cut off. */
const COMPOSER_FIT = "[&_button[aria-haspopup=dialog]]:max-w-none!";

function ChangeView({ change, state }: { change: Change; state: CustomizeState }) {
  const { pane, setPane } = useCustomizePane();
  const [tab, setTab] = usePanelTab(change);
  const [reveal, setReveal] = useState(0);
  // Expand preview: the running preview covers the conversation; Esc or Back returns.
  const [expanded, setExpandedState] = useState(false);
  const running = previewRunning(change);
  const setExpanded = useCallback(
    (next: boolean) => {
      setExpandedState(next);
      if (next) setTab("preview");
      // Phones: back lands on the conversation, not on a second, smaller preview.
      else if (window.matchMedia("(max-width: 1023px)").matches) setPane("conversation");
    },
    [setTab, setPane],
  );
  useEffect(() => {
    if (!running) setExpandedState(false);
  }, [running]);
  // Try it opens the panel on Preview; once the preview runs, the same button expands it.
  const showPreview = () => {
    setTab("preview");
    setReveal((n) => n + 1);
    setPane("details");
    if (running) setExpanded(true);
  };
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, setExpanded]);
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
  const [seed, setSeed] = useState({ text: "", nonce: 0 });
  const composerRef = useRef<HTMLDivElement>(null);
  const draftKey = `customize:change:${change.id}`;
  // The composer restores its saved draft on mount, so the request is saved as the draft first.
  const askAgain = async () => {
    setPane("conversation");
    const text = askAgainText(change);
    await saveComposerDraft(draftKey, { text, files: [], contextItems: [] }).catch(() => {});
    setSeed((s) => ({ text, nonce: s.nonce + 1 }));
  };
  useEffect(() => {
    if (!seed.nonce) return;
    const field = composerRef.current?.querySelector("textarea");
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  }, [seed.nonce]);

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
        className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden @container ${expanded ? "hidden" : paneVisibility(pane === "conversation")}`}
      >
        <ChangeHeader change={change} state={state} />
        <ChangeConversation change={change} />
        {/* One bottom area. Wide: actions above the composer. Phones: the composer, then the
            actions under it within thumb reach. */}
        <div className="flex shrink-0 flex-col border-t border-line bg-paper @lg:bg-transparent">
          <div className="order-last px-3 pb-3 @lg:order-none @lg:border-b @lg:border-line @lg:px-7 @lg:py-3">
            <div className="mx-auto w-full max-w-3xl">
              <ChangeActions
                change={change}
                state={state}
                onTry={showPreview}
                onAskAgain={() => void askAgain()}
              />
            </div>
          </div>
          <div className="px-3 pt-3 pb-2 @lg:px-7 @lg:py-4">
            <div ref={composerRef} className={`mx-auto w-full max-w-3xl ${COMPOSER_FIT}`}>
              <Composer
                key={seed.nonce}
                {...(seed.text ? { initialText: seed.text } : {})}
                mode="follow-up"
                sessionId={change.sessionId}
                draftStorageKey={draftKey}
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
        </div>
      </main>
      <ChangePanel
        change={change}
        state={state}
        phoneActive={pane === "details"}
        tab={tab}
        onTabChange={setTab}
        reveal={reveal}
        expanded={expanded && running}
        onExpand={setExpanded}
      />
    </>
  );
}
