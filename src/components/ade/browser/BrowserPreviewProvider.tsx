import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getBrowserStatus,
  postBrowserControl,
  postFileChooser,
  type BrowserControlState,
} from "@/lib/ade/browser/api";
import { copyText } from "@/lib/ade/clipboard";
import { uploadAttachment } from "@/lib/ade/store";
import {
  connectBrowserStream,
  type BrowserStream,
  type BrowserStreamControl,
  type BrowserStreamNav,
  type BrowserStreamPointer,
  type BrowserStreamStatus,
  type BrowserStreamViewport,
  type ClientMessage,
} from "@/lib/ade/browser/browserStream";
import { browserViewerId } from "@/lib/ade/browser/viewer";
import { BROWSER_RENDER_SCALE, DEFAULT_VIEWPORT } from "@/shared/browser-contract.mjs";
import { useBrowserPlacement } from "./browserPresentationContext";
import { BrowserPresentationProvider } from "./BrowserPresentationProvider";
import {
  BrowserPreviewFrameContext,
  BrowserPreviewStateContext,
  type BrowserPreviewFrameValue,
  type BrowserPreviewStateValue,
} from "./browserPreviewContext";

// Frames are decoded at up to this size. The page is sized to the docked surface.
const FRAME_MAX_WIDTH = DEFAULT_VIEWPORT.width * BROWSER_RENDER_SCALE;
const FRAME_MAX_HEIGHT = DEFAULT_VIEWPORT.height * BROWSER_RENDER_SCALE;
/** Control as the server reports it for this viewer. */
function controlFromState(state: BrowserControlState, viewer: string): BrowserStreamControl {
  const controller =
    state.owner === null ? "agent" : state.owner === viewer ? "you" : "another-viewer";
  return {
    canOperate: true,
    controller,
    generation: state.generation,
    dialog: null,
    fileChooser: null,
  };
}

function drawFrame(canvas: HTMLCanvasElement, bitmap: ImageBitmap | null) {
  if (!bitmap) return;
  if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
  if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
}

/**
 * Owns the browser preview for the active project: one stream while the computer runs and the
 * preview is docked or floating, the shared control state, and the single canvas frames paint into.
 */
export function BrowserPreviewProvider({
  projectId,
  children,
}: {
  projectId: string | null;
  children: ReactNode;
}) {
  return (
    <BrowserPresentationProvider projectId={projectId}>
      <BrowserPreviewStateProvider projectId={projectId}>{children}</BrowserPreviewStateProvider>
    </BrowserPresentationProvider>
  );
}

