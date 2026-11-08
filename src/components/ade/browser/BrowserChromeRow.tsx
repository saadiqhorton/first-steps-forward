// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/web/src/components/preview/PreviewChromeRow.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.

import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ExternalLink,
  MousePointer2,
  PictureInPicture2,
  RotateCw,
  MoreVertical,
  Globe,
  Plus,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { uploadAttachment, uploadBrowserRecording, useAde } from "@/lib/ade/store";
import {
  adjustBrowserSettings,
  getBrowserSettings,
  getBrowserDevtools,
  type BrowserSettings,
} from "@/lib/ade/browser/api";
import { addBrowserFeedback } from "@/lib/ade/browser/composerFeedback";
import { recordingAttachmentUrl } from "@/lib/ade/browser/recordingUpload";
import {
  resolveAddressBarInput,
  resolveSearchUrlTemplate,
  isValidSearchUrlTemplate,
} from "@/shared/browser-address.mjs";
import { openExternally } from "./browserActions";
import { BROWSER_ZOOM_EVENT } from "@/lib/ade/browser/openInPreview.mjs";
import {
  openBrowserPictureInPicture,
  supportsBrowserPictureInPicture,
} from "@/lib/ade/browser/pictureInPicture.mjs";
import { useBrowserPreviewFrame, useBrowserPreviewState } from "./browserPreviewContext";
import { useBrowserPlacement } from "./browserPresentationContext";
import { formatAnnotationFeedback } from "./annotationFeedback";
import { feedbackScope, usePersistentFeedbackNotes } from "./usePersistentFeedbackList";
import { useBrowserShortcuts } from "./useBrowserShortcuts";

const ICON_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-md text-dim transition-colors hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber disabled:pointer-events-none disabled:opacity-40";

const ZOOM_LEVELS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
];
const DEFAULT_SETTINGS: BrowserSettings = {
  viewport: { width: 1280, height: 800 },
  zoomFactor: 1,
  colorScheme: "system",
};
// Device dimensions follow T3 Code's previewViewport presets.
const DEVICE_PRESETS = [
  ["iPhone SE", 375, 667],
  ["iPhone XR", 414, 896],
  ["iPhone 12 Pro", 390, 844],
  ["iPhone 14 Pro Max", 430, 932],
  ["Pixel 7", 412, 915],
  ["Samsung Galaxy S8+", 360, 740],
  ["Samsung Galaxy S20 Ultra", 412, 915],
  ["iPad Mini", 768, 1024],
  ["iPad Air", 820, 1180],
  ["iPad Pro", 1024, 1366],
  ["Surface Pro 7", 912, 1368],
  ["Surface Duo", 540, 720],
  ["Galaxy Z Fold 5", 344, 882],
  ["Asus Zenbook Fold", 853, 1280],
  ["Samsung Galaxy A51/71", 412, 914],
  ["Nest Hub", 1024, 600],
  ["Nest Hub Max", 1280, 800],
] as const;

function CapturePreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const saved = recordingAttachmentUrl(file);
    const next = saved ?? URL.createObjectURL(file);
    setUrl(next);
    return () => {
      if (!saved) URL.revokeObjectURL(next);
    };
  }, [file]);
  if (!url) return null;
  return file.type.startsWith("video/") ? (
    <video
      controls
      preload="metadata"
      src={url}
      aria-label="Recording preview"
      className="mb-2 max-h-52 w-full rounded bg-black"
    />
  ) : (
    <img
      src={url}
      alt="Screenshot preview"
      className="mb-2 max-h-52 w-full rounded object-contain"
    />
  );
}

/**
 * Address bar for the docked browser: history, reload, the page address (editable only while
 * you hold control), and preview and full screen actions.
 */
