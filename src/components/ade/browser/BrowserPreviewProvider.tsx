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
  type BrowserTabs,
  type ClientMessage,
} from "@/lib/ade/browser/browserStream";
import { browserViewerId } from "@/lib/ade/browser/viewer";
import { browserPageKey, shouldRevealBrowser } from "@/lib/ade/browser/reveal.mjs";
import { persistFeedbackFile, restoreFeedbackFile } from "@/lib/ade/browser/feedbackPersistence";
import { BROWSER_PREVIEW_STREAM_SCALE, DEFAULT_VIEWPORT } from "@/shared/browser-contract.mjs";
import { useBrowserPlacement } from "./browserPresentationContext";
import { BrowserPresentationProvider } from "./BrowserPresentationProvider";
import { useBrowserCapture } from "./useBrowserCapture";
import { feedbackScope, usePersistentFeedbackList } from "./usePersistentFeedbackList";
import {
  BrowserPreviewFrameContext,
  BrowserPreviewStateContext,
  type BrowserPreviewFrameValue,
  type BrowserPreviewStateValue,
  type BrowserAnnotationMode,
  type BrowserAnnotationDraft,
  type BrowserAnnotationOrigin,
} from "./browserPreviewContext";

// Frames are decoded at up to this size. The page is sized to the docked surface.
const FRAME_MAX_WIDTH = DEFAULT_VIEWPORT.width * BROWSER_PREVIEW_STREAM_SCALE;
const FRAME_MAX_HEIGHT = DEFAULT_VIEWPORT.height * BROWSER_PREVIEW_STREAM_SCALE;
type StoredAnnotationDraft = Omit<BrowserAnnotationDraft, "file" | "detail"> & {
  file: ReturnType<typeof persistFeedbackFile>;
  detail: ReturnType<typeof persistFeedbackFile> | null;
};
const encodeAnnotationDraft = (draft: BrowserAnnotationDraft): StoredAnnotationDraft => ({
  ...draft,
  file: persistFeedbackFile(draft.file),
  detail: draft.detail ? persistFeedbackFile(draft.detail) : null,
});
const decodeAnnotationDraft = (draft: StoredAnnotationDraft): BrowserAnnotationDraft => ({
  ...draft,
  file: restoreFeedbackFile(draft.file),
  detail: draft.detail ? restoreFeedbackFile(draft.detail) : null,
});
const annotationScope = (draft: BrowserAnnotationDraft) =>
  feedbackScope(draft.origin.projectId, draft.origin.sessionId);
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
  sessionId,
  children,
}: {
  projectId: string | null;
  sessionId: string | null;
  children: ReactNode;
}) {
  return (
    <BrowserPresentationProvider projectId={projectId}>
      <BrowserPreviewStateProvider projectId={projectId} sessionId={sessionId}>
        {children}
      </BrowserPreviewStateProvider>
    </BrowserPresentationProvider>
  );
}

