import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Globe, LoaderCircle, RotateCw } from "lucide-react";
import type { AgentComputer, Project, SessionSummary } from "@/lib/ade/types";
import {
  answerDevCommand,
  computerControl,
  computerProfile,
  createComputerProfile,
  renameComputerProfile,
  deleteComputerProfile,
  browserImportSources,
  importBrowserCookies,
  computerStatus,
  forgetDevCommand,
  useAde,
  useSession,
  useSessionLogs,
} from "@/lib/ade/store";
import { copyText } from "@/lib/ade/clipboard";
import { getBrowserLocalServers } from "@/lib/ade/browser/api";
import { BROWSER_OPEN_EVENT } from "@/lib/ade/browser/openInPreview.mjs";
import { askConfirm, warnUser } from "@/lib/ade/userNotices";
import { summarizeChecks } from "./ChecksList";
import { DevCommandRequestCard } from "./DevCommandRequestCard";
import { BrowserChromeRow } from "./browser/BrowserChromeRow";
import { BrowserSurface } from "./browser/BrowserSurface";
import { useBrowserPreviewState } from "./browser/browserPreviewContext";
import { useBrowserPlacement } from "./browser/browserPresentationContext";
import type { RightDock, ComputerTone } from "./rightPaneTypes";

const megabytes = (bytes: number) => Math.round(bytes / 1_000_000);

