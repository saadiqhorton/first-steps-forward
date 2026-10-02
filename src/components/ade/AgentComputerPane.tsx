import { useCallback, useEffect, useRef, useState } from "react";
import { Expand, LoaderCircle, Monitor, RotateCw, Shrink } from "lucide-react";
import type { AgentComputer, Project, Session } from "@/lib/ade/types";
import { computerControl, computerStatus } from "@/lib/ade/store";
import { noVncPassword, noVncWebSocketUrl } from "@/lib/ade/noVncConnection.mjs";
import { summarizeChecks } from "./ChecksList";

const POLL_MS = 2000;

/**
 * The project's agent computer: an isolated Linux desktop the coding agent
 * drives itself (screenshots, mouse, keyboard, browser) to run and manually
 * test the project. The user watches live and can take the wheel.
 */
export function AgentComputerPane({
  project,
  session,
}: {
  project: Project;
  session?: Session | undefined;
}) {
  const [computer, setComputer] = useState<AgentComputer | null>(null);
  const [error, setError] = useState("");
  const [control, setControl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewerState, setViewerState] = useState<"connecting" | "connected" | "reconnecting">(
    "connecting",
  );
  const [viewerError, setViewerError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);
  const rfbTargetRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setComputer(await computerStatus(project.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [project.id]);

  useEffect(() => {
    setComputer(null);
    setControl(false);
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = async (op: "start" | "stop") => {
    setBusy(true);
    try {
      setComputer(await computerControl(project.id, op));
      if (op === "stop") setControl(false);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const status = computer?.status;
  const running = status === "running" && !!computer?.viewerUrl;
  const preparing = status === "building" || status === "starting";
  const src = running ? (control ? computer.controlViewerUrl : computer.viewerUrl) : null;

  useEffect(() => {
    if (!src || !rfbTargetRef.current) return;
    let disposed = false;
    let reconnectTimer: number | undefined;
    let rfb: import("@novnc/novnc").default | undefined;
    let retries = 0;
    const connect = async () => {
      if (disposed || !rfbTargetRef.current) return;
      setViewerState(retries ? "reconnecting" : "connecting");
      try {
        const { default: RFB } = await import("@novnc/novnc");
        if (disposed || !rfbTargetRef.current) return;
        const client = new RFB(rfbTargetRef.current, noVncWebSocketUrl(src), {
          credentials: { password: noVncPassword(src) },
        });
        rfb = client;
        client.viewOnly = !control;
        client.scaleViewport = true;
        client.clipViewport = false;
        client.background = "#080909";
        client.addEventListener("connect", () => {
          if (disposed) return;
          retries = 0;
          setViewerState("connected");
          setViewerError("");
        });
        client.addEventListener("disconnect", () => {
          if (disposed) return;
          retries += 1;
          setViewerState("reconnecting");
          setViewerError("Screen connection interrupted. Reconnecting…");
          reconnectTimer = window.setTimeout(
            () => void connect(),
            Math.min(5000, 500 * 2 ** Math.min(retries, 3)),
          );
        });
        client.addEventListener("securityfailure", () => {
          if (!disposed) setViewerError("The computer rejected the screen connection.");
        });
      } catch (cause) {
        if (disposed) return;
        setViewerState("reconnecting");
        setViewerError(
          cause instanceof Error ? cause.message : "Could not connect to the computer screen.",
        );
        retries += 1;
        reconnectTimer = window.setTimeout(
          () => void connect(),
          Math.min(5000, 500 * 2 ** Math.min(retries, 3)),
        );
      }
    };
    void connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      rfb?.disconnect();
    };
  }, [src, control]);

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === screenRef.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement === screenRef.current) void document.exitFullscreen();
    else void screenRef.current?.requestFullscreen();
  };
  const needsStatusRetry =
    (!computer && !!error) ||
    status === "unavailable" ||
    (status === "running" && !computer?.viewerUrl);
  const screenTitle = !computer
    ? error
      ? "Computer status unavailable"
      : "Connecting to project computer"
    : running
      ? control
        ? "You have control"
        : "Computer is live"
      : status === "unavailable"
        ? "Computer unavailable"
        : status === "building"
          ? "Preparing the computer"
          : status === "starting"
            ? "Starting the computer"
            : status === "error"
              ? "Computer needs attention"
              : status === "running"
                ? "Reconnecting to the screen"
                : "Computer is off";
  const screenDescription = !computer
    ? error
      ? "ADE could not reach the local computer service. Check again to refresh its status."
      : "Checking the local computer service for this project."
    : status === "unavailable"
      ? (computer.detail ?? "The local Docker service is unavailable.")
      : status === "stopped"
        ? "Start this project's computer when you want to watch the agent run and test its work."
        : status === "error"
          ? (computer.detail ??
            "The last start attempt did not finish. Review the setup details and try again.")
          : status === "building"
            ? (computer.detail ?? "Preparing the isolated desktop environment for this project.")
            : status === "starting"
              ? (computer.detail ??
                "The desktop is starting. Its screen will appear here when ready.")
              : "The desktop is running; ADE is reconnecting to its viewer.";
  const checks = session ? summarizeChecks(session.checks) : null;
  const added = session?.changes.reduce((n, c) => n + c.added, 0) ?? 0;
  const removed = session?.changes.reduce((n, c) => n + c.removed, 0) ?? 0;

  return (
    <aside
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto bg-panel"
      aria-label="Agent computer"
    >
      <div className="flex h-11 items-center justify-between border-b border-line px-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">Agent computer</div>
          <div className="mt-0.5 truncate text-[11px] text-dim">{project.name}</div>
        </div>
        <span
          className={`ml-3 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2 py-1 font-mono text-[10px] ${running ? "text-teal" : status === "error" ? "text-danger" : "text-dim"}`}
        >
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
      <div className="flex flex-none flex-col px-0 pb-3 pt-0">
        {running && src ? (
          <div
            ref={screenRef}
            className="agent-computer-screen relative aspect-[16/10] w-full flex-none overflow-hidden bg-black"
          >
            <div
              ref={rfbTargetRef}
              className="absolute inset-0 h-full w-full"
              aria-label={`Agent computer for ${project.name}`}
            />
            {viewerState !== "connected" && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/75 px-3 py-1.5 font-mono text-[10px] text-white/80">
                  <LoaderCircle className="size-3 animate-spin" aria-hidden />
                  {viewerError ||
                    (viewerState === "connecting"
                      ? "Connecting to screen"
                      : "Reconnecting to screen")}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
              title={fullscreen ? "Exit full screen" : "Full screen"}
              className="absolute right-3 top-3 z-20 grid size-8 place-items-center rounded-md border border-white/15 bg-black/65 text-white/80 opacity-70 hover:opacity-100 focus:opacity-100"
            >
              {fullscreen ? (
                <Shrink className="size-4" aria-hidden />
              ) : (
                <Expand className="size-4" aria-hidden />
              )}
            </button>
          </div>
        ) : (
          <div className="relative grid aspect-[16/10] w-full place-items-center overflow-hidden rounded-xl border border-line bg-[#141716] px-5 text-center text-white shadow-sm">
            <div
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(218,174,92,0.10),transparent_58%)]"
              aria-hidden
            />
            <div className="relative max-w-sm">
              <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-amber">
                {preparing || (!computer && !error) ? (
                  <LoaderCircle className="size-6 animate-spin" aria-hidden />
                ) : (
                  <Monitor className="size-6" strokeWidth={1.5} aria-hidden />
                )}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/45">
                {project.name} · local desktop
              </div>
              <h2 className="mt-2 text-lg font-medium tracking-tight">{screenTitle}</h2>
              <p className="mx-auto mt-2 max-w-xs text-[12px] leading-relaxed text-white/65">
                {screenDescription}
              </p>
              {(status === "stopped" || status === "error") && (
                <button
                  type="button"
                  onClick={() => void run("start")}
                  disabled={busy}
                  className="btn-amber mt-5 inline-flex items-center gap-2 px-4 py-2 text-[12px] disabled:opacity-50"
                >
                  {busy ? (
                    <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Monitor className="size-3.5" aria-hidden />
                  )}
                  {status === "error" ? "Try starting again" : "Start computer"}
                </button>
              )}
              {needsStatusRetry && (
                <button
                  type="button"
                  onClick={() => void refresh()}
                  disabled={busy}
                  className="btn-quiet mt-5 inline-flex items-center gap-2 px-4 py-2 text-[12px] text-white disabled:opacity-50"
                >
                  <RotateCw className="size-3.5" aria-hidden />
                  Check again
                </button>
              )}
            </div>
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t border-white/10 px-4 py-2 font-mono text-[10px] text-white/45">
              <span>
                {computer?.screen
                  ? `${computer.screen.width} × ${computer.screen.height}`
                  : "project workspace"}
              </span>
              <span>
                {running
                  ? control
                    ? "control enabled"
                    : "view only"
                  : preparing
                    ? "setting up"
                    : "ready when you are"}
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="px-4 pb-4">
        <p className="mt-1 text-[12px] leading-snug text-dim">
          {running
            ? control
              ? "Your mouse and keyboard reach the agent's computer. Hand it back when you're done so you don't collide with the agent."
              : "The agent starts the app, opens it here, and tests it like a person would. Watch live, or take control to help."
            : "The task stays beside the computer. When the agent starts it, its real desktop and browser appear here."}
        </p>
        {error && (
          <p role="alert" className="mt-2 text-[12px] leading-snug text-danger">
            {error}
          </p>
        )}
        {computer?.log?.length ? (
          <details className="mt-3 rounded-lg border border-line bg-surface-muted/50 px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-medium text-dim">
              Setup details
            </summary>
            <pre className="mt-2 max-h-28 overflow-auto font-mono text-[10px] leading-snug whitespace-pre-wrap text-dim">
              {computer.log.slice(-8).join("\n")}
            </pre>
          </details>
        ) : null}
        {running && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setControl((c) => !c)}
              aria-pressed={control}
              className={`${control ? "btn-amber" : "btn-quiet"} px-3 py-1.5 text-[12px]`}
            >
              {control ? "Hand back" : "Take control"}
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="btn-quiet px-3 py-1.5 text-[12px]"
            >
              Full screen
            </button>
            <button
              type="button"
              onClick={() => void run("stop")}
              disabled={busy}
              className="btn-quiet px-3 py-1.5 text-[12px] disabled:opacity-50"
            >
              Turn off
            </button>
          </div>
        )}
      </div>
      <div className="mt-auto border-t border-line">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <span className="label-mono">Details</span>
          <span className="ml-auto font-mono text-[10px] text-dim">
            {session ? "this task" : "project"}
          </span>
        </div>
        <div className="flex justify-between px-3 py-2 font-mono text-[10px] text-dim">
          <span>Checks</span>
          <span className={checks?.verified ? "text-teal" : ""}>{checks ? checks.text : "—"}</span>
        </div>
        <div className="flex justify-between px-3 py-2 font-mono text-[10px] text-dim">
          <span>Working tree diff</span>
          <span>{session ? `+${added} / −${removed}` : "—"}</span>
        </div>
        <div className="flex justify-between px-3 py-2 font-mono text-[10px] text-dim">
          <span>Agent output</span>
          <span>{session ? `${session.logs.length} lines` : "—"}</span>
        </div>
      </div>
    </aside>
  );
}
