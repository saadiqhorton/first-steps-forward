import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Eye, LoaderCircle, RotateCcw, Square } from "lucide-react";
import { BrowserChromeRow } from "@/components/ade/browser/BrowserChromeRow";
import { BrowserPreviewProvider } from "@/components/ade/browser/BrowserPreviewProvider";
import { BrowserSurface } from "@/components/ade/browser/BrowserSurface";
import { useBrowserPreviewState } from "@/components/ade/browser/browserPreviewContext";
import { useBrowserPlacement } from "@/components/ade/browser/browserPresentationContext";
import {
  NEEDS_YOU,
  previewChange,
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

/** The Preview tab: try the change in a separate ADE, shown in the agent browser. */
export function PreviewPanel({ change }: { change: Change }) {
  const action = usePreviewAction();
  const preview = change.preview;
  const error = action.error instanceof Error ? action.error.message : null;
  const start = () => action.mutate({ id: change.id, action: "start" });
  const stop = () => action.mutate({ id: change.id, action: "stop" });

  if (change.status === "kept" || change.status === "removed")
    return (
      <p className="text-ui text-dim">
        {change.status === "kept"
          ? "This change is part of your version now, so there is nothing separate to try."
          : "This change was removed."}
      </p>
    );

  return (
    <div className="space-y-3">
      {preview.status === "running" && preview.url ? (
        <>
          <PreviewBrowser url={preview.url} sessionId={change.sessionId} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-dim">
              <span className="size-1.5 shrink-0 rounded-full bg-teal" aria-hidden />
              {TEST_DATA}
            </span>
            <button
              type="button"
              onClick={stop}
              disabled={action.isPending}
              className="btn-quiet ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <Square className="size-3.5" strokeWidth={1.5} aria-hidden />
              Stop preview
            </button>
          </div>
          <p className="text-xs leading-5 text-dim">
            This is your version of ADE with this change, running beside the one you use. It starts
            empty, so add a test project to try things out.
          </p>
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
        <div className="rounded-md border border-line px-4 py-4">
          <p className="text-ui font-medium text-ink">Try this change before you keep it</p>
          <p className="mt-1 text-xs leading-5 text-[color:var(--text-secondary)]">
            ADE starts a separate copy of itself with this change and shows it here. {TEST_DATA}:
            nothing you do in it touches the ADE you are using.
          </p>
          {canTry(change) ? (
            <button
              type="button"
              onClick={start}
              disabled={action.isPending}
              className="btn-amber mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <Eye className="size-3.5" strokeWidth={1.5} aria-hidden />
              {action.isPending ? "Starting…" : "Try it"}
            </button>
          ) : (
            <p className="mt-3 text-xs text-dim">
              You can try it when the agent and the checks finish.
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
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
function PreviewBrowser({ url, sessionId }: { url: string; sessionId: string }) {
  return (
    <BrowserPreviewProvider projectId={SELF_PROJECT} sessionId={sessionId}>
      <PreviewSurface url={url} sessionId={sessionId} />
    </BrowserPreviewProvider>
  );
}

function PreviewSurface({ url, sessionId }: { url: string; sessionId: string }) {
  const client = useQueryClient();
  const browser = useBrowserPreviewState();
  const placement = useBrowserPlacement();
  const frameRef = useRef<HTMLDivElement>(null);
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

  // Open the preview once the page stream can carry it; take the wheel so the user can click.
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
  return (
    <div ref={frameRef} className="flex flex-col overflow-hidden rounded-md border border-line">
      <BrowserChromeRow
        frameRef={frameRef}
        sessionId={sessionId}
        profiles={computer.data?.profiles ?? []}
      />
      <BrowserSurface
        mode="dock"
        className="aspect-[16/10] w-full"
        emptyState={<p className="m-0 text-xs text-dim">Opening your version…</p>}
      />
    </div>
  );
}
