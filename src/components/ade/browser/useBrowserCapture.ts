// Recording lifecycle follows T3 Code's browserRecording.ts and recordingCompositor.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { connectBrowserStream, type BrowserStream } from "@/lib/ade/browser/browserStream";
import { browserViewerId } from "@/lib/ade/browser/viewer";
import {
  DEFAULT_VIEWPORT,
  BROWSER_RENDER_SCALE,
  RECORDING_STORAGE_KEYS,
} from "@/shared/browser-contract.mjs";
import { withBrowserSession } from "@/lib/ade/browser/api";
import { createRecordingUpload } from "@/lib/ade/browser/recordingUpload";
import { MAX_BROWSER_RECORDING_BYTES } from "@/lib/ade/browser/composerFeedback";
import { persistFeedbackFile, restoreFeedbackFile } from "@/lib/ade/browser/feedbackPersistence";
import { feedbackScope, usePersistentFeedbackList } from "./usePersistentFeedbackList";
import {
  CAPTURE_IMAGE_LIMIT,
  captureImageFile,
  encodeCaptureImage,
  fitCaptureImage,
} from "./captureImage";

const captureId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const ACTIVE_TAB = "active";
// Stop cleanly if disk or network cannot keep up instead of retaining an unbounded video in RAM.
const RECORDING_BACKLOG_LIMIT = 128 * 1024 * 1024;
// Together the sheet, three detailed frames and final image fit within 12 MB, leaving
// room for other attachments under the 20 MB per-message limit.
const TIMELINE_IMAGE_LIMIT = 2 * 1024 * 1024;
const FINAL_IMAGE_LIMIT = 4 * 1024 * 1024;

export interface BrowserCaptureDraft {
  readonly id: string;
  readonly files: File[];
  readonly label: string;
  readonly pageUrl: string;
  readonly projectId: string;
  readonly sessionId: string;
}

type StoredCaptureDraft = Omit<BrowserCaptureDraft, "files"> & {
  files: ReturnType<typeof persistFeedbackFile>[];
};
const encodeCaptureDraft = (draft: BrowserCaptureDraft): StoredCaptureDraft => ({
  ...draft,
  files: draft.files.map(persistFeedbackFile),
});
const decodeCaptureDraft = (draft: StoredCaptureDraft): BrowserCaptureDraft => ({
  ...draft,
  files: draft.files.map(restoreFeedbackFile),
});
const captureScope = (draft: BrowserCaptureDraft) =>
  feedbackScope(draft.projectId, draft.sessionId);

interface CapturePointer {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly source: "agent" | "human";
  readonly tabId?: string | null;
  readonly phase?: "move" | "click" | "down";
}

interface Recording {
  readonly tabId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly canvas: HTMLCanvasElement;
  readonly recorder: MediaRecorder;
  readonly media: MediaStream;
  readonly frames: { canvas: HTMLCanvasElement; seconds: number; image: Promise<Blob | null> }[];
  readonly upload: Awaited<ReturnType<typeof createRecordingUpload>>;
  readonly startedAt: number;
  readonly showMousePresses: boolean;
  readonly showKeyPresses: boolean;
  clickUntil: number;
  clickTimer: number | null;
  keyLabel: string | null;
  keyUntil: number;
  keyTimer: number | null;
  pinnedViewport: { width: number; height: number };
  pointer: CapturePointer | null;
  pinned: BrowserStream | null;
  pinnedFrame: ImageBitmap | null;
  timer: number | null;
}

