import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, LoaderCircle, RotateCw } from "lucide-react";
import {
  CUSTOMIZE_KEY,
  CustomizeRequestError,
  restartAde,
  runningWithoutChanges,
  useCustomize,
  type CustomizeState,
  type CustomizeSwitch,
} from "@/lib/ade/customizeApi";
import { agentsWord } from "./customizeText";

/** How a person starts ADE again when no launcher can do it for them. */
const START_COMMAND = "npx @dezignerdrugz/ade";

function Command({ children }: { children: string }) {
  return (
    <code className="rounded-xs border border-line bg-paper px-1.5 py-0.5 font-mono text-xs text-ink">
      {children}
    </code>
  );
}

/**
 * Restart ADE on the kept version. The answer can be the last thing the old ADE says, or
 * nothing at all when it stops mid-reply; both mean the restart is under way.
 */
function useRestartAde() {
  const client = useQueryClient();
  const settle = (next: Partial<CustomizeSwitch>) =>
    client.setQueryData<CustomizeState>(CUSTOMIZE_KEY, (old) =>
      old ? { ...old, switch: { ...old.switch, ...next } } : old,
    );
  return useMutation({
    mutationFn: restartAde,
    onSuccess: (result) => settle(result?.switch ?? { status: "restarting" }),
    onError: (error) => {
      if (error instanceof CustomizeRequestError)
        void client.invalidateQueries({ queryKey: CUSTOMIZE_KEY });
      else settle({ status: "restarting" });
    },
  });
}

/** Kept changes are off: ADE was started with `ade --stock`, or not restarted since. */
export function StockNotice({
  flag = false,
  compact = false,
}: {
  flag?: boolean | undefined;
  /** One quiet row, for lists where the full notice would push the content down. */
  compact?: boolean;
}) {
  const detail = flag ? (
    <>
      ADE was started with <Command>ade --stock</Command>. Start it normally to use your kept
      changes again.
    </>
  ) : (
    "The ADE running now does not include your kept changes."
  );
  if (compact)
    return (
      <p className="flex min-w-0 items-start gap-2 text-xs leading-5 text-[color:var(--text-secondary)]">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-dim" strokeWidth={1.5} aria-hidden />
        <span className="min-w-0">
          <span className="text-ink">Running without your changes.</span> {detail}
        </span>
      </p>
    );
  return (
    <div className="flex items-start gap-3 rounded-md border border-line bg-surface-muted px-4 py-3">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-dim" strokeWidth={1.5} aria-hidden />
      <div className="min-w-0 text-xs leading-5 text-[color:var(--text-secondary)]">
        <p className="text-ui text-ink">Running without your changes</p>
        <p className="mt-0.5">{detail}</p>
      </div>
    </div>
  );
}

/**
 * Where kept changes stand and the one thing to do next: restart, wait, or read why the
 * switch failed. `kept` adds the calm "it's running" line for a change view.
 */