const DETAIL_ROW = "flex h-9 items-center justify-between gap-3 px-4";
const DETAIL_LABEL = "min-w-0 truncate text-[13px] text-[var(--text-secondary)]";
const DETAIL_VALUE = "shrink-0 font-mono text-xs tabular-nums text-ink";
type RecentBrowserUrl = { url: string; title?: string; favicon?: string; visitedAt?: number };

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
  const { refresh: refreshWorkspace, state } = useAde();
  const computerQuery = useQuery({
    queryKey: ["computer", project.id, session?.id],
    queryFn: () => computerStatus(project.id, session?.id),
    staleTime: Infinity,
  });
  const computer = computerQuery.data ?? null;
  const sessionDetail = useSession(session?.id ?? "").data;
  const sessionLogs = useSessionLogs(session?.id ?? "");
  const [error, setError] = useState("");
  const browser = useBrowserPreviewState();
  const placement = useBrowserPlacement();
  // A page the agent opens floats over the conversation when this docked tab is not on screen.
  const setPlacementVisible = placement.setVisible;
  useEffect(() => {
    setPlacementVisible(active);
    return () => setPlacementVisible(true);
  }, [active, setPlacementVisible]);
  // Control is shared with the browser preview and the agent's tools, so it lives in the provider.
  const control = browser.control?.controller === "you";
  const devServer = state.processes.find(
    (process) =>
      process.projectId === project.id && process.status === "running" && process.port > 0,
  );
  // Servers already running on this machine, as T3's preview empty state lists.
  const localServersQuery = useQuery({
    queryKey: ["browser-local-servers", project.id, session?.id],
    queryFn: () => getBrowserLocalServers(project.id, session?.id),
    enabled: active && !!browser.status?.available,
    refetchInterval: active ? 3000 : false,
    staleTime: 2000,
  });
  const localServers = (localServersQuery.data ?? []).filter(
    (server) => server.port !== devServer?.port,
  );
  const [recentUrls, setRecentUrls] = useState<RecentBrowserUrl[]>([]);
  const activeTab = browser.tabs?.tabs.find((tab) => tab.id === browser.tabs?.activeId);
  const activeTabProfile = activeTab ? (activeTab.profileId ?? computer?.profile) : undefined;
  const historyKey =
    session?.id && activeTabProfile && activeTabProfile !== "incognito"
      ? `ade.browser.history.${project.id}.${session.id}${activeTabProfile === "default" ? "" : `.${activeTabProfile}`}`
      : null;
  const previousHistoryKey = useRef<string | null>(null);
  useEffect(() => {
    const sameConversation = previousHistoryKey.current === historyKey;
    previousHistoryKey.current = historyKey;
    if (!historyKey) {
      setRecentUrls([]);
      return;
    }
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem(historyKey) ?? "[]");
      const previous: RecentBrowserUrl[] = Array.isArray(stored)
        ? stored
            .flatMap((entry: unknown): RecentBrowserUrl[] => {
              const value = typeof entry === "string" ? { url: entry } : entry;
              if (
                !value ||
                typeof value !== "object" ||
                !("url" in value) ||
                typeof value.url !== "string" ||
                !/^https?:\/\//i.test(value.url)
              )
                return [];
              const record = value as RecentBrowserUrl;
              return [
                {
                  url: record.url,
                  ...(typeof record.title === "string"
                    ? { title: record.title.slice(0, 512) }
                    : {}),
                  ...(typeof record.favicon === "string" &&
                  record.favicon.length <= 20_000 &&
                  /^data:image\/png;base64,[a-z0-9+/]+=*$/i.test(record.favicon)
                    ? { favicon: record.favicon }
                    : {}),
                  ...(Number.isFinite(record.visitedAt) ? { visitedAt: record.visitedAt } : {}),
                },
              ];
            })
            .slice(0, 10)
        : [];
      const url = browser.nav?.url;
      const previousVisit = previous.find((entry) => entry.url === url);
      const next =
        sameConversation && url && activeTab?.url === url && /^https?:\/\//i.test(url)
          ? [
              {
                url,
                ...(browser.nav?.title ? { title: browser.nav.title } : {}),
                ...(activeTab.favicon
                  ? { favicon: activeTab.favicon }
                  : previousVisit?.favicon
                    ? { favicon: previousVisit.favicon }
                    : {}),
                visitedAt:
                  previous[0]?.url === url ? (previousVisit?.visitedAt ?? Date.now()) : Date.now(),
              },
              ...previous.filter((entry) => entry.url !== url),
            ].slice(0, 10)
          : previous;
      window.localStorage.setItem(historyKey, JSON.stringify(next));
      setRecentUrls(next);
    } catch {
      setRecentUrls([]);
    }
  }, [historyKey, browser.nav?.url, browser.nav?.title, activeTab?.url, activeTab?.favicon]);
  const openPreviewUrl = async (url: string) => {
    if (control || (await browser.changeControl("take"))) browser.send({ type: "navigate", url });
  };
  // A chat or terminal link: navigate once the page stream can carry the message.
  const [requestedUrl, setRequestedUrl] = useState<string | null>(null);
  const openingUrl = useRef<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const url = (event as CustomEvent<{ url?: string }>).detail?.url;
      if (url) setRequestedUrl(url);
    };
    window.addEventListener(BROWSER_OPEN_EVENT, open);
    return () => window.removeEventListener(BROWSER_OPEN_EVENT, open);
  }, []);
  const streamOpen = browser.streamStatus === "open";
  const browserAvailable = !!browser.status?.available;
  useEffect(() => {
    const url = requestedUrl;
    if (!url || !streamOpen || !browserAvailable || openingUrl.current === url) return;
    openingUrl.current = url;
    void (async () => {
      if (!control && !(await browser.changeControl("take"))) {
        openingUrl.current = null;
        return;
      }
      if (browser.send({ type: "navigate", url }))
        setRequestedUrl((current) => (current === url ? null : current));
      openingUrl.current = null;
    })();
  }, [requestedUrl, streamOpen, browserAvailable, control, browser]);
  const removeRecentUrl = (url: string) => {
    const next = recentUrls.filter((entry) => entry.url !== url);
    setRecentUrls(next);
    if (historyKey) {
      try {
        window.localStorage.setItem(historyKey, JSON.stringify(next));
      } catch {
        /* Storage is optional. */
      }
    }
  };
  const [busy, setBusy] = useState(false);
  const [profileEditor, setProfileEditor] = useState<"create" | "rename" | "import" | null>(null);
  const [profileName, setProfileName] = useState("");
  const [importSources, setImportSources] = useState<{ id: string; name: string }[]>([]);
  const [importSource, setImportSource] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const autoStarted = useRef(new Set<string>());
  const stoppedByUser = useRef(new Set<string>());
  const browserKey = JSON.stringify([project.id, session?.id ?? null]);
  useEffect(() => {
    autoStarted.current.delete(browserKey);
  }, [browserKey]);
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
        queryKey: ["computer", project.id, session?.id],
        queryFn: () => computerStatus(project.id, session?.id),
        staleTime: 0,
      });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [project.id, session?.id, queryClient]);

  const apply = useCallback(
    async (next: Promise<AgentComputer>) => {
      setBusy(true);
      try {
        queryClient.setQueryData(["computer", project.id, session?.id], await next);
        setError("");
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [project.id, session?.id, queryClient],
  );
  const run = (op: "start" | "stop" | "clear") => {
    if (op === "stop") stoppedByUser.current.add(browserKey);
    else if (op === "start") stoppedByUser.current.delete(browserKey);
    return apply(computerControl(project.id, op, session?.id));
  };

  // Launching takes about a second, so opening the tab starts the browser. Only once per project:
  // after Turn off it stays off until started again.
  useEffect(() => {
    if (
      !active ||
      status !== "stopped" ||
      autoStarted.current.has(browserKey) ||
      stoppedByUser.current.has(browserKey)
    )
      return;
    autoStarted.current.add(browserKey);
    void apply(computerControl(project.id, "start", session?.id));
  }, [active, status, project.id, session?.id, browserKey, apply]);

  const forgetCommand = async () => {
    setForgetting(true);
    try {
      await forgetDevCommand(project.id);
      await refreshWorkspace();
    } catch (e) {
      void warnUser(e instanceof Error ? e.message : String(e));
    } finally {
      setForgetting(false);
    }
  };
  const { devCommand, pendingDevCommand } = project;
  const devCommandTitle = devCommand
    ? `${devCommand.command}${devCommand.cwd === "." ? "" : ` (in ${devCommand.cwd})`}${devCommand.port ? ` on port ${devCommand.port}` : ""}`
    : "";

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
  const changes = sessionDetail?.changes ?? [];
  const checks = sessionDetail ? summarizeChecks(sessionDetail.checks ?? []) : null;
  const added = changes.reduce((n, c) => n + c.added, 0);
  const removed = changes.reduce((n, c) => n + c.removed, 0);

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
    placement.place !== "dock" ? (
      <div className="mx-3 flex flex-col items-start gap-3 rounded-xl border border-line bg-surface-muted p-4">
        <p className="text-[13px] text-[var(--text-secondary)]">
          {placement.place === "float" ? "Showing in floating window" : "Browser is hidden"}
        </p>
        <button
          type="button"
          onClick={() => placement.setPlace("dock")}
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
        <BrowserChromeRow
          frameRef={browserFrameRef}
          sessionId={session?.id}
          profiles={computer?.profiles ?? []}
          running={session?.status === "working" || session?.status === "verifying"}
        />
        <BrowserSurface
          mode="dock"
          className="aspect-[16/10] w-full"
          emptyState={
            <div className="pointer-events-auto grid max-h-full w-full max-w-sm justify-items-center gap-3 overflow-y-auto py-4">
              <Globe className="size-5 text-dim" strokeWidth={1.5} aria-hidden />
              <p className="m-0 text-sm font-medium text-ink">No preview yet</p>
              {devServer ? (
                <button
                  type="button"
                  className="btn-quiet px-3 py-1.5 text-xs"
                  onClick={() => void openPreviewUrl(`http://localhost:${devServer.port}`)}
                >
                  Open local server · localhost:{devServer.port}
                </button>
              ) : (
                <p className="m-0 text-xs text-dim">
                  Enter a URL above, or start the project’s dev server to open it here.
                </p>
              )}
              {localServers.length ? (
                <div className="grid w-full gap-1 text-left">
                  <p className="m-0 text-xs font-medium text-dim">Local servers</p>
                  {localServers.slice(0, 6).map((server) => (
                    <button
                      key={server.port}
                      type="button"
                      onClick={() => void openPreviewUrl(server.url)}
                      title={server.url}
                      className="flex min-w-0 items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left text-xs text-ink hover:bg-surface-muted"
                    >
                      <Globe className="size-4 shrink-0 text-dim" aria-hidden />
                      <span className="truncate">{server.title || `localhost:${server.port}`}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-dim">
                        {server.processName ? `${server.processName} · ` : ""}
                        {server.port}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {recentUrls.length ? (
                <div className="grid w-full gap-1 text-left">
                  <p className="m-0 text-xs font-medium text-dim">Recently used</p>
                  {recentUrls.slice(0, 8).map(({ url, title, favicon, visitedAt }) => (
                    <div
                      key={url}
                      className="flex min-w-0 items-center rounded-md border border-line"
                    >
                      <button
                        type="button"
                        onClick={() => void openPreviewUrl(url)}
                        title={url}
                        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs text-ink hover:bg-surface-muted"
                      >
                        {favicon ? (
                          <img src={favicon} alt="" className="size-4 shrink-0 object-contain" />
                        ) : (
                          <Globe className="size-4 shrink-0 text-dim" aria-hidden />
                        )}
                        <span className="grid min-w-0 gap-0.5">
                          <span className="truncate">{title || url}</span>
                          {title || visitedAt ? (
                            <span className="truncate text-[10px] text-dim">
                              {title ? url : ""}
                              {title && visitedAt ? " · " : ""}
                              {visitedAt ? new Date(visitedAt).toLocaleDateString() : ""}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRecentUrl(url)}
                        aria-label={`Remove ${url} from history`}
                        className="px-2 py-1.5 text-xs text-dim hover:text-ink"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          }
        />
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
        {pendingDevCommand && (
          <div className="mt-3">
            <DevCommandRequestCard
              key={pendingDevCommand.id}
              request={pendingDevCommand}
              onAnswer={async (allow) => {
                await answerDevCommand(project.id, pendingDevCommand.id, allow);
                await refreshWorkspace();
              }}
            />
          </div>
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
            <div className="flex flex-col gap-2 px-4 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className={DETAIL_LABEL}>Default browser profile</span>
                <select
                  aria-label="Browser profile"
                  disabled={busy}
                  value={computer.profile}
                  onChange={(event) =>
                    void apply(computerProfile(project.id, event.target.value, session?.id))
                  }
                  className="max-w-[60%] rounded border border-line bg-panel px-2 py-1 text-xs text-ink disabled:opacity-50"
                >
                  {(
                    computer.profiles ?? [
                      { id: "default", name: "Default" },
                      { id: "incognito", name: "Incognito" },
                    ]
                  ).map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap justify-end gap-2 text-xs">
                <button
                  type="button"
                  disabled={busy}
                  className="btn-quiet px-2 py-1"
                  onClick={() => {
                    setProfileName("");
                    setProfileEditor("create");
                  }}
                >
                  New profile
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="btn-quiet px-2 py-1"
                  onClick={async () => {
                    setProfileEditor("import");
                    setImportMessage("");
                    setImportSources([]);
                    setImportSource("");
                    setBusy(true);
                    try {
                      const result = await browserImportSources(project.id, session?.id);
                      setImportSources(result.sources);
                      setImportSource(result.sources[0]?.id ?? "");
                    } catch (cause) {
                      setImportMessage(
                        cause instanceof Error ? cause.message : "Could not find browser profiles.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Import cookies
                </button>
                {computer.profile !== "default" && computer.profile !== "incognito" ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      className="btn-quiet px-2 py-1"
                      onClick={() => {
                        setProfileName(
                          computer.profiles.find((profile) => profile.id === computer.profile)
                            ?.name ?? "",
                        );
                        setProfileEditor("rename");
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="btn-quiet px-2 py-1 text-danger"
                      onClick={async () => {
                        const name =
                          computer.profiles.find((profile) => profile.id === computer.profile)
                            ?.name ?? "this profile";
                        if (
                          await askConfirm({
                            title: `Delete ${name}?`,
                            description:
                              "This removes the profile's cookies, site data, and cache. Conversations using it will switch to the default profile.",
                            confirmLabel: "Delete profile",
                          })
                        )
                          await apply(
                            deleteComputerProfile(project.id, computer.profile, session?.id),
                          );
                      }}
                    >
                      Delete
                    </button>
                  </>
                ) : null}
                {computer.profile !== "incognito" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run("clear")}
                    className="btn-quiet px-2 py-1"
                    title="Clear the default profile's cookies, storage and cache"
                  >
                    Clear default data
                  </button>
                ) : null}
              </div>
              <details className="rounded border border-line px-2 py-1.5 text-xs text-dim">
                <summary className="cursor-pointer text-ink">Use system passkeys</summary>
                <p className="mt-2 leading-relaxed">
                  For native passkey prompts, restart ADE with <code>ADE_BROWSER_HEADED=1</code> and
                  <code> ADE_BROWSER_EXECUTABLE</code> set to the absolute path of an installed full
                  Chrome or Chromium browser. A desktop must be available on the computer running
                  ADE.
                </p>
                <p className="mt-2 leading-relaxed">
                  The browser opens a separate window for system prompts. Its profiles and sign-ins
                  are separate from the default preview; import cookies if needed. Unset both
                  settings and restart ADE to return to the default preview. Clearing a profile
                  removes its stored data in both modes.
                </p>
              </details>
              {profileEditor === "import" ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!importSource) return;
                    setBusy(true);
                    setImportMessage("");
                    try {
                      const result = await importBrowserCookies(
                        project.id,
                        importSource,
                        session?.id,
                        browser.tabs?.activeId,
                        activeTabProfile,
                      );
                      setImportMessage(
                        `Imported ${result.imported} cookies; skipped ${result.skipped}.${result.keyringMissing ? " Some cookies require an unlocked system key store; on Linux, install Python 3 and libsecret, or secret-tool." : ""} Reload the preview to use them.`,
                      );
                    } catch (cause) {
                      setImportMessage(
                        cause instanceof Error
                          ? cause.message
                          : "Could not import browser cookies.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <p className="text-xs text-dim">
                    Copy browser cookies into the current tab's profile, including signed-in
                    sessions. Your system may ask to unlock its key store.
                  </p>
                  <select
                    aria-label="Browser profile to import from"
                    className="rounded border border-line bg-panel px-2 py-1 text-xs"
                    disabled={busy || !importSources.length}
                    value={importSource}
                    onChange={(event) => setImportSource(event.target.value)}
                  >
                    {importSources.length ? (
                      importSources.map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.name}
                        </option>
                      ))
                    ) : (
                      <option value="">
                        {busy ? "Looking for profiles…" : "No supported browser profiles found"}
                      </option>
                    )}
                  </select>
                  {importMessage ? (
                    <p role="status" className="text-xs text-dim">
                      {importMessage}
                    </p>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <button
                      type="submit"
                      disabled={busy || !importSource}
                      className="btn-amber px-2 py-1 text-xs disabled:opacity-50"
                    >
                      Import cookies
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="btn-quiet px-2 py-1 text-xs"
                      onClick={() => setProfileEditor(null)}
                    >
                      Close
                    </button>
                  </div>
                </form>
              ) : profileEditor ? (
                <form
                  className="flex gap-2"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const name = profileName.trim();
                    if (!name) return;
                    const operation =
                      profileEditor === "create"
                        ? createComputerProfile(project.id, name, session?.id)
                        : renameComputerProfile(project.id, computer.profile, name, session?.id);
                    if (await apply(operation)) {
                      setProfileEditor(null);
                      setProfileName("");
                    }
                  }}
                >
                  <input
                    autoFocus
                    aria-label="Profile name"
                    maxLength={48}
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                    className="min-w-0 flex-1 rounded border border-line bg-paper px-2 py-1 text-xs"
                  />
                  <button
                    type="submit"
                    disabled={busy || !profileName.trim()}
                    className="btn-amber px-2 py-1 text-xs disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn-quiet px-2 py-1 text-xs"
                    onClick={() => setProfileEditor(null)}
                  >
                    Cancel
                  </button>
                </form>
              ) : null}
            </div>
          )}
          {devCommand && (
            <div className={DETAIL_ROW}>
              <span className={`${DETAIL_LABEL} shrink-0`}>Dev command</span>
              <span className="flex min-w-0 items-center gap-1">
                <span
                  className="min-w-0 truncate font-mono text-xs text-ink"
                  title={devCommandTitle}
                >
                  {devCommand.command}
                </span>
                <button
                  type="button"
                  onClick={() => void forgetCommand()}
                  disabled={forgetting}
                  title="ADE asks you again before the next start; a running server keeps running"
                  className="h-6 shrink-0 rounded-xs px-2 text-xs text-dim transition-colors hover:text-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-amber"
                >
                  Forget
                </button>
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
