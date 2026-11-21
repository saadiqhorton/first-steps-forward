import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  LoaderCircle,
  Maximize2,
  Minimize2,
  RotateCcw,
  RotateCw,
  Square,
  X,
} from "lucide-react";
import { BrowserPreviewProvider } from "@/components/ade/browser/BrowserPreviewProvider";
import { BrowserSurface } from "@/components/ade/browser/BrowserSurface";
import { useBrowserPreviewState } from "@/components/ade/browser/browserPreviewContext";
import { useBrowserPlacement } from "@/components/ade/browser/browserPresentationContext";
import {
  NEEDS_YOU,
  previewChange,
  previewRunning,
  useCustomizeAction,
  type Change,
  type ChangePreview,
} from "@/lib/ade/customizeApi";
import { computerControl, computerStatus } from "@/lib/ade/store";

/** The hidden project the private copy's sessions (and their agent browser) belong to. */
const SELF_PROJECT = "ade-self";
const TEST_DATA = "Test data, not your projects";

export const canTry = (change: Change) => NEEDS_YOU.includes(change.status);

export function usePreviewAction() {
  return useCustomizeAction(({ id, action }: { id: string; action: "start" | "stop" }) =>
    previewChange(id, action),
  );
}

/** Below `lg` the workbench shows one pane at a time; a running preview takes the screen. */
const PHONE_QUERY = "(max-width: 1023px)";
const isPhone = () => typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;