export function SwitchCard({
  state,
  kept = false,
  title = "Kept in your ADE. Restart ADE to start using it.",
}: {
  state: CustomizeState;
  kept?: boolean;
  /** What is waiting for the restart, in the pending card. */
  title?: string;
}) {
  const restart = useRestartAde();
  const s = state.switch;
  const restartError =
    restart.error instanceof CustomizeRequestError ? restart.error.message : null;

  const command = s.command ?? START_COMMAND;
  if (s.status === "pending" || s.status === "preparing")
    return (
      <div className="rounded-md border border-amber/40 bg-amber/5 px-4 py-3" role="status">
        <p className="flex items-center gap-2 text-ui font-medium text-ink">
          <CircleCheck className="size-4 shrink-0 text-teal" strokeWidth={1.5} aria-hidden />
          {title}
        </p>
        {s.launcher ? (
          <>
            <p className="mt-1 text-xs leading-5 text-[color:var(--text-secondary)]">
              {s.status === "preparing"
                ? "Getting your version ready first. "
                : "Running agents finish first. "}
              This page reconnects by itself.
            </p>
            <button
              type="button"
              onClick={() => restart.mutate()}
              disabled={restart.isPending}
              className="btn-amber mt-3 inline-flex min-h-[var(--control-height-md)] items-center gap-1.5 px-4 text-ui @lg:min-h-0 @lg:py-1.5"
            >
              <RotateCw className="size-4" strokeWidth={1.5} aria-hidden />
              {restart.isPending ? "Restarting…" : "Restart ADE"}
            </button>
          </>
        ) : (
          <p className="mt-1 text-xs leading-6 text-[color:var(--text-secondary)]">
            Stop ADE in the terminal it runs in (Ctrl+C), then start it again with{" "}
            <Command>{command}</Command>
          </p>
        )}
        {restartError && (
          <p className="mt-2 text-xs text-danger" role="alert">
            {restartError}
          </p>
        )}
      </div>
    );

  if (s.status === "waiting" || s.status === "restarting")
    return (
      <div
        className="flex items-start gap-3 rounded-md border border-line bg-surface-muted px-4 py-3"
        role="status"
      >
        <LoaderCircle
          className="mt-0.5 size-4 shrink-0 animate-spin text-teal"
          strokeWidth={1.5}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-ui text-ink">
            {s.status === "restarting"
              ? "Restarting ADE…"
              : s.waitingFor
                ? `Waiting for ${agentsWord(s.waitingFor)} to finish`
                : "Waiting for running agents to finish"}
          </p>
          <p className="mt-0.5 text-xs leading-5 text-[color:var(--text-secondary)]">
            {s.status === "restarting"
              ? "This page reconnects by itself."
              : "Then ADE restarts on your version. Nothing is interrupted."}
          </p>
        </div>
      </div>
    );

  if (s.status === "failed")
    return (
      <div className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3" role="alert">
        <p className="text-ui font-medium text-ink">
          {s.step === "build"
            ? "Your version couldn't be built, so ADE stays as it is."
            : "Your version didn't start, so ADE went back."}
        </p>
        <p className="mt-1 text-xs leading-5 break-words text-[color:var(--text-secondary)]">
          Reason: {s.error ?? "ADE did not answer after the restart."}
        </p>
        <p className="mt-1 text-xs leading-5 text-[color:var(--text-secondary)]">
          Remove the change that broke it, or start a new change to fix it.
        </p>
        {s.launcher && (
          <button
            type="button"
            onClick={() => restart.mutate()}
            disabled={restart.isPending}
            className="btn-quiet mt-3 inline-flex min-h-[var(--control-height-md)] items-center gap-1.5 px-4 text-xs font-medium @lg:min-h-0 @lg:py-1.5"
          >
            <RotateCw className="size-3.5" strokeWidth={1.5} aria-hidden />
            {s.step === "build" ? "Try again" : "Restart ADE again"}
          </button>
        )}
        {restartError && (
          <p className="mt-2 text-xs text-danger" role="alert">
            {restartError}
          </p>
        )}
      </div>
    );

  if (kept && !runningWithoutChanges(state))
    return (
      <p className="flex items-center gap-2 text-xs text-teal-deep" role="status">
        <CircleCheck className="size-4 shrink-0 text-teal" strokeWidth={1.5} aria-hidden />
        Kept and running in your ADE.
      </p>
    );
  return null;
}

/**
 * While ADE restarts, its local service is gone for a moment. Cover the workbench calmly,
 * keep asking, and load the new version's page once it answers.
 */
export function RestartOverlay() {
  const query = useCustomize();
  const status = query.data?.switch.status;
  const restarting = status === "restarting";
  const seen = useRef(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (restarting) {
      seen.current = true;
      const timer = window.setTimeout(() => setSlow(true), 60_000);
      return () => window.clearTimeout(timer);
    }
    setSlow(false);
    // Back on the new version: its page may differ from the one loaded here.
    if (seen.current && status === "idle") window.location.reload();
    seen.current = false;
    return undefined;
  }, [restarting, status]);

  if (!restarting) return null;
  return (
    <div
      className="absolute inset-0 z-[var(--z-raised)] grid place-items-center bg-paper/80 px-4 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="card-panel flex max-w-sm items-start gap-3 px-5 py-4">
        <LoaderCircle
          className="mt-0.5 size-4 shrink-0 animate-spin text-teal"
          strokeWidth={1.5}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-ui font-medium text-ink">Restarting ADE…</p>
          <p className="mt-1 text-xs leading-5 text-[color:var(--text-secondary)]">
            {slow ? (
              <>
                This is taking longer than usual. If ADE stays away, start it again with{" "}
                <Command>{START_COMMAND}</Command>
              </>
            ) : (
              "Starting your version. This page reconnects by itself."
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