function BrowserPreviewStateProvider({
  projectId,
  children,
}: {
  projectId: string | null;
  children: ReactNode;
}) {
  const { place } = useBrowserPlacement();
  // Project-tagged so a previous project's answer is never shown or connected to.
  const statusQuery = useQuery({
    queryKey: ["browser", projectId],
    queryFn: () => getBrowserStatus(projectId!),
    staleTime: Infinity,
    enabled: projectId !== null,
  });
  const status = statusQuery.data ?? null;
  const statusError = statusQuery.error instanceof Error ? statusQuery.error.message : null;
  const [controlState, setControlState] = useState<{
    projectId: string;
    value: BrowserStreamControl;
  } | null>(null);
  const [streamStatus, setStreamStatus] = useState<BrowserStreamStatus | "idle">("idle");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [nav, setNav] = useState<BrowserStreamNav | null>(null);
  const [viewport, setViewport] = useState<BrowserStreamViewport | null>(null);
  const [pointer, setPointer] = useState<BrowserStreamPointer | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<ImageBitmap | null>(null);
  const hasFrameRef = useRef(false);
  const streamRef = useRef<BrowserStream | null>(null);
  const streamOpenRef = useRef(false);
  // The page address when the last stream error arrived. A later navigation clears the error.
  const navUrlRef = useRef<string | null>(null);
  const errorUrlRef = useRef<string | null>(null);

  const control = controlState?.projectId === projectId ? controlState.value : null;

  // The stream runs while a surface is painting (docked or floating), so a hidden preview does not
  // keep a page-screencast open.
  const wanted = projectId !== null && (place === "float" || canvas !== null);
  const streamUrl = wanted && status?.available ? (status.streamUrl ?? null) : null;

  const attachCanvas = useCallback((next: HTMLCanvasElement) => {
    canvasRef.current = next;
    setCanvas(next);
  }, []);

  const releaseCanvas = useCallback((next: HTMLCanvasElement) => {
    // A new surface may already have attached; only clear our own canvas.
    if (canvasRef.current !== next) return;
    canvasRef.current = null;
    setCanvas(null);
  }, []);

  // Repaint the last frame into a canvas that just appeared (or changed size).
  useEffect(() => {
    if (canvas) drawFrame(canvas, frameRef.current);
  }, [canvas]);

  useEffect(() => () => frameRef.current?.close(), []);

  const paint = useCallback((bitmap: ImageBitmap) => {
    const previous = frameRef.current;
    frameRef.current = bitmap;
    if (canvasRef.current) drawFrame(canvasRef.current, bitmap);
    previous?.close();
    if (!hasFrameRef.current) {
      hasFrameRef.current = true;
      setHasFrame(true);
    }
  }, []);

  // Availability and control refresh when the server invalidates this project's browser state.
  useEffect(() => {
    if (!projectId || !status) return;
    if (!streamOpenRef.current)
      setControlState({
        projectId,
        value: controlFromState(status.control, browserViewerId()),
      });
  }, [projectId, status]);

  // The one stream for this project.
  useEffect(() => {
    if (!projectId || !streamUrl) return;
    const stream = connectBrowserStream({
      url: streamUrl,
      viewer: browserViewerId(),
      maxWidth: FRAME_MAX_WIDTH,
      maxHeight: FRAME_MAX_HEIGHT,
      onFrame: paint,
      onViewport: setViewport,
      onControl: (next) => setControlState({ projectId, value: next }),
      onPointer: setPointer,
      // The page copied text while this viewer pressed copy or cut; put it on our clipboard.
      onClipboard: (text) => void copyText(text),
      onNav: (next) => {
        navUrlRef.current = next.url;
        setNav(next);
        if (!next.loading && next.url !== errorUrlRef.current) {
          setStreamError(null);
        }
      },
      onError: (message) => {
        errorUrlRef.current = navUrlRef.current;
        setStreamError(message);
      },
      onStatus: (next) => {
        streamOpenRef.current = next === "open";
        setStreamStatus(next);
      },
    });
    streamRef.current = stream;
    return () => {
      stream.close();
      if (streamRef.current === stream) streamRef.current = null;
      streamOpenRef.current = false;
      setStreamStatus("idle");
      setStreamError(null);
      navUrlRef.current = null;
      errorUrlRef.current = null;
      setNav(null);
      setViewport(null);
      setPointer(null);
      hasFrameRef.current = false;
      setHasFrame(false);
      frameRef.current?.close();
      frameRef.current = null;
      const visible = canvasRef.current;
      visible?.getContext("2d")?.clearRect(0, 0, visible.width, visible.height);
    };
  }, [projectId, streamUrl, paint, attempt]);

  const send = useCallback((message: ClientMessage) => {
    return streamRef.current?.send(message) ?? false;
  }, []);

  const changeControl = useCallback(
    async (action: "take" | "release") => {
      if (!projectId) return false;
      try {
        const next = await postBrowserControl(projectId, action, browserViewerId());
        setControlState({ projectId, value: controlFromState(next, browserViewerId()) });
        setActionError(null);
        return true;
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Could not change control of the agent browser.",
        );
        return false;
      }
    },
    [projectId],
  );

  const answerFileChooser = useCallback(
    async (chooserId: string, files: readonly File[]) => {
      if (!projectId) return false;
      try {
        const uploaded = await Promise.all(files.map((file) => uploadAttachment(file)));
        if (control?.controller !== "you") {
          await postBrowserControl(projectId, "take", browserViewerId());
        }
        await postFileChooser(
          projectId,
          chooserId,
          uploaded.map((file) => file.id),
          browserViewerId(),
        );
        setActionError(null);
        return true;
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Could not send the files to the page.",
        );
        return false;
      }
    },
    [projectId, control?.controller],
  );

  const reconnect = useCallback(() => setAttempt((count) => count + 1), []);

  const stateValue = useMemo<BrowserPreviewStateValue>(
    () => ({
      projectId,
      status,
      statusError,
      streamStatus,
      streamError,
      nav,
      control,
      send,
      changeControl,
      answerFileChooser,
      actionError,
      reconnect,
    }),
    [
      projectId,
      status,
      statusError,
      streamStatus,
      streamError,
      nav,
      control,
      send,
      changeControl,
      answerFileChooser,
      actionError,
      reconnect,
    ],
  );

  const frameValue = useMemo<BrowserPreviewFrameValue>(
    () => ({ viewport, pointer, hasFrame, canvas, attachCanvas, releaseCanvas }),
    [viewport, pointer, hasFrame, canvas, attachCanvas, releaseCanvas],
  );

  return (
    <BrowserPreviewStateContext.Provider value={stateValue}>
      <BrowserPreviewFrameContext.Provider value={frameValue}>
        {children}
      </BrowserPreviewFrameContext.Provider>
    </BrowserPreviewStateContext.Provider>
  );
}