/** `127.0.0.1:43123` and the page path, from the preview's own address. */
function splitAddress(url: string) {
  try {
    const parsed = new URL(url);
    const rest = `${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}${parsed.hash}`;
    return { host: parsed.host, rest };
  } catch {
    return { host: url.replace(/^https?:\/\//, ""), rest: "" };
  }
}

/** The Preview tab: try the change in a separate ADE, shown in the agent browser. */
export function PreviewPanel({
  change,
  expanded = false,
  onExpand,
}: {
  change: Change;
  expanded?: boolean;
  onExpand?: (expanded: boolean) => void;
}) {
  const action = usePreviewAction();
  const preview = change.preview;
  const error = action.error instanceof Error ? action.error.message : null;
  const start = () => action.mutate({ id: change.id, action: "start" });
  const stop = () => action.mutate({ id: change.id, action: "stop" });

  // Phones: when the preview comes up, it opens full screen (with a way back).
  const running = previewRunning(change);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (running && !wasRunning.current && isPhone()) onExpand?.(true);
    wasRunning.current = running;
  }, [running, onExpand]);

  if (change.status === "kept" || change.status === "removed")
    return (
      <p className="text-ui text-dim">
        {change.status === "kept"
          ? "This change is part of your version now, so there is nothing separate to try."
          : "This change was removed."}
      </p>
    );

  return (
    <div className={running ? "flex min-h-0 flex-1 flex-col gap-3" : "space-y-3"}>
      {preview.status === "running" && preview.url ? (
        <>
          <PreviewBrowser
            url={preview.url}
            sessionId={change.sessionId}
            expanded={expanded}
            onExpand={onExpand}
          />
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-dim">
              <span className="size-1.5 shrink-0 rounded-full bg-teal" aria-hidden />
              {TEST_DATA}
            </span>
            <button
              type="button"
              onClick={stop}
              disabled={action.isPending}
              className="btn-quiet ml-auto inline-flex min-h-[var(--control-height-md)] items-center gap-1.5 px-3 text-xs lg:min-h-0 lg:py-1.5"
            >
              <Square className="size-3.5" strokeWidth={1.5} aria-hidden />
              Stop preview
            </button>
          </div>
          {!expanded && (
            <p className="shrink-0 text-xs leading-5 text-dim">
              Your version of ADE with this change, running beside the one you use. It starts empty,
              so add a test project to try things out.
            </p>
          )}
        </>
      ) : preview.status === "starting" ? (
        <Starting preview={preview} onCancel={stop} busy={action.isPending} />
      ) : preview.status === "failed" ? (
        <Failed
          preview={preview}
          onRetry={start}
          busy={action.isPending}
          allowed={canTry(change)}
        />
      ) : (
        <NotTried allowed={canTry(change)} busy={action.isPending} onStart={start} />
      )}
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A browser frame waiting for the preview: the address it will get, and Try it in the middle. */
function NotTried({
  allowed,
  busy,
  onStart,
}: {
  allowed: boolean;
  busy: boolean;
  onStart: () => void;
}) {
  return (
    <div
      className="flex flex-col overflow-hidden rounded-md border border-line"
      aria-label="Preview"
    >
      <div
        className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-panel px-2"
        aria-hidden
      >
        <span className="grid size-7 place-items-center text-dim opacity-40">
          <ArrowLeft className="size-4" strokeWidth={1.5} />
        </span>
        <span className="grid size-7 place-items-center text-dim opacity-40">
          <ArrowRight className="size-4" strokeWidth={1.5} />
        </span>
        <span className="grid size-7 place-items-center text-dim opacity-40">
          <RotateCw className="size-4" strokeWidth={1.5} />
        </span>
        <span className="flex h-7 min-w-0 flex-1 items-center rounded-lg bg-paper px-3 font-mono text-xs text-dim ring-1 ring-line ring-inset">
          127.0.0.1:—
        </span>
      </div>
      <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-3 bg-paper px-6 text-center">
        <p className="text-ui font-medium text-ink">Try this change before you keep it</p>
        <p className="max-w-xs text-xs leading-5 text-[color:var(--text-secondary)]">
          {allowed
            ? "Starts your changed ADE with test data, next to this one."
            : "You can try it when the agent and the checks finish."}
        </p>
        {allowed && (
          <button
            type="button"
            onClick={onStart}
            disabled={busy}
            className="btn-amber inline-flex min-h-[var(--control-height-md)] items-center gap-1.5 px-4 text-ui font-medium lg:min-h-0 lg:py-2"
          >
            <Eye className="size-4" strokeWidth={1.5} aria-hidden />
            {busy ? "Starting…" : "Try it"}
          </button>
        )}
      </div>
    </div>
  );
}

const STEPS = [
  { id: "build", label: "Build this version" },
  { id: "start", label: "Start ADE with test data" },
  { id: "open", label: "Open it here" },
] as const;

function Starting({
  preview,
  onCancel,
  busy,
}: {
  preview: ChangePreview;
  onCancel: () => void;
  busy: boolean;
}) {
  // Before the first step is known, the build step is the one under way.
  const current = preview.step === "start" ? 1 : 0;
  return (
    <div className="rounded-md border border-line px-4 py-4">
      <ol className="space-y-3" aria-label="Starting your version">
        {STEPS.map((step, index) => {
          const done = index < current;
          const active = index === current;
          const note =
            step.id === "build" && done
              ? preview.rebuilt
                ? "Built"
                : "Using the build from the checks"
              : null;
          return (
            <li key={step.id} className="flex items-start gap-3">
              <span className="mt-0.5 grid size-4 shrink-0 place-items-center" aria-hidden>
                {done ? (
                  <Check className="size-4 text-teal" strokeWidth={1.5} />
                ) : active ? (
                  <LoaderCircle className="size-4 animate-spin text-teal" strokeWidth={1.5} />
                ) : (
                  <span className="size-2 rounded-full bg-line" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-ui ${done || active ? "text-ink" : "text-dim"}`}>
                  {step.label}
                  <span className="sr-only">{done ? " (done)" : active ? " (running)" : ""}</span>
                </p>
                {note && <p className="text-xs text-dim">{note}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="btn-quiet mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
      >
        <Square className="size-3.5" strokeWidth={1.5} aria-hidden />
        Stop
      </button>
    </div>
  );
}

function Failed({
  preview,
  onRetry,
  busy,
  allowed,
}: {
  preview: ChangePreview;
  onRetry: () => void;
  busy: boolean;
  allowed: boolean;
}) {
  const where =
    preview.step === "build"
      ? "Stopped while building this version."
      : preview.step === "start"
        ? "Stopped while starting ADE."
        : null;
  return (
    <div className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3" role="alert">
      <p className="text-ui font-medium text-ink">{preview.error ?? "The preview stopped."}</p>
      {where && <p className="mt-1 text-xs text-[color:var(--text-secondary)]">{where}</p>}
      {preview.output && (
        <pre className="mt-2 max-h-48 overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap text-[color:var(--text-secondary)]">
          {preview.output}
        </pre>
      )}
      {allowed && (
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="btn-quiet mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium"
        >
          <RotateCcw className="size-3.5" strokeWidth={1.5} aria-hidden />
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * The agent browser of the change's conversation (project `ade-self`), opened on the preview.
 * Its own provider, so the Shell's browser for the active project is left alone.
 */
function PreviewBrowser({
  url,
  sessionId,
  expanded,
  onExpand,
}: {
  url: string;
  sessionId: string;
  expanded: boolean;
  onExpand: ((expanded: boolean) => void) | undefined;
}) {
  return (
    <BrowserPreviewProvider projectId={SELF_PROJECT} sessionId={sessionId}>
      <PreviewSurface url={url} sessionId={sessionId} expanded={expanded} onExpand={onExpand} />
    </BrowserPreviewProvider>
  );
}

const ICON_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-lg text-dim transition-colors hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber disabled:pointer-events-none disabled:opacity-40";

function PreviewSurface({
  url,
  sessionId,
  expanded,
  onExpand,
}: {
  url: string;
  sessionId: string;
  expanded: boolean;
  onExpand: ((expanded: boolean) => void) | undefined;
}) {
  const client = useQueryClient();
  const browser = useBrowserPreviewState();
  const placement = useBrowserPlacement();
  const [error, setError] = useState<string | null>(null);
  // The workspace's event stream follows the active project only, so poll this browser's state.
  const computerKey = ["computer", SELF_PROJECT, sessionId];
  const computer = useQuery({
    queryKey: computerKey,
    queryFn: () => computerStatus(SELF_PROJECT, sessionId),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 5000 : 1000),
  });
  const status = computer.data?.status;
  const asked = useRef(false);
  useEffect(() => {
    if (status !== "stopped" || asked.current) return;
    asked.current = true;
    computerControl(SELF_PROJECT, "start", sessionId)
      .then((next) => client.setQueryData(computerKey, next))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- computerKey is derived from sessionId
  }, [status, sessionId, client]);
  const running = status === "running";
  useEffect(() => {
    if (running) void client.invalidateQueries({ queryKey: ["browser", SELF_PROJECT, sessionId] });
  }, [running, sessionId, client]);

  // The page lays out for the space it has (no shrunken desktop), like a real window would.
  const { fillViewport, setFillViewport } = browser;
  useEffect(() => {
    if (!fillViewport) setFillViewport(true);
  }, [fillViewport, setFillViewport]);

  // Open the preview once the page stream can carry it. The person drives this page (no agent
  // works in a preview), so take control quietly before navigating.
  const opened = useRef<string | null>(null);
  const streamOpen = browser.streamStatus === "open";
  const available = !!browser.status?.available;
  useEffect(() => {
    if (!streamOpen || !available || opened.current === url) return;
    opened.current = url;
    void (async () => {
      if (browser.control?.controller !== "you" && !(await browser.changeControl("take"))) {
        opened.current = null;
        return;
      }
      if (!browser.send({ type: "navigate", url })) opened.current = null;
    })();
  }, [streamOpen, available, url, browser]);

  const notice =
    error ??
    (status === "unavailable" || status === "error"
      ? (computer.data?.detail ?? "ADE's browser cannot run here.")
      : null);
  if (notice)
    return (
      <div className="rounded-md border border-line bg-surface-muted px-4 py-3 text-xs leading-5 text-dim">
        <p className="text-ink">The preview is running, but ADE's browser is not.</p>
        <p className="mt-1">{notice}</p>
        <p className="mt-1 font-mono">{url}</p>
      </div>
    );
  if (placement.place !== "dock")
    return (
      <div className="flex items-center gap-3 rounded-md border border-line bg-surface-muted px-4 py-3">
        <p className="text-xs text-dim">The preview is showing elsewhere.</p>
        <button
          type="button"
          onClick={() => placement.setPlace("dock")}
          className="btn-quiet ml-auto px-3 py-1.5 text-xs"
        >
          Dock here
        </button>
      </div>
    );
  if (!available)
    return (
      <div className="flex items-center gap-2 rounded-md border border-line bg-surface-muted px-4 py-3 text-xs text-dim">
        <LoaderCircle className="size-4 animate-spin text-teal" strokeWidth={1.5} aria-hidden />
        {status === "installing"
          ? "Installing ADE's browser. This happens once."
          : "Opening ADE's browser"}
      </div>
    );

  const nav = browser.nav;
  const canOperate = browser.control?.controller === "you";
  // Before the page reports its address, show the one it is opening.
  const shown = nav?.url && nav.url !== "about:blank" ? nav.url : url;
  const { host, rest } = splitAddress(shown);
  const takeBack = canOperate ? undefined : "Opening your version…";
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-line">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
        <button
          type="button"
          aria-label="Back"
          title={takeBack ?? "Back"}
          disabled={!canOperate || !nav?.canGoBack}
          onClick={() => browser.send({ type: "history", delta: -1 })}
          className={ICON_BUTTON}
        >
          <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Forward"
          title={takeBack ?? "Forward"}
          disabled={!canOperate || !nav?.canGoForward}
          onClick={() => browser.send({ type: "history", delta: 1 })}
          className={ICON_BUTTON}
        >
          <ArrowRight className="size-4" strokeWidth={1.5} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={nav?.loading ? "Stop loading" : "Reload"}
          title={takeBack ?? (nav?.loading ? "Stop loading" : "Reload")}
          disabled={!canOperate}
          onClick={() => browser.send(nav?.loading ? { type: "stop-loading" } : { type: "reload" })}
          className={ICON_BUTTON}
        >
          {nav?.loading ? (
            <X className="size-4" strokeWidth={1.5} aria-hidden />
          ) : (
            <RotateCw className="size-4" strokeWidth={1.5} aria-hidden />
          )}
        </button>
        <p
          aria-label="Preview address"
          title={shown}
          className="flex h-7 min-w-0 flex-1 items-center rounded-lg bg-paper px-3 font-mono text-xs ring-1 ring-line ring-inset"
        >
          <span className="shrink-0 text-ink">{host}</span>
          <span className="min-w-0 truncate text-dim">{rest}</span>
        </p>
        {onExpand && (
          <button
            type="button"
            onClick={() => onExpand(!expanded)}
            aria-label={expanded ? "Back to the change" : "Expand preview"}
            title={expanded ? "Back to the change (Esc)" : "Expand preview"}
            className={ICON_BUTTON}
          >
            {expanded ? (
              <Minimize2 className="size-4" strokeWidth={1.5} aria-hidden />
            ) : (
              <Maximize2 className="size-4" strokeWidth={1.5} aria-hidden />
            )}
          </button>
        )}
      </div>
      <BrowserSurface
        mode="dock"
        controlBanner={false}
        className="min-h-64 w-full flex-1"
        emptyState={<p className="m-0 text-xs text-dim">Opening your version…</p>}
      />
    </div>
  );
}