function paintRecording(recording: Recording, bitmap: ImageBitmap) {
  const { canvas, pointer } = recording;
  if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
  if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.drawImage(bitmap, 0, 0);
  if (recording.showKeyPresses && recording.keyLabel && performance.now() < recording.keyUntil) {
    context.save();
    context.font = `${Math.max(18, Math.round(canvas.width / 55))}px sans-serif`;
    const width = context.measureText(recording.keyLabel).width + 28;
    const height = Math.max(32, Math.round(canvas.height / 18));
    const x = (canvas.width - width) / 2;
    const y = canvas.height - height - 20;
    context.fillStyle = "rgba(0, 0, 0, 0.8)";
    context.fillRect(x, y, width, height);
    context.fillStyle = "white";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(recording.keyLabel, canvas.width / 2, y + height / 2);
    context.restore();
  }
  if (!pointer || !pointer.width || !pointer.height) return;
  context.save();
  context.scale(canvas.width / pointer.width, canvas.height / pointer.height);
  context.translate(pointer.x, pointer.y);
  if (recording.showMousePresses && performance.now() < recording.clickUntil) {
    context.beginPath();
    context.arc(0, 0, 15, 0, Math.PI * 2);
    context.fillStyle = "rgba(255, 190, 30, 0.35)";
    context.fill();
  }
  context.lineJoin = "round";
  context.lineWidth = 1.5;
  context.fillStyle = pointer.source === "agent" ? "white" : "black";
  context.strokeStyle = pointer.source === "agent" ? "#2563eb" : "white";
  context.beginPath();
  context.moveTo(1, 1);
  context.lineTo(1, 19);
  context.lineTo(5, 15);
  context.lineTo(9, 23);
  context.lineTo(12, 21.5);
  context.lineTo(8, 13.5);
  context.lineTo(15, 13);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}

function sampleFrame(recording: Recording) {
  const thumb = document.createElement("canvas");
  thumb.width = 640;
  thumb.height = 400;
  const context = thumb.getContext("2d");
  if (context) {
    context.fillStyle = "black";
    context.fillRect(0, 0, thumb.width, thumb.height);
    const scale = Math.min(
      thumb.width / recording.canvas.width,
      thumb.height / recording.canvas.height,
    );
    const width = recording.canvas.width * scale;
    const height = recording.canvas.height * scale;
    context.drawImage(
      recording.canvas,
      (thumb.width - width) / 2,
      (thumb.height - height) / 2,
      width,
      height,
    );
  }
  const frames = recording.frames;
  // Preserve this moment while the live recording canvas continues to change.
  const full = document.createElement("canvas");
  full.width = recording.canvas.width;
  full.height = recording.canvas.height;
  full.getContext("2d")?.drawImage(recording.canvas, 0, 0);
  frames.push({
    canvas: thumb,
    seconds: Math.round((performance.now() - recording.startedAt) / 1000),
    // Keep detailed images so agents can inspect text unreadable in the contact sheet.
    image: encodeCaptureImage(full, TIMELINE_IMAGE_LIMIT, false),
  });
  if (frames.length > 12) {
    let remove = 1;
    const gap = (i: number) =>
      Math.min(
        frames[i]!.seconds - frames[i - 1]!.seconds,
        frames[i + 1]!.seconds - frames[i]!.seconds,
      );
    for (let index = 2; index < frames.length - 1; index++)
      if (gap(index) < gap(remove)) remove = index;
    frames.splice(remove, 1);
  }
}

function contactSheet(frames: Recording["frames"]): Promise<Blob | null> {
  const sheet = document.createElement("canvas");
  sheet.width = 1280;
  sheet.height = Math.ceil(frames.length / 2) * 400;
  const context = sheet.getContext("2d");
  frames.forEach((frame, index) => {
    const x = (index % 2) * 640;
    const y = Math.floor(index / 2) * 400;
    context?.drawImage(frame.canvas, x, y);
    if (context) {
      context.fillStyle = "rgba(0,0,0,.75)";
      context.fillRect(x + 6, y + 6, 64, 22);
      context.fillStyle = "white";
      context.font = "14px sans-serif";
      context.fillText(`${frame.seconds}s`, x + 12, y + 22);
    }
  });
  return encodeCaptureImage(sheet, TIMELINE_IMAGE_LIMIT, false);
}