function BrowserPreviewStateProvider({
  projectId,
  sessionId,
  children,
}: {
  projectId: string | null;
  sessionId: string | null;
  children: ReactNode;
}) {
  const { place, setPlace, visible } = useBrowserPlacement();
  // Project-tagged so a previous project's answer is never shown or connected to.
  const statusQuery = useQuery({
    queryKey: ["browser", projectId, sessionId],
    queryFn: () => getBrowserStatus(projectId!, sessionId),
    staleTime: Infinity,
    enabled: projectId !== null,
  });
  const status = statusQuery.data ?? null;
  const statusError = statusQuery.error instanceof Error ? statusQuery.error.message : null;
  const [controlState, setControlState] = useState<{
    projectId: string;
    sessionId: string | null;
    value: BrowserStreamControl;
  } | null>(null);
  const [streamStatus, setStreamStatus] = useState<BrowserStreamStatus | "idle">("idle");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [nav, setNav] = useState<BrowserStreamNav | null>(null);
  const [tabs, setTabs] = useState<BrowserTabs | null>(null);
  const [downloads, setDownloads] = useState<
    readonly import("@/lib/ade/browser/browserStream").BrowserDownload[]
  >([]);
  const tabsRef = useRef<BrowserTabs | null>(null);
  const [viewport, setViewport] = useState<BrowserStreamViewport | null>(null);
  const viewportRef = useRef<BrowserStreamViewport | null>(null);
  const [pointer, setPointer] = useState<BrowserStreamPointer | null>(null);
  const [probe, setProbe] = useState<{
    x: number;
    y: number;
    editable: boolean;
  } | null>(null);
  // Pages already surfaced by this window, so a dismissed preview is not reopened for them.
  const revealedPages = useRef(new Set<string>());

  // The agent opened a page but the person is not looking at the browser: float it, as T3 does.
  useEffect(() => {
    if (!nav?.opened || !projectId || !sessionId) return;
    const key = browserPageKey(projectId, sessionId, tabs?.activeId ?? "", nav.url);
    const reveal = shouldRevealBrowser({
      opened: nav.opened,
      url: nav.url,
      visible,
      place,
      revealed: revealedPages.current.has(key),
    });
    if (visible || place === "float") revealedPages.current.add(key);
    if (!reveal) return;
    revealedPages.current.add(key);
    setPlace("float");
  }, [nav?.opened, nav?.url, projectId, sessionId, tabs?.activeId, visible, place, setPlace]);
  const [hasFrame, setHasFrame] = useState(false);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [deviceToolbar, setDeviceToolbarState] = useState(false);
  const setDeviceToolbar = useCallback(
    (visible: boolean) => {
      setDeviceToolbarState(visible);
      if (projectId) {
        try {
          window.localStorage.setItem(
            `ade.browser.deviceToolbar.${encodeURIComponent(projectId)}.${encodeURIComponent(sessionId ?? "")}`,
            visible ? "1" : "0",
          );
        } catch {
          /* Storage is optional. */
        }
      }
    },
    [projectId, sessionId],
  );
  useEffect(() => {
    try {
      setDeviceToolbarState(
        !!projectId &&
          window.localStorage.getItem(
            `ade.browser.deviceToolbar.${encodeURIComponent(projectId)}.${encodeURIComponent(sessionId ?? "")}`,
          ) === "1",
      );
    } catch {
      setDeviceToolbarState(false);
    }
  }, [projectId, sessionId]);
  const [deviceAspectRatio, setDeviceAspectRatioState] = useState<number | null>(null);
  // The page follows the pane instead of a fixed device size, as T3's fill viewport does.
  const [fillViewport, setFillViewportState] = useState(false);
  const setFillViewport = useCallback(
    (fill: boolean) => {
      setFillViewportState(fill);
      if (!projectId) return;
      try {
        window.localStorage.setItem(
          `ade.browser.fill.${encodeURIComponent(projectId)}.${encodeURIComponent(sessionId ?? "")}`,
          fill ? "1" : "0",
        );
      } catch {
        /* Storage is optional. */
      }
    },
    [projectId, sessionId],
  );
  useEffect(() => {
    try {
      setFillViewportState(
        !!projectId &&
          window.localStorage.getItem(
            `ade.browser.fill.${encodeURIComponent(projectId)}.${encodeURIComponent(sessionId ?? "")}`,
          ) === "1",
      );
    } catch {
      setFillViewportState(false);
    }
  }, [projectId, sessionId]);
  const setDeviceAspectRatio = useCallback(
    (ratio: number | null) => {
      setDeviceAspectRatioState(ratio);
      if (projectId && tabs?.activeId) {
        try {
          const key = `ade.browser.aspect.${encodeURIComponent(projectId)}.${encodeURIComponent(sessionId ?? "")}.${encodeURIComponent(tabs.activeId)}`;
          if (ratio === null) window.localStorage.removeItem(key);
          else window.localStorage.setItem(key, String(ratio));
        } catch {
          /* Storage is optional. */
        }
      }
    },
    [projectId, sessionId, tabs?.activeId],
  );
  useEffect(() => {
    let ratio: number | null = null;
    if (projectId && tabs?.activeId) {
      try {
        const value = window.localStorage.getItem(
          `ade.browser.aspect.${encodeURIComponent(projectId)}.${encodeURIComponent(sessionId ?? "")}.${encodeURIComponent(tabs.activeId)}`,
        );
        const parsed = value === null ? NaN : Number(value);
        if (Number.isFinite(parsed) && parsed > 0) ratio = parsed;
      } catch {
        /* Storage is optional. */
      }
    }
    setDeviceAspectRatioState(ratio);
  }, [projectId, sessionId, tabs?.activeId]);
  const [annotationMode, setAnnotationMode] = useState<BrowserAnnotationMode>("off");
  const [annotationOrigin, setAnnotationOrigin] = useState<BrowserAnnotationOrigin | null>(null);
  const [pendingAnnotations, setPendingAnnotations] = usePersistentFeedbackList(
    "annotation-review",
    projectId ? feedbackScope(projectId, sessionId ?? "") : null,
    annotationScope,
    encodeAnnotationDraft,
    decodeAnnotationDraft,
  );
  const addPendingAnnotation = useCallback(
    (draft: BrowserAnnotationDraft) => setPendingAnnotations((current) => [...current, draft]),
    [],
  );
  const dismissPendingAnnotation = useCallback(
    (id: string) => setPendingAnnotations((current) => current.filter((draft) => draft.id !== id)),
    [],
  );

  useEffect(() => {
    if (
      annotationOrigin &&
      (annotationOrigin.projectId !== projectId || annotationOrigin.sessionId !== sessionId)
    )
      setAnnotationMode("off");
  }, [annotationOrigin, projectId, sessionId]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<ImageBitmap | null>(null);
  const capture = useBrowserCapture(projectId, sessionId, frameRef);
  const hasFrameRef = useRef(false);
  const streamRef = useRef<BrowserStream | null>(null);
  const streamOpenRef = useRef(false);
  // The page address when the last stream error arrived. A later navigation clears the error.
  const navUrlRef = useRef<string | null>(null);
  const errorUrlRef = useRef<string | null>(null);

  const control =
    controlState?.projectId === projectId && controlState.sessionId === sessionId
      ? controlState.value
      : null;

  // The stream runs while a surface is painting (docked or floating), so a hidden preview does not
  // keep a page-screencast open.
  const wanted = projectId !== null && (place === "float" || canvas !== null || capture.recording);
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

  const paint = useCallback(
    (bitmap: ImageBitmap) => {
      const previous = frameRef.current;
      frameRef.current = bitmap;
      if (canvasRef.current) drawFrame(canvasRef.current, bitmap);
      capture.paintCaptureFrame(bitmap);
      previous?.close();
      if (!hasFrameRef.current) {
        hasFrameRef.current = true;
        setHasFrame(true);
      }
    },
    [capture.paintCaptureFrame],
  );

  // Availability and control refresh when the server invalidates this project's browser state.
  useEffect(() => {
    if (!projectId || !status) return;
    if (!streamOpenRef.current)
      setControlState({
        projectId,
        sessionId,
        value: controlFromState(status.control, browserViewerId()),
      });
  }, [projectId, sessionId, status]);

  // The one stream for this project.
  useEffect(() => {
    if (!projectId || !streamUrl) return;
    const stream = connectBrowserStream({
      url: streamUrl,
      viewer: browserViewerId(),
      maxWidth: FRAME_MAX_WIDTH,
      maxHeight: FRAME_MAX_HEIGHT,
      onFrame: paint,
      onViewport: (next) => {
        viewportRef.current = next;
        setViewport(next);
      },
      onControl: (next) => setControlState({ projectId, sessionId, value: next }),
      onPointer: (next) => {
        if (next.tabId && next.tabId !== tabsRef.current?.activeId) return;
        setPointer(next);
        const size = viewportRef.current;
        if (size)
          capture.recordPointer({
            x: next.x,
            y: next.y,
            width: size.width,
            height: size.height,
            source: "agent",
            phase: next.phase,
            tabId: next.tabId ?? tabsRef.current?.activeId ?? null,
          });
      },
      // The page copied text while this viewer pressed copy or cut; put it on our clipboard.
      onClipboard: (text) => void copyText(text),
      onNav: (next) => {
        navUrlRef.current = next.url;
        setNav(next);
        if (!next.loading && next.url !== errorUrlRef.current) {
          setStreamError(null);
        }
      },
      onTabs: (next) => {
        tabsRef.current = next;
        setTabs(next);
      },
      onDownloads: setDownloads,
      onProbe: setProbe,
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
      setTabs(null);
      setDownloads([]);
      tabsRef.current = null;
      setViewport(null);
      viewportRef.current = null;
      setPointer(null);
      setProbe(null);
      hasFrameRef.current = false;
      setHasFrame(false);
      frameRef.current?.close();
      frameRef.current = null;
      const visible = canvasRef.current;
      visible?.getContext("2d")?.clearRect(0, 0, visible.width, visible.height);
    };
  }, [projectId, sessionId, streamUrl, paint, attempt, capture.recordPointer]);

  const send = useCallback((message: ClientMessage) => {
    return streamRef.current?.send(message) ?? false;
  }, []);

  const changeControl = useCallback(
    async (action: "take" | "release") => {
      if (!projectId) return false;
      try {
        const next = await postBrowserControl(projectId, action, browserViewerId(), sessionId);
        setControlState({ projectId, sessionId, value: controlFromState(next, browserViewerId()) });
        setActionError(null);
        return true;
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Could not change control of the agent browser.",
        );
        return false;
      }
    },
    [projectId, sessionId],
  );

  const answerFileChooser = useCallback(
    async (chooserId: string, files: readonly File[]) => {
      if (!projectId) return false;
      try {
        const uploaded = await Promise.all(files.map((file) => uploadAttachment(file)));
        if (control?.controller !== "you") {
          await postBrowserControl(projectId, "take", browserViewerId(), sessionId);
        }
        await postFileChooser(
          projectId,
          chooserId,
          uploaded.map((file) => file.id),
          browserViewerId(),
          sessionId,
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
    [projectId, sessionId, control?.controller],
  );

  const reconnect = useCallback(() => setAttempt((count) => count + 1), []);
  const screenshot = useCallback(
    (sessionId: string, pageUrl: string) =>
      capture.screenshot(sessionId, pageUrl, tabs?.activeId ?? undefined),
    [tabs?.activeId, capture.screenshot],
  );
  const startRecording = useCallback(
    (sessionId: string, pageUrl: string) => {
      capture.startRecording(
        sessionId,
        pageUrl,
        streamUrl ?? undefined,
        tabs?.activeId ?? undefined,
      );
    },
    [streamUrl, tabs?.activeId, capture.startRecording],
  );
  const stopRecording = useCallback(
    () => capture.stopRecording(tabs?.activeId ?? "active"),
    [tabs?.activeId, capture.stopRecording],
  );

  const stateValue = useMemo<BrowserPreviewStateValue>(
    () => ({
      projectId,
      sessionId,
      status,
      statusError,
      streamStatus,
      streamError,
      nav,
      tabs,
      downloads,
      control,
      send,
      changeControl,
      answerFileChooser,
      actionError,
      reconnect,
      deviceToolbar,
      setDeviceToolbar,
      fillViewport,
      setFillViewport,
      deviceAspectRatio,
      setDeviceAspectRatio,
      annotationMode,
      setAnnotationMode,
      annotationOrigin,
      setAnnotationOrigin,
      pendingAnnotations,
      addPendingAnnotation,
      dismissPendingAnnotation,
      capture: {
        ...capture,
        recording: capture.recordingTabs.includes(tabs?.activeId ?? "active"),
        screenshot,
        startRecording,
        stopRecording,
      },
    }),
    [
      projectId,
      sessionId,
      status,
      statusError,
      streamStatus,
      streamError,
      nav,
      tabs,
      downloads,
      control,
      send,
      changeControl,
      answerFileChooser,
      actionError,
      reconnect,
      deviceToolbar,
      setDeviceToolbar,
      fillViewport,
      setFillViewport,
      deviceAspectRatio,
      setDeviceAspectRatio,
      annotationMode,
      annotationOrigin,
      pendingAnnotations,
      addPendingAnnotation,
      dismissPendingAnnotation,
      capture,
      screenshot,
      startRecording,
      stopRecording,
    ],
  );

  const frameValue = useMemo<BrowserPreviewFrameValue>(
    () => ({ viewport, pointer, probe, hasFrame, canvas, attachCanvas, releaseCanvas }),
    [viewport, pointer, probe, hasFrame, canvas, attachCanvas, releaseCanvas],
  );

  return (
    <BrowserPreviewStateContext.Provider value={stateValue}>
      <BrowserPreviewFrameContext.Provider value={frameValue}>
        {children}
      </BrowserPreviewFrameContext.Provider>
    </BrowserPreviewStateContext.Provider>
  );
}
