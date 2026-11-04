import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Globe, LoaderCircle, RotateCw } from "lucide-react";
import type { AgentComputer, Project, SessionSummary } from "@/lib/ade/types";
import {
  computerControl,
  computerProfile,
  computerStatus,
  useSession,
  useSessionLogs,
} from "@/lib/ade/store";
import { copyText } from "@/lib/ade/clipboard";
import { summarizeChecks } from "./ChecksList";
import { BrowserChromeRow } from "./browser/BrowserChromeRow";
import { BrowserSurface } from "./browser/BrowserSurface";
import { useBrowserPreview } from "./browser/browserPreviewContext";
import type { RightDock, ComputerTone } from "./rightPaneTypes";

const PROFILE_OPTIONS: Array<{ value: AgentComputer["profile"]; label: string; title: string }> = [
  {
    value: "default",
    label: "keep logins",
    title: "Keep this project's cookies and storage between runs",
  },
  { value: "incognito", label: "incognito", title: "Start clean every time the browser starts" },
];

const megabytes = (bytes: number) => Math.round(bytes / 1_000_000);

const DETAIL_ROW = "flex h-9 items-center justify-between gap-3 px-4";
const DETAIL_LABEL = "min-w-0 truncate text-[13px] text-[var(--text-secondary)]";
const DETAIL_VALUE = "shrink-0 font-mono text-xs tabular-nums text-ink";

/**
 * The project's agent browser: headless Chrome on this machine that the coding agent drives
 * itself (screenshots, mouse, keyboard, page snapshots) to run and manually test the project.
 * The user watches live and can take the wheel. It starts when this tab is shown.
 */
