import { useEffect, useRef, useState } from "react";
import { ChevronRight, Wrench } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { MotionItem } from "@/components/ade/motion";
import { PermissionRequestCard } from "@/components/ade/PermissionRequestCard";
import { SessionMessage } from "@/components/ade/SessionMessage";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { BUSY, type Change } from "@/lib/ade/customizeApi";
import { currentActivity } from "@/lib/ade/formatLogs.mjs";
import { useAde, useAdeState, useSession, useSessionLogs } from "@/lib/ade/store";
import type { Message } from "@/lib/ade/types";
import { FilesList } from "./FilesPanel";

const MAX_FIX_ATTEMPTS = 2;

/** What a newer local service may attach to the follow-up it sends after failed checks. */
interface FixPresentation {
  kind?: string;
  checks?: string[];
  attempt?: number;
  maxAttempts?: number;
  fix?: { checks?: string[]; attempt?: number; maxAttempts?: number };
}

/**
 * ADE's own follow-up after failed checks, as opposed to something the person typed. Uses the
 * message's presentation when the local service marks it, else ADE's fixed opening line.
 */
function fixPromptInfo(
  message: Message,
): { checks: string[]; attempt?: number; max?: number; line?: string } | null {
  if (message.role !== "user") return null;
  const p = message.presentation as (Message["presentation"] & FixPresentation) | undefined;
  const meta = p?.fix ?? (p?.kind && /fix/i.test(p.kind) ? p : null);
  const opening = /^ADE ran (its|the) checks/.test(message.text);
  const line =
    p?.kind === "ade" || p?.text?.startsWith("ADE sent")
      ? p.text.replace(/\s*\(attempt (\d+) of (\d+)\)$/, " · attempt $1 of $2")
      : undefined;
  if (!meta && !opening && !line) return null;
  const named = [...message.text.matchAll(/Check "([^"]+)" failed/g)].map((m) => m[1] ?? "");
  return {
    checks: meta?.checks?.length ? meta.checks : named.filter(Boolean),
    ...(meta?.attempt ? { attempt: meta.attempt } : {}),
    ...(meta?.maxAttempts ? { max: meta.maxAttempts } : {}),
    ...(line ? { line } : {}),
  };
}

function names(checks: string[]) {
  if (checks.length <= 1) return checks[0] ?? "check";
  return `${checks.slice(0, -1).join(", ")} and ${checks[checks.length - 1]}`;
}

/** A compact system row for ADE's automatic fix request; the full text stays one click away. */
function FixPromptRow({
  message,
  info,
  attempt,
}: {
  message: Message;
  info: NonNullable<ReturnType<typeof fixPromptInfo>>;
  attempt: number;
}) {
  const [open, setOpen] = useState(false);
  const n = info.attempt ?? attempt;
  const line =
    info.line ??
    `ADE sent the failing ${names(info.checks)} output to the agent · attempt ${n} of ${info.max ?? MAX_FIX_ATTEMPTS}`;
  return (
    <div className="py-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 text-left text-xs text-dim transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
      >
        <Wrench className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 flex-1">{line}</span>
        <ChevronRight
          className={`size-3.5 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          strokeWidth={1.5}
          aria-hidden
        />
      </button>
      {open && (
        <pre className="mt-2 max-h-60 overflow-auto rounded-md border border-line bg-paper p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-[color:var(--text-secondary)]">
          {message.text}
        </pre>
      )}
    </div>
  );
}

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
  let fixCount = 0;

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
            {messages.map((message) => {
              const fix = fixPromptInfo(message);
              if (fix) fixCount += 1;
              return (
                <MotionItem key={message.id} layout={false}>
                  {fix ? (
                    <FixPromptRow message={message} info={fix} attempt={fixCount} />
                  ) : (
                    <SessionMessage message={message} agentName={agent?.short} />
                  )}
                </MotionItem>
              );
            })}
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