export function BrowserChromeRow({
  frameRef,
  sessionId,
  running,
  profiles = [],
}: {
  frameRef: RefObject<HTMLDivElement | null>;
  sessionId?: string | undefined;
  running?: boolean;
  profiles?: readonly { id: string; name: string }[];
}) {
  const preview = useBrowserPreviewState();
  const { hasFrame, viewport, canvas } = useBrowserPreviewFrame();
  const { steer, state } = useAde();
  const { setPlace } = useBrowserPlacement();
  const { nav, tabs, control, projectId, send } = preview;
  const devServer = state.processes.find(
    (process) =>
      process.projectId === projectId && process.status === "running" && process.port > 0,
  );
  const activeTabRef = useRef<string | null>(null);
  activeTabRef.current = tabs?.activeId ?? null;
  const canOperate = control?.controller === "you";
  const url = nav?.url === "about:blank" ? "" : (nav?.url ?? "");
  const [draft, setDraft] = useState<string | null>(null);
  const [browserError, setBrowserError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const storageScope = projectId ? feedbackScope(projectId, sessionId ?? "") : null;
  const [feedbackById, setFeedbackById] = usePersistentFeedbackNotes(
    storageScope ? `annotation-review-notes:${storageScope}` : null,
  );
  const [captureNotesById, setCaptureNotesById] = usePersistentFeedbackNotes(
    storageScope ? `capture-review-notes:${storageScope}` : null,
  );
  const [sendingCapture, setSendingCapture] = useState(false);
  const [sendingAnnotation, setSendingAnnotation] = useState(false);
  const [settings, setSettings] = useState<BrowserSettings>(DEFAULT_SETTINGS);
  const {
    deviceToolbar,
    setDeviceToolbar,
    fillViewport,
    setFillViewport,
    deviceAspectRatio: aspectRatio,
    setDeviceAspectRatio: setAspectRatio,
  } = preview;
  const [deviceWidth, setDeviceWidth] = useState("1280");
  const [deviceHeight, setDeviceHeight] = useState("800");
  const [searchEngine, setSearchEngine] = useState(() => {
    try {
      return window.localStorage.getItem("ade.browser.searchEngine") ?? "duckduckgo";
    } catch {
      return "duckduckgo";
    }
  });
  const [customSearch, setCustomSearch] = useState(() => {
    try {
      return window.localStorage.getItem("ade.browser.customSearch") ?? "";
    } catch {
      return "";
    }
  });
  const [devicePreset, setDevicePreset] = useState("responsive");
  const [recordingFrameRate, setRecordingFrameRate] = useState(() => {
    try {
      return window.localStorage.getItem("ade.browser.recordingFrameRate") === "60" ? "60" : "30";
    } catch {
      return "30";
    }
  });
  const [recordingMousePresses, setRecordingMousePresses] = useState(() => {
    try {
      return window.localStorage.getItem("ade.browser.recordingShowMousePresses") === "1";
    } catch {
      return false;
    }
  });
  const [recordingKeyPresses, setRecordingKeyPresses] = useState(() => {
    try {
      return window.localStorage.getItem("ade.browser.recordingShowKeyPresses") === "1";
    } catch {
      return false;
    }
  });
  const { annotationMode, setAnnotationMode, annotationOrigin, setAnnotationOrigin, capture } =
    preview;
  const pendingAnnotation =
    preview.pendingAnnotations.find(
      (draft) => draft.origin.sessionId === sessionId && draft.origin.projectId === projectId,
    ) ?? null;
  const feedback = pendingAnnotation
    ? (feedbackById[pendingAnnotation.id] ?? pendingAnnotation.comment ?? "")
    : "";
  const setFeedback = (update: string | ((previous: string) => string)) => {
    if (!pendingAnnotation) return;
    const id = pendingAnnotation.id;
    setFeedbackById((current) => ({
      ...current,
      [id]: typeof update === "function" ? update(current[id] ?? "") : update,
    }));
  };
  const dismissAnnotation = () => {
    if (pendingAnnotation) preview.dismissPendingAnnotation(pendingAnnotation.id);
  };
  const { recording } = capture;
  const captureDraft =
    capture.drafts.find(
      (draft) => draft.sessionId === (sessionId ?? "") && draft.projectId === projectId,
    ) ?? null;
  const captureNote = captureDraft ? (captureNotesById[captureDraft.id] ?? "") : "";
  const setCaptureNote = (note: string) => {
    if (captureDraft) setCaptureNotesById((current) => ({ ...current, [captureDraft.id]: note }));
  };
  const setCaptureDraft = (_draft: null) => {
    if (captureDraft) capture.dismissDraft(captureDraft.id);
  };
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, [frameRef]);

  useEffect(() => {
    if (
      annotationMode !== "off" &&
      annotationOrigin &&
      (annotationOrigin.sessionId !== sessionId || annotationOrigin.projectId !== projectId)
    )
      setAnnotationMode("off");
  }, [annotationMode, annotationOrigin, sessionId, projectId, setAnnotationMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem("ade.browser.searchEngine", searchEngine);
      window.localStorage.setItem("ade.browser.customSearch", customSearch);
    } catch {
      // Storage is optional.
    }
  }, [searchEngine, customSearch]);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    void getBrowserSettings(projectId, tabs?.activeId ?? undefined, sessionId)
      .then((next) => {
        if (!alive) return;
        setSettings(next);
        setDeviceWidth(String(next.viewport.width));
        setDeviceHeight(String(next.viewport.height));
      })
      .catch((error: unknown) => {
        if (alive)
          setBrowserError(
            error instanceof Error ? error.message : "Could not load browser settings.",
          );
      });
    return () => {
      alive = false;
    };
  }, [projectId, sessionId, tabs?.activeId]);

  useEffect(() => {
    if (!viewport) return;
    setSettings((current) => ({
      ...current,
      viewport: { width: viewport.width, height: viewport.height },
    }));
    setDeviceWidth(String(viewport.width));
    setDeviceHeight(String(viewport.height));
  }, [viewport?.width, viewport?.height]);

  const adjust = async (change: Partial<BrowserSettings> & { clear?: "cookies" | "cache" }) => {
    if (!projectId) return;
    const tabId = tabs?.activeId ?? null;
    try {
      const next = await adjustBrowserSettings(projectId, change, tabId ?? undefined, sessionId);
      if (activeTabRef.current !== tabId) return;
      setSettings(next);
      setDeviceWidth(String(next.viewport.width));
      setDeviceHeight(String(next.viewport.height));
      if (change.zoomFactor !== undefined)
        window.dispatchEvent(
          new CustomEvent(BROWSER_ZOOM_EVENT, { detail: { factor: next.zoomFactor } }),
        );
      setBrowserError("");
    } catch (error) {
      setBrowserError(
        error instanceof Error ? error.message : "Could not change browser settings.",
      );
    }
  };
  const changeZoom = (delta: number) => {
    const current = ZOOM_LEVELS.indexOf(settings.zoomFactor);
    const index = current < 0 ? ZOOM_LEVELS.indexOf(1) : current;
    void adjust({
      zoomFactor: ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index + delta))]!,
    });
  };

  useBrowserShortcuts({
    frameRef,
    inputRef,
    enabled: canOperate,
    refresh: () => send({ type: "reload" }),
    zoomIn: () => changeZoom(1),
    zoomOut: () => changeZoom(-1),
    resetZoom: () => void adjust({ zoomFactor: 1 }),
  });

  const takeToNavigate = canOperate ? undefined : "Take over to navigate";

  const applyViewportDimensions = () => {
    setFillViewport(false);
    const width = Number(deviceWidth);
    const height = Number(deviceHeight);
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 240 ||
      width > 3840 ||
      height < 240 ||
      height > 3840 ||
      width * height > 3840 * 2160
    ) {
      setDeviceWidth(String(settings.viewport.width));
      setDeviceHeight(String(settings.viewport.height));
      return;
    }
    if (width !== settings.viewport.width || height !== settings.viewport.height)
      void adjust({ viewport: { width, height } });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = (draft ?? "").trim();
    if (next)
      send({
        type: "navigate",
        url: resolveAddressBarInput(next, resolveSearchUrlTemplate(searchEngine, customSearch)),
      });
    setDraft(null);
    inputRef.current?.blur();
  };

  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setDraft(null);
    inputRef.current?.blur();
  };

  const toggleFullscreen = () => {
    const frame = frameRef.current;
    if (!frame) return;
    if (document.fullscreenElement === frame) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void frame.requestFullscreen().catch(() => undefined);
    }
  };

  const openDevtools = () => {
    if (!projectId) return;
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setBrowserError("Allow pop-ups to open developer tools.");
      return;
    }
    popup.opener = null;
    void getBrowserDevtools(projectId, tabs?.activeId, sessionId)
      .then(({ socketPath }) => {
        const url = new URL("/api/devtools/devtools_app.html", window.location.href);
        const key = window.location.protocol === "https:" ? "wss" : "ws";
        url.searchParams.set(key, `${window.location.host}${socketPath}`);
        popup.location.replace(url.href);
      })
      .catch((error: unknown) => {
        popup.close();
        setBrowserError(error instanceof Error ? error.message : "Could not open developer tools.");
      });
  };

  const sendFeedback = async (files: File | File[], note: string, label: string, pageUrl = url) => {
    if (!sessionId) return;
    const attachments = await Promise.all(
      (Array.isArray(files) ? files : [files]).map((file) =>
        file.name === "browser-recording.webm"
          ? uploadBrowserRecording(file)
          : uploadAttachment(file),
      ),
    );
    const urlLine = pageUrl ? `\nPage: ${pageUrl}` : "";
    await steer(
      sessionId,
      `${label}${urlLine}${note.trim() ? `\n\n${note.trim()}` : ""}`,
      attachments.map((attachment) => attachment.id),
      running ? "later" : undefined,
    );
  };

  const annotationText = () =>
    pendingAnnotation ? formatAnnotationFeedback(pendingAnnotation, feedback) : "";

  const screenshot = () => {
    if (hasFrame) capture.screenshot(sessionId ?? "", url);
  };
  const toggleRecording = () => {
    if (recording) capture.stopRecording();
    else if (hasFrame) capture.startRecording(sessionId ?? "", url);
  };

  return (
    <>
      {tabs ? (
        <div
          role="tablist"
          aria-label="Browser tabs"
          className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-line bg-panel px-2 pt-1"
        >
          {tabs.tabs.map((tab) => {
            let title = tab.title || "New tab";
            if (!tab.title && tab.url && tab.url !== "about:blank") {
              try {
                title = new URL(tab.url).hostname || tab.url;
              } catch {
                title = tab.url;
              }
            }
            return (
              <div
                key={tab.id}
                className={`flex min-w-0 max-w-44 items-center rounded-t-md ${tabs.activeId === tab.id ? "bg-paper text-ink" : "text-dim"}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={tabs.activeId === tab.id}
                  disabled={!canOperate}
                  title={
                    canOperate
                      ? `${title}${tab.profileId ? ` · ${profiles.find((profile) => profile.id === tab.profileId)?.name ?? tab.profileId}` : ""}`
                      : "Take over to switch tabs"
                  }
                  onClick={() => send({ type: "tab", action: "select", id: tab.id })}
                  className="flex min-w-0 items-center gap-1 px-2 py-1.5 text-xs disabled:opacity-60"
                >
                  {tab.favicon ? (
                    <img src={tab.favicon} alt="" className="size-3 shrink-0 object-contain" />
                  ) : (
                    <Globe className="size-3 shrink-0" aria-hidden />
                  )}
                  <span className="truncate">{title}</span>
                  {tab.profileId && tab.profileId !== "default" ? (
                    <span className="max-w-16 truncate text-[10px] text-dim">
                      {profiles.find((profile) => profile.id === tab.profileId)?.name ??
                        tab.profileId}
                    </span>
                  ) : null}
                  {capture.recordingTabs.includes(tab.id) ? (
                    <span
                      aria-label="Recording"
                      className="size-1.5 shrink-0 rounded-full bg-danger"
                    />
                  ) : null}
                </button>
                {tab.audio ? (
                  <button
                    type="button"
                    aria-label={`${tab.audio.muted ? "Unmute" : "Mute"} ${title}`}
                    title={`${tab.audio.muted ? "Unmute" : "Mute"} tab${tab.audio.audible ? " · playing audio" : ""}`}
                    disabled={!canOperate}
                    onClick={() =>
                      send({ type: "tab-audio", id: tab.id, muted: !tab.audio!.muted })
                    }
                    className="grid size-6 shrink-0 place-items-center rounded hover:bg-ink/[0.06] disabled:opacity-40"
                  >
                    {tab.audio.muted ? (
                      <VolumeX className="size-3" aria-hidden />
                    ) : (
                      <Volume2 className="size-3" aria-hidden />
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={`Close ${title}`}
                  disabled={!canOperate}
                  onClick={() => send({ type: "tab", action: "close", id: tab.id })}
                  className="grid size-6 shrink-0 place-items-center rounded hover:bg-ink/[0.06] disabled:opacity-40"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            aria-label="New browser tab"
            title={canOperate ? "New browser tab" : "Take over to open a tab"}
            disabled={!canOperate}
            onClick={() => send({ type: "tab", action: "new" })}
            className={ICON_BUTTON}
          >
            <Plus className="size-4" aria-hidden />
          </button>
          {profiles.length > 1 ? (
            <select
              aria-label="Open browser tab in a profile"
              title="Open browser tab in a profile"
              disabled={!canOperate}
              value=""
              onChange={(event) => {
                if (event.target.value)
                  send({ type: "tab", action: "new", profileId: event.target.value });
              }}
              className="w-5 shrink-0 bg-transparent text-xs text-dim disabled:opacity-40"
            >
              <option value="" disabled>
                Profile
              </option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : null}
      <div className="relative flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
        <button
          type="button"
          aria-label="Back"
          title={takeToNavigate ?? "Back"}
          disabled={!canOperate || !nav?.canGoBack}
          onClick={() => send({ type: "history", delta: -1 })}
          className={ICON_BUTTON}
        >
          <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Forward"
          title={takeToNavigate ?? "Forward"}
          disabled={!canOperate || !nav?.canGoForward}
          onClick={() => send({ type: "history", delta: 1 })}
          className={ICON_BUTTON}
        >
          <ArrowRight className="size-4" strokeWidth={1.5} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={nav?.loading ? "Stop loading" : "Reload"}
          title={takeToNavigate ?? (nav?.loading ? "Stop loading" : "Reload")}
          disabled={!canOperate}
          onClick={() => send(nav?.loading ? { type: "stop-loading" } : { type: "reload" })}
          className={ICON_BUTTON}
        >
          {nav?.loading ? (
            <X className="size-4" strokeWidth={1.5} aria-hidden />
          ) : (
            <RotateCw className="size-4" strokeWidth={1.5} aria-hidden />
          )}
        </button>

        <form onSubmit={submit} className="group relative flex min-w-0 flex-1">
          <input
            ref={inputRef}
            aria-label="Search or enter URL"
            value={draft ?? url}
            readOnly={!canOperate}
            placeholder="Search or enter URL"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={() => setDraft(null)}
            onKeyDown={handleKey}
            className="h-7 w-full min-w-0 rounded-md bg-paper pr-9 pl-3 font-mono text-xs text-ink ring-1 ring-line ring-inset outline-none placeholder:text-dim read-only:text-dim focus-visible:outline-2 focus-visible:outline-amber"
          />
          {/^https?:\/\//i.test(url) ? (
            <button
              type="button"
              aria-label="Open in system browser"
              title="Open in system browser"
              onClick={() => openExternally(url)}
              className="absolute top-0 right-0 grid size-7 place-items-center rounded text-dim opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
            >
              <ExternalLink className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </form>

        <button
          type="button"
          aria-label={
            annotationMode === "off" ? "Annotate preview" : `Annotation mode: ${annotationMode}`
          }
          title={
            annotationMode === "off"
              ? "Annotate elements, regions, and drawings"
              : "Cancel annotation (Esc)"
          }
          aria-pressed={annotationMode !== "off"}
          disabled={!hasFrame || !sessionId}
          onClick={() => {
            if (annotationMode === "off" && projectId && sessionId) {
              setAnnotationOrigin({
                projectId,
                sessionId,
                tabId: tabs?.activeId ?? null,
                pageUrl: url,
              });
              setAnnotationMode("element");
            } else setAnnotationMode("off");
          }}
          className={`${ICON_BUTTON} ${annotationMode !== "off" ? "bg-surface-muted text-ink ring-1 ring-line ring-inset" : ""}`}
        >
          <MousePointer2 className="size-4" strokeWidth={1.5} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={recording ? "Stop recording" : "Capture screenshot"}
          title={recording ? "Stop recording" : "Screenshot · Shift-click to record"}
          disabled={!hasFrame && !recording}
          onClick={(event) => (recording || event.shiftKey ? toggleRecording() : screenshot())}
          className={`${ICON_BUTTON} ${recording ? "text-danger" : ""}`}
        >
          <span className="relative">
            <Camera className="size-4" strokeWidth={1.5} aria-hidden />
            {recording ? (
              <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-danger" />
            ) : null}
          </span>
        </button>
        <button
          type="button"
          aria-label="Float preview over chat"
          title="Float preview over chat"
          onClick={() => setPlace("float")}
          className={ICON_BUTTON}
        >
          <PictureInPicture2 className="size-4" strokeWidth={1.5} aria-hidden />
        </button>
        <details className="relative">
          <summary
            aria-label="More browser actions"
            title="More"
            className={`${ICON_BUTTON} list-none cursor-pointer`}
          >
            <MoreVertical className="size-4" strokeWidth={1.5} aria-hidden />
          </summary>
          <div className="absolute right-0 top-8 z-20 grid max-h-[min(32rem,80vh)] min-w-44 gap-1 overflow-y-auto rounded-lg border border-line bg-panel p-1.5 shadow-xl">
            <p className="px-2 py-1 text-xs text-dim">Page audio plays on the ADE host computer.</p>
            {devServer ? (
              <button
                type="button"
                disabled={!canOperate}
                title={takeToNavigate}
                onClick={() =>
                  send({ type: "navigate", url: `http://localhost:${devServer.port}` })
                }
                className="rounded px-2 py-1.5 text-left text-xs hover:bg-surface-muted disabled:opacity-40"
              >
                Open local server :{devServer.port}
              </button>
            ) : null}
            <button
              type="button"
              disabled={!hasFrame}
              onClick={openDevtools}
              className="rounded px-2 py-1.5 text-left text-xs hover:bg-surface-muted disabled:opacity-40"
            >
              Open developer tools
            </button>
            <button
              type="button"
              disabled={!/^https?:\/\//i.test(url)}
              onClick={() => openExternally(url)}
              className="rounded px-2 py-1.5 text-left text-xs hover:bg-surface-muted disabled:opacity-40"
            >
              Open in system browser
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="rounded px-2 py-1.5 text-left text-xs hover:bg-surface-muted"
            >
              {fullscreen ? "Exit full screen" : "Full screen"}
            </button>
            <button
              type="button"
              disabled={!canvas || !supportsBrowserPictureInPicture()}
              title={
                supportsBrowserPictureInPicture()
                  ? "Show the page in its own operating-system window"
                  : "This browser cannot open a picture-in-picture window"
              }
              onClick={() => {
                if (!canvas) return;
                void openBrowserPictureInPicture(canvas, "ADE browser").catch((error: unknown) =>
                  setBrowserError(
                    error instanceof Error ? error.message : "Could not open the preview window.",
                  ),
                );
              }}
              className="rounded px-2 py-1.5 text-left text-xs hover:bg-surface-muted disabled:opacity-40"
            >
              Pop out window
            </button>
            <button
              type="button"
              className="rounded px-2 py-1.5 text-left text-xs hover:bg-surface-muted"
              disabled={!canOperate}
              onClick={() => send({ type: "reload", ignoreCache: true })}
            >
              Hard reload
            </button>
            <button
              type="button"
              className="rounded px-2 py-1.5 text-left text-xs hover:bg-surface-muted"
              onClick={() => setDeviceToolbar(!deviceToolbar)}
            >
              {deviceToolbar ? "Hide device toolbar" : "Show device toolbar"}
            </button>
            <label className="grid gap-1 rounded px-2 py-1.5 text-xs">
              Appearance
              <select
                aria-label="Page appearance"
                className="rounded border border-line bg-paper p-1"
                value={settings.colorScheme}
                onChange={(event) =>
                  void adjust({ colorScheme: event.target.value as BrowserSettings["colorScheme"] })
                }
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label className="grid gap-1 rounded px-2 py-1.5 text-xs">
              Search engine
              <select
                aria-label="Search engine"
                value={searchEngine}
                onChange={(event) => setSearchEngine(event.target.value)}
                className="rounded border border-line bg-paper p-1"
              >
                <option value="duckduckgo">DuckDuckGo</option>
                <option value="google">Google</option>
                <option value="bing">Bing</option>
                <option value="brave">Brave</option>
                <option value="kagi">Kagi</option>
                <option value="ecosia">Ecosia</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label className="grid gap-1 rounded px-2 py-1.5 text-xs">
              Recording frame rate
              <select
                aria-label="Recording frame rate"
                value={recordingFrameRate}
                onChange={(event) => {
                  const value = event.target.value;
                  setRecordingFrameRate(value);
                  try {
                    window.localStorage.setItem("ade.browser.recordingFrameRate", value);
                  } catch {
                    /* Storage is optional. */
                  }
                }}
                className="rounded border border-line bg-paper p-1"
              >
                <option value="30">30 fps</option>
                <option value="60">60 fps</option>
              </select>
            </label>
            <label className="flex items-center gap-2 rounded px-2 py-1.5 text-xs">
              <input
                type="checkbox"
                checked={recordingMousePresses}
                onChange={(event) => {
                  const value = event.target.checked;
                  setRecordingMousePresses(value);
                  try {
                    window.localStorage.setItem(
                      "ade.browser.recordingShowMousePresses",
                      value ? "1" : "0",
                    );
                  } catch {
                    /* Storage is optional. */
                  }
                }}
              />{" "}
              Show mouse clicks in recordings
            </label>
            <label
              title="Typed keys appear in recordings; password fields and uninspectable frames are hidden."
              className="flex items-center gap-2 rounded px-2 py-1.5 text-xs"
            >
              <input
                type="checkbox"
                checked={recordingKeyPresses}
                onChange={(event) => {
                  const value = event.target.checked;
                  setRecordingKeyPresses(value);
                  try {
                    window.localStorage.setItem(
                      "ade.browser.recordingShowKeyPresses",
                      value ? "1" : "0",
                    );
                  } catch {
                    /* Storage is optional. */
                  }
                }}
              />{" "}
              Show key presses in recordings
            </label>
            {searchEngine === "custom" ? (
              <label className="grid gap-1 rounded px-2 py-1.5 text-xs">
                Search URL (%s for query)
                <input
                  aria-label="Custom search URL"
                  value={customSearch}
                  onChange={(event) => setCustomSearch(event.target.value)}
                  placeholder="https://example.com/?q=%s"
                  className="rounded border border-line bg-paper p-1"
                />
                {!isValidSearchUrlTemplate(customSearch) ? (
                  <span className="text-danger">
                    Enter an http(s) URL with %s in its path or query.
                  </span>
                ) : null}
              </label>
            ) : null}
            <div className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs">
              <span>Zoom</span>
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => changeZoom(-1)}
                className="btn-quiet px-2"
              >
                −
              </button>
              <button
                type="button"
                title="Reset zoom"
                onClick={() => void adjust({ zoomFactor: 1 })}
              >
                {Math.round(settings.zoomFactor * 100)}%
              </button>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => changeZoom(1)}
                className="btn-quiet px-2"
              >
                +
              </button>
            </div>
            <button
              type="button"
              className="rounded px-2 py-1.5 text-left text-xs hover:bg-surface-muted"
              onClick={() => void adjust({ clear: "cookies" })}
            >
              Clear cookies
            </button>
            <button
              type="button"
              className="rounded px-2 py-1.5 text-left text-xs hover:bg-surface-muted"
              onClick={() => void adjust({ clear: "cache" })}
            >
              Clear cache
            </button>
            <button
              type="button"
              className="rounded px-2 py-1.5 text-left text-xs hover:bg-surface-muted"
              disabled={!url}
              onClick={() => void navigator.clipboard?.writeText(url)}
            >
              Copy page address
            </button>
          </div>
        </details>
        {nav?.loading ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-amber motion-safe:animate-pulse"
          />
        ) : null}
      </div>
      {deviceToolbar ? (
        <form
          aria-label="Browser device toolbar"
          className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-2 py-1 text-xs"
          onSubmit={(event) => {
            event.preventDefault();
            applyViewportDimensions();
          }}
          onBlur={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            )
              applyViewportDimensions();
          }}
        >
          <select
            aria-label="Device preset"
            className="min-w-0 rounded border border-line bg-paper p-1"
            value={fillViewport ? "fill" : devicePreset}
            onChange={(event) => {
              const selected = event.target.value;
              setDevicePreset(selected);
              if (selected === "fill") {
                setFillViewport(true);
                return;
              }
              setFillViewport(false);
              const preset = DEVICE_PRESETS.find(([label]) => label === selected);
              const viewport = preset
                ? { width: preset[1], height: preset[2] }
                : DEFAULT_SETTINGS.viewport;
              if (aspectRatio !== null) setAspectRatio(viewport.width / viewport.height);
              void adjust({ viewport });
            }}
          >
            <option value="fill">Fill pane</option>
            <option value="responsive">Responsive</option>
            {DEVICE_PRESETS.map(([label, width, height]) => (
              <option key={label} value={label}>
                {label} · {width} × {height}
              </option>
            ))}
          </select>
          <input
            aria-label="Viewport width"
            type="number"
            min="240"
            max="3840"
            value={deviceWidth}
            onChange={(event) => {
              const value = event.target.value;
              setFillViewport(false);
              setDevicePreset("responsive");
              setDeviceWidth(value);
              if (aspectRatio && Number(value) > 0)
                setDeviceHeight(String(Math.round(Number(value) / aspectRatio)));
            }}
            className="w-16 rounded border border-line bg-paper p-1"
          />
          <span>×</span>
          <input
            aria-label="Viewport height"
            type="number"
            min="240"
            max="3840"
            value={deviceHeight}
            onChange={(event) => {
              const value = event.target.value;
              setFillViewport(false);
              setDevicePreset("responsive");
              setDeviceHeight(value);
              if (aspectRatio && Number(value) > 0)
                setDeviceWidth(String(Math.round(Number(value) * aspectRatio)));
            }}
            className="w-16 rounded border border-line bg-paper p-1"
          />
          <button type="submit" className="btn-quiet px-2 py-1">
            Apply
          </button>
          <button
            type="button"
            aria-label={aspectRatio === null ? "Lock aspect ratio" : "Unlock aspect ratio"}
            aria-pressed={aspectRatio !== null}
            className="btn-quiet px-2 py-1"
            onClick={() =>
              setAspectRatio(
                aspectRatio === null ? settings.viewport.width / settings.viewport.height : null,
              )
            }
          >
            {aspectRatio === null ? "Lock" : "Unlock"}
          </button>
          <button
            type="button"
            className="btn-quiet px-2 py-1"
            aria-label="Rotate viewport"
            onClick={() => {
              if (aspectRatio !== null) setAspectRatio(1 / aspectRatio);
              setFillViewport(false);
              setDevicePreset("responsive");
              void adjust({
                viewport: { width: settings.viewport.height, height: settings.viewport.width },
              });
            }}
          >
            Rotate
          </button>
          <button
            type="button"
            className="btn-quiet px-2 py-1"
            aria-label="Close device toolbar"
            onClick={() => setDeviceToolbar(false)}
          >
            ×
          </button>
        </form>
      ) : null}
      {capture.error ? (
        <p role="alert" className="border-b border-line bg-panel px-3 py-1.5 text-xs text-danger">
          {capture.error}{" "}
          <button type="button" onClick={() => capture.setError(null)}>
            Dismiss
          </button>
        </p>
      ) : null}
      {browserError ? (
        <p role="alert" className="border-b border-line bg-panel px-3 py-1.5 text-xs text-danger">
          {browserError}
        </p>
      ) : null}
      {captureDraft ? (
        <div
          role="dialog"
          aria-label={captureDraft.label}
          className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-lg rounded-xl border border-line bg-panel p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between text-xs font-medium">
            <span>{captureDraft.label}</span>
            <button
              type="button"
              disabled={sendingCapture}
              onClick={() => {
                setCaptureDraft(null);
                setCaptureNote("");
              }}
              className="text-dim"
            >
              Close
            </button>
          </div>
          <p className="mb-2 text-xs text-dim">
            {captureDraft.files.map((file) => file.name).join(" · ")}
          </p>
          {captureDraft.files[0] ? <CapturePreview file={captureDraft.files[0]} /> : null}
          <textarea
            value={captureNote}
            onChange={(event) => setCaptureNote(event.target.value)}
            placeholder="What should the agent look at?"
            className="min-h-16 w-full resize-y rounded-md border border-line bg-paper p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-amber"
          />
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="btn-quiet px-2 py-1.5 text-xs"
              onClick={() => {
                const file = captureDraft.files[0]!;
                const saved = recordingAttachmentUrl(file);
                const address = saved ?? URL.createObjectURL(file);
                const link = document.createElement("a");
                link.href = address;
                link.download = file.name;
                link.click();
                if (!saved) window.setTimeout(() => URL.revokeObjectURL(address), 60_000);
              }}
            >
              Download
            </button>
            {captureDraft.files[0]?.type === "image/png" ? (
              <button
                type="button"
                className="btn-quiet px-2 py-1.5 text-xs"
                onClick={() => {
                  const file = captureDraft.files[0]!;
                  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
                    setBrowserError("Copying images is not available in this browser.");
                    return;
                  }
                  void navigator.clipboard
                    .write([new ClipboardItem({ [file.type]: file })])
                    .catch((error: unknown) =>
                      setBrowserError(
                        error instanceof Error ? error.message : "Could not copy screenshot.",
                      ),
                    );
                }}
              >
                Copy image
              </button>
            ) : null}
            <button
              type="button"
              disabled={!sessionId || sendingCapture}
              className="btn-quiet px-2 py-1.5 text-xs"
              onClick={async () => {
                if (!sessionId) return;
                setSendingCapture(true);
                try {
                  const hint = captureDraft.files.some((file) => file.type === "video/webm")
                    ? "Review the video, the timestamped contact sheet, the full-size timeline screenshots, and the final frame."
                    : "";
                  await addBrowserFeedback(feedbackScope(projectId!, sessionId), {
                    files: captureDraft.files,
                    text: `${captureDraft.label}${captureDraft.pageUrl ? `\nPage: ${captureDraft.pageUrl}` : ""}\n\n${[captureNote, hint].filter(Boolean).join("\n\n")}`,
                  });
                  setCaptureDraft(null);
                  setCaptureNote("");
                } finally {
                  setSendingCapture(false);
                }
              }}
            >
              Attach to composer
            </button>
            <button
              type="button"
              disabled={!sessionId || sendingCapture}
              className="btn-amber px-3 py-1.5 text-xs disabled:opacity-40"
              onClick={async () => {
                setSendingCapture(true);
                try {
                  const hint = captureDraft.files.some((file) => file.type === "video/webm")
                    ? "Review the video, the timestamped contact sheet, the full-size timeline screenshots, and the final frame."
                    : "";
                  await sendFeedback(
                    captureDraft.files,
                    [captureNote, hint].filter(Boolean).join("\n\n"),
                    captureDraft.label,
                    captureDraft.pageUrl,
                  );
                  setCaptureDraft(null);
                  setCaptureNote("");
                } catch (error) {
                  setBrowserError(
                    error instanceof Error ? error.message : "Could not send browser feedback.",
                  );
                } finally {
                  setSendingCapture(false);
                }
              }}
            >
              Send feedback
            </button>
          </div>
        </div>
      ) : null}
      {pendingAnnotation ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Send browser annotation"
          className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-h-[85vh] max-w-lg overflow-y-auto rounded-xl border border-line bg-panel p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between text-xs font-medium">
            <span>Send annotation to conversation</span>
            <button
              type="button"
              disabled={sendingAnnotation}
              onClick={() => {
                dismissAnnotation();
                setFeedback("");
              }}
              className="text-dim"
            >
              Cancel
            </button>
          </div>
          <textarea
            autoFocus
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="What should the agent change here?"
            className="min-h-16 w-full resize-y rounded-md border border-line bg-paper p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-amber"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={!sessionId || sendingAnnotation}
              onClick={async () => {
                if (!sessionId) return;
                setSendingAnnotation(true);
                try {
                  await addBrowserFeedback(feedbackScope(projectId!, sessionId), {
                    text: `Browser annotation${pendingAnnotation.origin.pageUrl ? `\nPage: ${pendingAnnotation.origin.pageUrl}` : ""}\n\n${annotationText()}`,
                    files: [
                      pendingAnnotation.file,
                      ...(pendingAnnotation.detail ? [pendingAnnotation.detail] : []),
                    ],
                  });
                  dismissAnnotation();
                  setFeedback("");
                } finally {
                  setSendingAnnotation(false);
                }
              }}
              className="btn-quiet mr-2 px-3 py-1.5 text-xs"
            >
              Attach to composer
            </button>
            <button
              type="button"
              disabled={!sessionId || sendingAnnotation}
              onClick={async () => {
                setSendingAnnotation(true);
                try {
                  await sendFeedback(
                    [
                      pendingAnnotation.file,
                      ...(pendingAnnotation.detail ? [pendingAnnotation.detail] : []),
                    ],
                    annotationText(),
                    "Browser annotation",
                    pendingAnnotation.origin.pageUrl,
                  );
                  dismissAnnotation();
                  setFeedback("");
                } catch (error) {
                  setBrowserError(
                    error instanceof Error ? error.message : "Could not send annotation.",
                  );
                } finally {
                  setSendingAnnotation(false);
                }
              }}
              className="btn-amber px-3 py-1.5 text-xs"
            >
              Send feedback
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
