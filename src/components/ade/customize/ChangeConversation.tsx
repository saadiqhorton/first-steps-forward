import { useEffect, useRef } from "react";
import { AnimatePresence } from "motion/react";
import { MotionItem } from "@/components/ade/motion";
import { PermissionRequestCard } from "@/components/ade/PermissionRequestCard";
import { SessionMessage } from "@/components/ade/SessionMessage";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { BUSY, type Change } from "@/lib/ade/customizeApi";
import { currentActivity } from "@/lib/ade/formatLogs.mjs";
import { useAde, useAdeState, useSession, useSessionLogs } from "@/lib/ade/store";
import { FilesList } from "./FilesPanel";

/** The change's agent session, rendered with the same message parts as a project conversation. */
export function ChangeConversation({ change }: { change: Change }) {
  const { stop } = useAde();
  const agents = useAdeState((s) => s.agents);
  const agent = agents.find((a) => a.id === change.agentId);
  const session = useSession(change.sessionId);
  const logs = useSessionLogs(change.status === "working" ? change.sessionId : "");
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const messages = session.data?.messages ?? [];
  const permissions = (session.data?.pendingPermissions ?? []).filter(
    (request) => request.kind !== "dev_command",
  );
  const busy = BUSY.includes(change.status);
  const last = messages[messages.length - 1];

  useEffect(() => {
    if (stick.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, last?.text.length, change.status, permissions.length]);

  return (
    <div
      ref={scrollRef}
      onScroll={() => {
        const el = scrollRef.current;
        if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 @lg:px-7"
    >
      <div className="mx-auto w-full max-w-3xl space-y-3">
        {session.isPending && change.sessionId ? (
          <p className="text-ui text-dim">Loading the conversation…</p>
        ) : session.isError ? (
          <div className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-ui">
            The conversation could not be loaded:{" "}
            {session.error instanceof Error ? session.error.message : String(session.error)}
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((message) => (
              <MotionItem key={message.id} layout={false}>
                <SessionMessage message={message} agentName={agent?.short} />
              </MotionItem>
            ))}
          </AnimatePresence>
        )}

        {permissions.map((request) => (
          <PermissionRequestCard
            key={request.id}
            sessionId={change.sessionId}
            request={request}
            agentName={agent?.short ?? change.agentId}
          />
        ))}

        {busy && (
          <div className="flex flex-wrap items-center gap-3 text-ui text-dim">
            <span className="size-1.5 animate-pulse-soft rounded-full bg-teal" aria-hidden />
            <TextShimmer>
              {change.status === "checking"
                ? "Running checks"
                : change.status === "fixing"
                  ? "Fixing a failed check"
                  : currentActivity(logs.data?.lines.map((line) => line.text) ?? [])}
            </TextShimmer>
            {change.status !== "checking" && (
              <button
                type="button"
                onClick={() => stop(change.sessionId)}
                className="btn-quiet shrink-0 px-3 py-1.5 text-xs font-medium"
              >
                Stop
              </button>
            )}
          </div>
        )}

        {change.status === "needs-you" && change.reason && (
          <div className="rounded-md border border-amber/40 bg-amber/5 px-4 py-3 text-ui leading-5">
            {change.reason}
          </div>
        )}

        {!busy && change.files.length > 0 && (
          <div className="card-panel px-4 py-3">
            <div className="label-section">
              {change.files.length} file{change.files.length === 1 ? "" : "s"} changed
            </div>
            <div className="mt-2">
              <FilesList files={change.files} />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