export function AgentComputerPane({
  project,
  session,
  dock = "side",
  active = false,
  onToneChange,
}: {
  project: Project;
  session?: SessionSummary | undefined;
  dock?: RightDock;
  /** The tab is on screen; a stopped browser starts once per project when it first is. */
  active?: boolean;
  onToneChange?: (tone: ComputerTone) => void;
}) {
  const queryClient = useQueryClient();
  const computerQuery = useQuery({
    queryKey: ["computer", project.id],
    queryFn: () => computerStatus(project.id),
    staleTime: Infinity,
  });
  const computer = computerQuery.data ?? null;
  const sessionDetail = useSession(session?.id ?? "").data;
  const sessionLogs = useSessionLogs(session?.id ?? "");
  const [error, setError] = useState("");
  const browser = useBrowserPreview();
  // Control is shared with the browser preview and the agent's tools, so it lives in the provider.
  const control = browser.control?.controller === "you";
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const autoStarted = useRef(new Set<string>());
  const browserFrameRef = useRef<HTMLDivElement>(null);
  const onToneChangeRef = useRef(onToneChange);

  useEffect(() => {
    onToneChangeRef.current = onToneChange;
  }, [onToneChange]);

  const status = computer?.status;
  const running = status === "running";
  const preparing = status === "installing" || status === "starting";

  const tone: ComputerTone = running
    ? "live"
    : preparing || (!computer && !error)
      ? "busy"
      : status === "error" || status === "unavailable" || (!computer && error)
        ? "error"
        : "idle";

  useEffect(() => {
    onToneChangeRef.current?.(tone);
  }, [tone]);

  const refresh = useCallback(async () => {
    try {
      await queryClient.fetchQuery({
        queryKey: ["computer", project.id],
        queryFn: () => computerStatus(project.id),
        staleTime: 0,
      });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [project.id, queryClient]);

  const apply = useCallback(
    async (next: Promise<AgentComputer>) => {
      setBusy(true);
      try {
        queryClient.setQueryData(["computer", project.id], await next);
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [project.id, queryClient],
  );
  const run = (op: "start" | "stop" | "clear") => apply(computerControl(project.id, op));

  // Launching takes about a second, so opening the tab starts the browser. Only once per project:
  // after Turn off it stays off until started again.
  useEffect(() => {
    if (!active || status !== "stopped" || autoStarted.current.has(project.id)) return;
    autoStarted.current.add(project.id);
    void apply(computerControl(project.id, "start"));
  }, [active, status, project.id, apply]);

  const copySetup = async () => {
    if (!computer?.setupCommand) return;
    if (await copyText(computer.setupCommand)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  const progress = computer?.progress;
  const percent =
    progress && progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
      : 0;
  const needsStatusRetry = (!computer && !!error) || status === "unavailable";
  const screenTitle = !computer
    ? error
      ? "Browser status unavailable"
      : "Connecting to the agent browser"
    : status === "unavailable"
      ? "Browser unavailable"
      : status === "installing"
        ? "Installing the browser"
        : status === "starting"
          ? "Starting the browser"
          : status === "error"
            ? "Browser needs attention"
            : "Browser is off";
  const screenDescription = !computer
    ? error
      ? "ADE could not reach its local service. Check again to refresh the browser's status."
      : "Checking this project's browser."
    : status === "unavailable"
      ? (computer.detail ?? "ADE's headless browser cannot run on this system.")
      : status === "stopped"
        ? "Start this project's browser when you want to watch the agent run and test its work."
        : status === "error"
          ? (computer.detail ?? "The browser did not start. Review the details and try again.")
          : status === "installing"
            ? progress?.unpacking
              ? "Unpacking Chrome for Testing. This happens once."
              : "ADE downloads its own copy of Chrome for Testing once, then reuses it for every project."
            : (computer.detail ?? "The browser will appear here in a moment.");
  const checks = sessionDetail ? summarizeChecks(sessionDetail.checks) : null;
  const added = sessionDetail?.changes.reduce((n, c) => n + c.added, 0) ?? 0;
  const removed = sessionDetail?.changes.reduce((n, c) => n + c.removed, 0) ?? 0;

  const mediaInfoClasses =
    dock === "bottom"
      ? "flex flex-col @[40rem]/computer:flex-row @[40rem]/computer:items-start @[40rem]/computer:gap-4 @[40rem]/computer:p-3"
      : "flex flex-1 flex-col";
  const mediaBoxClasses =
    dock === "bottom"
      ? "w-full flex-none pb-3 @[40rem]/computer:w-[min(26rem,45%)] @[40rem]/computer:shrink-0 @[40rem]/computer:pb-0"
      : "flex-none pb-3";

  const placeholder = (
    <div
      className={`relative flex aspect-[16/10] flex-col rounded-xl border border-line bg-deck text-center text-deck-foreground ${dock === "side" ? "mx-3" : ""} @max-[20rem]/computer:aspect-auto`}
    >
      <div className="flex-1 grid place-items-center px-5 py-6 @max-[20rem]/computer:px-4 @max-[20rem]/computer:py-5">
        <div className="relative w-full max-w-sm">
          <div className="mx-auto mb-3 grid place-items-center">
            {preparing || (!computer && !error) ? (
              <LoaderCircle
                className="size-5 animate-spin text-amber"
                strokeWidth={1.5}
                aria-hidden
              />
            ) : (
              <Globe className="size-5 text-deck-foreground/50" strokeWidth={1.5} aria-hidden />
            )}
          </div>
          <div className="text-xs text-deck-foreground/50 @max-[20rem]/computer:hidden">
            {project.name} · local browser
          </div>
          <h2 className="mt-2 text-lg font-medium">{screenTitle}</h2>
          <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-deck-foreground/65 @max-[20rem]/computer:line-clamp-3">
            {screenDescription}
          </p>
          {status === "installing" && progress && (
            <div className="mx-auto mt-4 max-w-xs">
              <div
                className="h-1.5 overflow-hidden rounded-full bg-deck-foreground/10"
                role="progressbar"
                aria-label="Browser download"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div
                  className={`h-full rounded-full bg-amber transition-[width] duration-500 ${progress.unpacking ? "animate-pulse-soft" : ""}`}
                  style={{ width: `${progress.unpacking ? 100 : percent}%` }}
                />
              </div>
              <div className="mt-2 font-mono text-xs tabular-nums text-deck-foreground/50">
                {progress.unpacking
                  ? "unpacking"
                  : `${megabytes(progress.downloadedBytes)} of ${megabytes(progress.totalBytes)} MB`}
              </div>
            </div>
          )}
          {computer?.setupCommand && (
            <div className="mx-auto mt-4 flex max-w-xs items-center gap-2 rounded-lg border border-deck-foreground/10 bg-deck-foreground/[0.04] py-1 pr-1 pl-3 text-left">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-deck-foreground/85">
                {computer.setupCommand}
              </code>
              <button
                type="button"
                onClick={() => void copySetup()}
                aria-label="Copy setup command"
                title="Copy"
                className="grid size-7 shrink-0 place-items-center rounded-md text-deck-foreground/60 transition-colors hover:bg-deck-foreground/10 hover:text-deck-foreground focus-visible:outline-2 focus-visible:outline-amber"
              >
                {copied ? (
                  <Check className="size-4" strokeWidth={1.5} aria-hidden />
                ) : (
                  <Copy className="size-4" strokeWidth={1.5} aria-hidden />
                )}
              </button>
            </div>
          )}
          {(status === "stopped" || status === "error") && (
            <button
              type="button"
              onClick={() => void run("start")}
              disabled={busy}
              className="btn-amber mt-5 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs disabled:opacity-50 @max-[20rem]/computer:w-full"
            >
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" strokeWidth={1.5} aria-hidden />
              ) : (
                <Globe className="size-4" strokeWidth={1.5} aria-hidden />
              )}
              {status === "error" ? "Try starting again" : "Start browser"}
            </button>
          )}
          {needsStatusRetry && (
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
              className="btn-quiet mt-5 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs disabled:opacity-50 @max-[20rem]/computer:w-full"
            >
              <RotateCw className="size-4" strokeWidth={1.5} aria-hidden />
              Check again
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-deck-foreground/10 px-4 py-2 font-mono text-xs tabular-nums text-deck-foreground/50">
        <span className="truncate">
          {computer?.screen
            ? `${computer.screen.width} × ${computer.screen.height}`
            : "project workspace"}
        </span>
        <span className="shrink-0">{preparing ? "setting up" : "ready when you are"}</span>
      </div>
    </div>
  );

  const browserScreen =
    browser.place !== "dock" ? (
      <div className="mx-3 flex flex-col items-start gap-3 rounded-xl border border-line bg-surface-muted p-4">
        <p className="text-[13px] text-[var(--text-secondary)]">
          {browser.place === "float" ? "Showing in floating window" : "Browser is hidden"}
        </p>
        <button
          type="button"
          onClick={() => browser.setPlace("dock")}
          className="btn-quiet px-3 py-1.5 text-xs"
        >
          Dock here
        </button>
      </div>
    ) : !browser.status ? (
      <div className="mx-3 rounded-xl border border-line bg-surface-muted p-4 text-xs text-dim">
        Checking the browser…
      </div>
    ) : !browser.status.available ? (
      <div className="mx-3 rounded-xl border border-line bg-surface-muted p-4 text-xs leading-snug text-dim">
        {browser.status.reason ?? "The browser is not available yet."}
      </div>
    ) : (
      <div ref={browserFrameRef} className="flex flex-col">
        <BrowserChromeRow frameRef={browserFrameRef} />
        <BrowserSurface mode="dock" className="aspect-[16/10] w-full" />
      </div>
    );

  const media = running ? <div className="flex flex-col pt-3">{browserScreen}</div> : placeholder;

  const info = (
    <>
      <div className="px-4 pb-4">
        <p className="mt-1 text-xs leading-snug text-dim">
          {running
            ? control
              ? "Your mouse and keyboard reach the agent's browser. Hand it back when you're done so you don't collide with the agent."
              : "The agent starts the app, opens it here, and tests it like a person would. Watch live, or take control to help."
            : "The task stays beside the browser. When the agent opens the app, it appears here."}
        </p>
        {error && (
          <p role="alert" className="mt-2 text-xs leading-snug text-danger">
            {error}
          </p>
        )}
        {browser.actionError && (
          <p role="alert" className="mt-2 text-xs leading-snug text-danger">
            {browser.actionError}
          </p>
        )}
        {running && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void browser.changeControl(control ? "release" : "take")}
              aria-pressed={control}
              className={`${control ? "btn-amber" : "btn-quiet"} px-3 py-1.5 text-xs`}
            >
              {control ? "Hand back" : "Take control"}
            </button>
            <button
              type="button"
              onClick={() => void run("stop")}
              disabled={busy}
              className="btn-quiet px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Turn off
            </button>
          </div>
        )}
      </div>
      <div className={dock === "bottom" ? "" : "mt-auto"}>
        <div className="border-t border-line pb-2">
          <div className="flex h-10 items-center gap-3 border-b border-line px-4">
            <h3 className="label-section">Details</h3>
            <span className="ml-auto text-xs text-dim">{session ? "this task" : "project"}</span>
          </div>
          {computer && status !== "unavailable" && (
            <div className={DETAIL_ROW}>
              <span className={DETAIL_LABEL}>Browser profile</span>
              <span
                className="flex shrink-0 items-center gap-1 text-xs text-dim"
                role="group"
                aria-label="Browser profile"
              >
                {PROFILE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={computer.profile === option.value}
                    title={option.title}
                    disabled={busy}
                    onClick={() => void apply(computerProfile(project.id, option.value))}
                    className={`h-6 rounded-xs px-2 transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-amber ${computer.profile === option.value ? "bg-surface-muted text-ink ring-1 ring-line ring-inset" : "hover:text-ink"}`}
                  >
                    {option.label}
                  </button>
                ))}
                {computer.profile === "default" && (
                  <>
                    <span aria-hidden>·</span>
                    <button
                      type="button"
                      onClick={() => void run("clear")}
                      disabled={busy}
                      title="Sign out everywhere: clear this project's cookies, storage and cache"
                      className="h-6 rounded-xs px-2 transition-colors hover:text-danger disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-amber"
                    >
                      clear
                    </button>
                  </>
                )}
              </span>
            </div>
          )}
          <div className={DETAIL_ROW}>
            <span className={DETAIL_LABEL}>Checks</span>
            <span className={`${DETAIL_VALUE} ${checks?.verified ? "text-teal" : ""}`}>
              {checks ? checks.text : "—"}
            </span>
          </div>
          <div className={DETAIL_ROW}>
            <span className={DETAIL_LABEL}>Working tree diff</span>
            <span className={DETAIL_VALUE}>{session ? `+${added} / −${removed}` : "—"}</span>
          </div>
          <div className={DETAIL_ROW}>
            <span className={DETAIL_LABEL}>Agent output</span>
            <span className={DETAIL_VALUE}>
              {session ? `${sessionLogs.data?.lines.length ?? 0} lines` : "—"}
            </span>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <aside
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto bg-panel @container/computer"
      aria-label="Agent browser"
    >
      <div className="flex min-h-11 items-center justify-between border-b border-line px-4 py-2 gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Agent browser</div>
          <div className="mt-0.5 truncate text-xs text-dim">{project.name}</div>
        </div>
        <span className="ml-3 inline-flex shrink-0 items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span
            className={`size-1.5 rounded-full ${running ? "bg-teal" : preparing ? "bg-amber animate-pulse-soft" : status === "error" ? "bg-danger" : "bg-dim/60"}`}
            aria-hidden
          />
          {!computer
            ? error
              ? "disconnected"
              : "checking"
            : running
              ? control
                ? "in your control"
                : "live"
              : status}
        </span>
      </div>
      <div className={mediaInfoClasses}>
        <div className={mediaBoxClasses}>{media}</div>
        <div className="flex min-w-0 flex-1 flex-col">{info}</div>
      </div>
    </aside>
  );
}