/** Recordings belong to tabs and continue while the preview changes position or tab. */
export function useBrowserCapture(
  projectId: string | null,
  conversationId: string | null,
  frameRef: RefObject<ImageBitmap | null>,
) {
  const [recordingTabs, setRecordingTabs] = useState<string[]>([]);
  const [drafts, setDrafts] = usePersistentFeedbackList(
    "capture-review",
    projectId ? feedbackScope(projectId, conversationId ?? "") : null,
    captureScope,
    encodeCaptureDraft,
    decodeCaptureDraft,
  );
  const [error, setError] = useState<string | null>(null);
  const recordings = useRef(new Map<string, Recording>());
  const starting = useRef(new Set<string>());
  const currentScope = useRef({ projectId, conversationId, mounted: true });
  currentScope.current.projectId = projectId;
  currentScope.current.conversationId = conversationId;

  const paintCaptureFrame = useCallback(
    (bitmap: ImageBitmap) => {
      for (const item of recordings.current.values())
        if (!item.pinned && item.sessionId === (conversationId ?? "")) paintRecording(item, bitmap);
    },
    [conversationId],
  );

  const recordPointer = useCallback(
    (pointer: CapturePointer) => {
      for (const item of recordings.current.values()) {
        if (item.sessionId !== (conversationId ?? "")) continue;
        if (item.tabId !== ACTIVE_TAB && pointer.tabId && item.tabId !== pointer.tabId) continue;
        item.pointer = pointer;
        if (item.showMousePresses && (pointer.phase === "click" || pointer.phase === "down")) {
          item.clickUntil = performance.now() + 500;
          if (item.clickTimer !== null) window.clearTimeout(item.clickTimer);
          item.clickTimer = window.setTimeout(() => {
            const frame = item.pinned ? item.pinnedFrame : frameRef.current;
            if (frame && item.recorder.state === "recording") paintRecording(item, frame);
          }, 520);
        }
        const bitmap = item.pinned ? item.pinnedFrame : frameRef.current;
        if (bitmap) paintRecording(item, bitmap);
      }
    },
    [frameRef, conversationId],
  );

  const screenshot = useCallback(
    (sessionId: string, pageUrl: string, tabId?: string) => {
      if (!projectId) return;
      void fetch(
        withBrowserSession(
          `/api/projects/${encodeURIComponent(projectId)}/browser/capture`,
          sessionId,
        ),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(tabId ? { tabId } : {}),
        },
      )
        .then(async (response) => {
          if (!response.ok) {
            const value = (await response.json().catch(() => null)) as { error?: string } | null;
            throw new Error(value?.error ?? "Could not capture the browser screenshot.");
          }
          const blob = await fitCaptureImage(await response.blob(), CAPTURE_IMAGE_LIMIT);
          if (!blob) throw new Error("Could not create an image small enough to attach.");
          setDrafts((current) => [
            ...current,
            {
              id: captureId(),
              files: [captureImageFile(blob, "browser-screenshot")],
              label: "Browser screenshot",
              pageUrl,
              projectId,
              sessionId,
            },
          ]);
        })
        .catch((cause: unknown) =>
          setError(
            cause instanceof Error ? cause.message : "Could not capture the browser screenshot.",
          ),
        );
    },
    [projectId],
  );

  /** An omitted tab stops every active recording (used during teardown). */
  const stopRecording = useCallback(
    (tabId?: string) => {
      for (const item of recordings.current.values()) {
        if (
          (!tabId || (item.tabId === tabId && item.sessionId === (conversationId ?? ""))) &&
          item.recorder.state === "recording"
        )
          item.recorder.stop();
      }
    },
    [conversationId],
  );

  const startRecording = useCallback(
    async (sessionId: string, pageUrl: string, streamUrl?: string, tabId?: string) => {
      const frame = frameRef.current;
      const tabKey = tabId ?? ACTIVE_TAB;
      const key = JSON.stringify([sessionId, tabKey]);
      if (!frame || !projectId || recordings.current.has(key) || starting.current.has(key)) return;
      if (
        typeof MediaRecorder === "undefined" ||
        typeof HTMLCanvasElement.prototype.captureStream !== "function"
      ) {
        setError("Recording is not available in this browser.");
        return;
      }
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : MediaRecorder.isTypeSupported("video/webm")
          ? "video/webm"
          : null;
      if (!mimeType) {
        setError("This browser cannot record WebM video.");
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = frame.width;
      canvas.height = frame.height;
      canvas.getContext("2d")?.drawImage(frame, 0, 0);
      let frameRate = 30;
      let showMousePresses = false;
      let showKeyPresses = false;
      try {
        frameRate =
          window.localStorage.getItem(RECORDING_STORAGE_KEYS.frameRate) === "60" ? 60 : 30;
        showMousePresses =
          window.localStorage.getItem(RECORDING_STORAGE_KEYS.showMousePresses) === "1";
        showKeyPresses = window.localStorage.getItem(RECORDING_STORAGE_KEYS.showKeyPresses) === "1";
      } catch {
        /* Storage is optional. */
      }
      const media = canvas.captureStream(frameRate);
      const videoBitsPerSecond = Math.round(
        Math.min(50_000_000, Math.max(2_500_000, canvas.width * canvas.height * frameRate * 0.05)),
      );
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(media, { mimeType, videoBitsPerSecond });
      } catch (cause) {
        media.getTracks().forEach((track) => track.stop());
        setError(cause instanceof Error ? cause.message : "Could not start recording.");
        return;
      }
      starting.current.add(key);
      let upload: Awaited<ReturnType<typeof createRecordingUpload>>;
      try {
        upload = await createRecordingUpload((error) => {
          setError(`Could not save the recording: ${error.message}`);
          if (recorder.state !== "inactive") recorder.stop();
        });
      } catch (cause) {
        media.getTracks().forEach((track) => track.stop());
        setError(cause instanceof Error ? cause.message : "Could not start recording.");
        return;
      } finally {
        starting.current.delete(key);
      }
      if (
        !currentScope.current.mounted ||
        currentScope.current.projectId !== projectId ||
        (currentScope.current.conversationId ?? "") !== sessionId
      ) {
        media.getTracks().forEach((track) => track.stop());
        void upload.discard();
        return;
      }
      const item: Recording = {
        tabId: tabKey,
        projectId,
        sessionId,
        canvas,
        recorder,
        media,
        frames: [],
        upload,
        startedAt: performance.now(),
        showMousePresses,
        showKeyPresses,
        clickUntil: 0,
        clickTimer: null,
        keyLabel: null,
        keyUntil: 0,
        keyTimer: null,
        pinnedViewport: { width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height },
        pointer: null,
        pinned: null,
        pinnedFrame: null,
        timer: null,
      };
      recordings.current.set(key, item);
      let recordedBytes = 0;
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        recordedBytes += event.data.size;
        const backlog = item.upload.append(event.data);
        if (recorder.state !== "recording") return;
        if (backlog >= RECORDING_BACKLOG_LIMIT) {
          setError(
            "Recording stopped because saving could not keep up. The captured feedback is available.",
          );
          recorder.stop();
        } else if (recordedBytes >= MAX_BROWSER_RECORDING_BYTES - 64 * 1024 * 1024) {
          // Leave room for MediaRecorder's final chunk so the saved video can be finalized.
          setError("Recording reached its size limit. The captured feedback is available.");
          recorder.stop();
        }
      };
      recorder.onerror = () => setError("The browser recording failed.");
      recorder.onstop = () => {
        sampleFrame(item);
        if (item.timer !== null) window.clearInterval(item.timer);
        if (item.clickTimer !== null) window.clearTimeout(item.clickTimer);
        if (item.keyTimer !== null) window.clearTimeout(item.keyTimer);
        item.media.getTracks().forEach((track) => track.stop());
        const pinned = item.pinned;
        item.pinned = null;
        pinned?.close();
        item.pinnedFrame?.close();
        item.pinnedFrame = null;
        if (recordings.current.get(key) === item) recordings.current.delete(key);
        setRecordingTabs([...recordings.current.keys()]);
        const finalFrame = encodeCaptureImage(item.canvas, FINAL_IMAGE_LIMIT);
        const video = item.upload.finish().catch((cause: unknown) => {
          void item.upload.discard();
          setError(cause instanceof Error ? cause.message : "Could not save the recording.");
          return null;
        });
        const representativeFrames = [
          ...new Set([
            0,
            Math.floor((item.frames.length - 1) / 3),
            Math.floor(((item.frames.length - 1) * 2) / 3),
          ]),
        ].map((index) => item.frames[index]!);
        const fullFrames = Promise.all(
          representativeFrames.map(async (frame) => ({
            seconds: frame.seconds,
            image: await frame.image,
          })),
        );
        void Promise.all([video, contactSheet(item.frames), finalFrame, fullFrames])
          .then(([savedVideo, blob, final, frames]) => {
            const files: File[] = savedVideo ? [savedVideo] : [];
            if (blob) files.push(captureImageFile(blob, "browser-recording-keyframes"));
            frames.forEach(({ seconds, image }, index) => {
              if (image)
                files.push(
                  captureImageFile(image, `browser-recording-frame-${index + 1}-${seconds}s`),
                );
            });
            if (final) files.push(captureImageFile(final, "browser-recording-final-frame"));
            setDrafts((current) => [
              ...current,
              {
                id: captureId(),
                files,
                label: savedVideo ? "Browser recording feedback" : "Browser recording frames",
                pageUrl,
                projectId,
                sessionId,
              },
            ]);
          })
          .catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : "Could not save the recording.");
          });
      };
      try {
        recorder.start(500);
        if (streamUrl && tabId) {
          item.pinned = connectBrowserStream({
            url: streamUrl,
            tabId,
            recordingFrameRate: frameRate === 60 ? 60 : 30,
            showRecordingKeys: showKeyPresses,
            viewer: `${browserViewerId()}-recording-${tabId}`,
            maxWidth: DEFAULT_VIEWPORT.width * BROWSER_RENDER_SCALE,
            maxHeight: DEFAULT_VIEWPORT.height * BROWSER_RENDER_SCALE,
            onFrame: (bitmap) => {
              const old = item.pinnedFrame;
              item.pinnedFrame = bitmap;
              paintRecording(item, bitmap);
              old?.close();
            },
            onViewport: (viewport) => {
              item.pinnedViewport = viewport;
            },
            onControl: () => {},
            onPointer: (pointer) => {
              if (pointer.tabId && pointer.tabId !== tabId) return;
              item.pointer = { ...pointer, ...item.pinnedViewport, source: "agent", tabId };
              if (item.showMousePresses && pointer.phase === "click") {
                item.clickUntil = performance.now() + 500;
                if (item.clickTimer !== null) window.clearTimeout(item.clickTimer);
                item.clickTimer = window.setTimeout(() => {
                  if (item.pinnedFrame && item.recorder.state === "recording")
                    paintRecording(item, item.pinnedFrame);
                }, 520);
              }
              if (item.pinnedFrame) paintRecording(item, item.pinnedFrame);
            },
            onRecordingKey: (label) => {
              item.keyLabel = label;
              item.keyUntil = performance.now() + 900;
              if (item.keyTimer !== null) window.clearTimeout(item.keyTimer);
              if (item.pinnedFrame) paintRecording(item, item.pinnedFrame);
              item.keyTimer = window.setTimeout(() => {
                if (item.pinnedFrame && item.recorder.state === "recording")
                  paintRecording(item, item.pinnedFrame);
              }, 920);
            },
            onNav: () => {},
            onClipboard: () => {},
            onTabs: (tabs) => {
              if (!tabs.tabs.some((tab) => tab.id === tabId) && item.recorder.state === "recording")
                item.recorder.stop();
            },
            onError: (message) => setError(message),
            onStatus: (status) => {
              if (status === "closed" && item.recorder.state === "recording") item.recorder.stop();
            },
          });
        }
        sampleFrame(item);
        item.timer = window.setInterval(() => sampleFrame(item), 2_000);
        setRecordingTabs([...recordings.current.keys()]);
        setError(null);
      } catch (cause) {
        if (recorder.state === "recording") recorder.stop();
        else {
          media.getTracks().forEach((track) => track.stop());
          recordings.current.delete(key);
          void item.upload.discard();
        }
        setError(cause instanceof Error ? cause.message : "Could not start recording.");
      }
    },
    [frameRef, projectId],
  );

  useEffect(() => {
    for (const item of recordings.current.values())
      if (item.projectId !== projectId && item.recorder.state === "recording") item.recorder.stop();
  }, [projectId]);
  useEffect(() => {
    for (const item of recordings.current.values())
      if (
        !item.pinned &&
        item.sessionId !== (conversationId ?? "") &&
        item.recorder.state === "recording"
      )
        item.recorder.stop();
  }, [conversationId]);
  useEffect(() => {
    currentScope.current.mounted = true;
    return () => {
      currentScope.current.mounted = false;
      for (const item of recordings.current.values())
        if (item.recorder.state === "recording") item.recorder.stop();
    };
  }, []);
  const dismissDraft = useCallback(
    (id: string) => setDrafts((current) => current.filter((draft) => draft.id !== id)),
    [],
  );
  return {
    recording: recordingTabs.length > 0,
    recordingTabs: recordingTabs.flatMap((key) => {
      const item = recordings.current.get(key);
      return item?.sessionId === (conversationId ?? "") ? [item.tabId] : [];
    }),
    drafts,
    dismissDraft,
    error,
    setError,
    screenshot,
    startRecording,
    stopRecording,
    paintCaptureFrame,
    recordPointer,
  };
}
