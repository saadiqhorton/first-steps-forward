// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/web/src/browser/ServerBrowserSurface.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Globe, X } from "lucide-react";
import { uploadAttachment, useAde } from "@/lib/ade/store";
import { addBrowserFeedback } from "@/lib/ade/browser/composerFeedback";
import {
  inspectBrowserElement,
  inspectBrowserRegion,
  applyBrowserAnnotationStyle,
  restoreBrowserAnnotationStyles,
  getBrowserAnnotationRects,
  withBrowserSession,
  type InspectedBrowserElement,
  type BrowserAnnotationStyleChange,
} from "@/lib/ade/browser/api";
import {
  buttonFromDomButton,
  modifierBits,
  pagePointFromClient,
  pressedButton,
  wheelDeltaPx,
  wheelMessage,
  keyMessage,
} from "@/lib/ade/browser/streamInput.mjs";
import type {
  BrowserButton,
  BrowserDialog,
  BrowserStreamViewport,
  ClientMessage,
} from "@/lib/ade/browser/browserStream";
import { AgentCursor } from "./AgentCursor";
import { BrowserViewportHandles } from "./BrowserViewportHandles";
import { BrowserAnnotationStyles } from "./BrowserAnnotationStyles";
import { BrowserUnreachable } from "./BrowserUnreachable";
import { BrowserFileNotShown } from "./BrowserFileNotShown";
import { FileChooserPrompt } from "./FileChooserPrompt";
import { PageDialog } from "./PageDialog";
import { formatAnnotationFeedback } from "./annotationFeedback";
import { BROWSER_ZOOM_EVENT } from "@/lib/ade/browser/openInPreview.mjs";
import { feedbackScope } from "./usePersistentFeedbackList";
import { CAPTURE_IMAGE_LIMIT, captureImageFile, encodeCaptureImage } from "./captureImage";
import { useBrowserPreviewFrame, useBrowserPreviewState } from "./browserPreviewContext";
import { MODIFIER_BITS, VIEWPORT_LIMITS } from "@/shared/browser-contract.mjs";

const RESIZE_DEBOUNCE_MS = 150;
const MULTI_CLICK_MS = 500;
const MULTI_CLICK_SLOP_PX = 4;
// Reuse a nearby probe when a slow link answers the tap's probe after it has ended.
const PROBE_REUSE_PX = 24;
const PROBE_REUSE_MS = 10_000;
// Android keyboards report Backspace as text deletion, so keep a deletable sentinel.
const INPUT_SENTINEL = "\u200b";
const BACKSPACE_KEY = { key: "Backspace", code: "Backspace", keyCode: 8 } as const;
const DELETE_KEY = { key: "Delete", code: "Delete", keyCode: 46 } as const;
const COPY_KEY = { key: "c", code: "KeyC", keyCode: 67 } as const;
const CUT_KEY = { key: "x", code: "KeyX", keyCode: 88 } as const;
const CTRL_MODIFIER = MODIFIER_BITS.ctrl;
const TAP_SLOP_PX = 8;

/** A page dialog answer. `key` ties it to the dialog it answers. */
interface DialogReply {
  readonly key: string;
  readonly accept: boolean;
  readonly promptText?: string;
}

function dialogKey(dialog: BrowserDialog): string {
  return `${dialog.type}:${dialog.message}:${dialog.defaultValue}`;
}

function replyMessage(reply: DialogReply): ClientMessage {
  return {
    type: "dialog",
    accept: reply.accept,
    ...(reply.promptText !== undefined ? { promptText: reply.promptText } : {}),
  };
}

interface ClickState {
  readonly button: BrowserButton;
  readonly time: number;
  readonly x: number;
  readonly y: number;
  readonly count: number;
}

interface TouchGesture {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  lastX: number;
  lastY: number;
  panning: boolean;
}

interface PendingProbe {
  readonly x: number;
  readonly y: number;
  editable: boolean | null;
  answered: boolean;
  tapped: boolean;
}

interface MarkGesture {
  readonly mode: "element" | "region" | "draw" | "erase";
  readonly points: readonly { x: number; y: number }[];
  readonly additive?: boolean;
}
interface AnnotationMark extends MarkGesture {
  readonly element: InspectedBrowserElement | null;
}

function markBounds(mark: MarkGesture & { element?: InspectedBrowserElement | null }) {
  if (mark.element) return mark.element.rect;
  const xs = mark.points.map((point) => point.x);
  const ys = mark.points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

async function annotationRects(
  projectId: string,
  selectors: string[],
  tabId: string | undefined,
  sessionId: string | null | undefined,
) {
  const batches = [];
  for (let index = 0; index < selectors.length; index += 50)
    batches.push(
      getBrowserAnnotationRects(projectId, selectors.slice(index, index + 50), tabId, sessionId),
    );
  return (await Promise.all(batches)).flatMap(({ rects }) => rects);
}

function withCurrentRects(
  marks: AnnotationMark[],
  selectors: string[],
  rects: Awaited<ReturnType<typeof annotationRects>>,
) {
  const bySelector = new Map(selectors.map((selector, index) => [selector, rects[index]]));
  let changed = false;
  const next = marks.map((item) => {
    if (!item.element?.selector || !bySelector.has(item.element.selector)) return item;
    const rect = bySelector.get(item.element.selector) ?? { x: 0, y: 0, width: 0, height: 0 };
    const previous = item.element.rect;
    if (
      rect.x === previous.x &&
      rect.y === previous.y &&
      rect.width === previous.width &&
      rect.height === previous.height
    )
      return item;
    changed = true;
    return { ...item, element: { ...item.element, rect } };
  });
  return changed ? next : marks;
}

/** Page CSS px under a client point, or null outside the page (unless clamped). */
function pointOnPage(
  canvas: HTMLCanvasElement,
  viewport: BrowserStreamViewport,
  clientX: number,
  clientY: number,
  clamp: boolean,
) {
  return pagePointFromClient(
    { clientX, clientY, clamp },
    canvas.getBoundingClientRect(),
    { width: canvas.width, height: canvas.height },
    viewport,
  );
}

/**
 * The live page. Paints into the registered canvas, forwards pointer, wheel and keyboard input
 * only while the person holds control, and shows the takeover state. The docked surface reports
 * its size to the server; the floating one keeps the page size and scales the frame.
 */
export function BrowserSurface({
  mode,
  className,
  emptyState,
}: {
  mode: "dock" | "float";
  className?: string;
  emptyState?: ReactNode;
}) {
  const preview = useBrowserPreviewState();
  const { steer, state: adeState } = useAde();
  const frameState = useBrowserPreviewFrame();
  const {
    send,
    nav,
    control,
    status,
    streamStatus,
    streamError,
    changeControl,
    answerFileChooser,
    reconnect,
  } = preview;
  const { attachCanvas, releaseCanvas, viewport, hasFrame, pointer, probe } = frameState;
  const { annotationMode, setAnnotationMode, annotationOrigin, addPendingAnnotation } = preview;
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [clicks, setClicks] = useState<ClickState | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [pendingReply, setPendingReply] = useState<DialogReply | null>(null);
  const [mark, setMark] = useState<MarkGesture | null>(null);
  const markRef = useRef<MarkGesture | null>(null);
  const updateMark = (next: MarkGesture | null) => {
    markRef.current = next;
    setMark(next);
  };
  const [marks, setMarks] = useState<AnnotationMark[]>([]);
  const [hoveredElement, setHoveredElement] = useState<InspectedBrowserElement | null>(null);
  const hoverSequence = useRef(0);
  const lastHoverAt = useRef(0);
  const marksRef = useRef<AnnotationMark[]>([]);
  marksRef.current = marks;
  const [pendingPicks, setPendingPicks] = useState(0);
  const annotationGeneration = useRef(0);
  const annotationTab = useRef<string | null>(null);
  const styleSession = useRef(`annotation-${Math.random().toString(36).slice(2)}`);
  const styleDirty = useRef(false);
  const styleWork = useRef<Promise<void>>(Promise.resolve());
  const [styleChanges, setStyleChanges] = useState<BrowserAnnotationStyleChange[]>([]);
  const [styleOpen, setStyleOpen] = useState(false);
  const [styleBusy, setStyleBusy] = useState(false);
  const stylePending = useRef(0);
  const [styleError, setStyleError] = useState("");
  const [capturingAnnotation, setCapturingAnnotation] = useState(false);
  const [dismissedDownloads, setDismissedDownloads] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setDismissedDownloads(new Set()), [preview.projectId, preview.sessionId]);
  const [annotationComment, setAnnotationComment] = useState("");
  const [editorPosition, setEditorPosition] = useState<{ x: number; y: number } | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const editorWasShown = useRef(false);
  const editorDrag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const canOperate = control?.controller === "you";
  const controller = control?.controller;
  const dialog = control?.dialog ?? null;

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const keySent = useRef(false);
  const touch = useRef<TouchGesture | null>(null);
  const pendingProbe = useRef<PendingProbe | null>(null);
  const lastProbe = useRef<{ x: number; y: number; editable: boolean; at: number } | null>(null);
  const wheelQueue = useRef<{
    point: { x: number; y: number };
    deltaX: number;
    deltaY: number;
  } | null>(null);
  const wheelFrame = useRef<number | null>(null);

  const resetInput = (textarea: HTMLTextAreaElement) => {
    keySent.current = false;
    textarea.value = INPUT_SENTINEL;
    textarea.setSelectionRange(INPUT_SENTINEL.length, INPUT_SENTINEL.length);
  };

  const sendKeyPress = (
    key: typeof BACKSPACE_KEY | typeof DELETE_KEY | typeof COPY_KEY | typeof CUT_KEY,
    modifiers = 0,
  ) => {
    send({ type: "key", action: "down", ...key, modifiers });
    send({ type: "key", action: "up", ...key, modifiers });
  };

  // Touch pans are forwarded as wheel deltas, batched to one message per frame as T3 does.
  const queueWheel = (
    point: { x: number; y: number },
    deltaX: number,
    deltaY: number,
    modifiers: number,
  ) => {
    const pending = wheelQueue.current;
    wheelQueue.current = {
      point,
      deltaX: (pending?.deltaX ?? 0) + deltaX,
      deltaY: (pending?.deltaY ?? 0) + deltaY,
    };
    if (wheelFrame.current !== null) return;
    wheelFrame.current = requestAnimationFrame(() => {
      wheelFrame.current = null;
      const next = wheelQueue.current;
      wheelQueue.current = null;
      if (next)
        send(wheelMessage(next.point, { deltaX: next.deltaX, deltaY: next.deltaY }, modifiers));
    });
  };

  useEffect(
    () => () => {
      if (wheelFrame.current !== null) cancelAnimationFrame(wheelFrame.current);
      wheelFrame.current = null;
      wheelQueue.current = null;
    },
    [],
  );

  // A touch tap only raises the on-screen keyboard when the page element under it takes text.
  useEffect(() => {
    if (!probe) return;
    const pending = pendingProbe.current;
    if (!pending || pending.x !== probe.x || pending.y !== probe.y) return;
    pending.editable = probe.editable;
    pending.answered = true;
    lastProbe.current = { x: probe.x, y: probe.y, editable: probe.editable, at: performance.now() };
    if (!pending.tapped) return;
    pendingProbe.current = null;
    if (probe.editable) inputRef.current?.focus({ preventScroll: true });
    else inputRef.current?.blur();
  }, [probe]);

  // Only the person driving the page can type into it.
  useEffect(() => {
    if (canOperate) return;
    inputRef.current?.blur();
    touch.current = null;
    pendingProbe.current = null;
    keySent.current = false;
  }, [canOperate]);

  // A reply that needed control waits here until the stream confirms control and the same
  // dialog is still open. Sending is gated on control in the client.
  useEffect(() => {
    if (!pendingReply || controller !== "you" || !dialog) return;
    if (dialogKey(dialog) !== pendingReply.key) return;
    if (send(replyMessage(pendingReply))) setPendingReply(null);
  }, [pendingReply, control, controller, dialog, send]);

  const answerDialog = async (reply: DialogReply) => {
    setPendingReply(reply);
    if (controller !== "you" && !(await changeControl("take"))) setPendingReply(null);
  };

  useEffect(() => {
    if (!canvas) return;
    attachCanvas(canvas);
    return () => releaseCanvas(canvas);
  }, [canvas, attachCanvas, releaseCanvas]);

  // Keep the agent browser's fixed 1280x800 page and scale the frame to fit the docked/floating
  // surface, rather than shrinking the page's CSS viewport down to the side-pane pixel size.

  // Wheel must be non-passive so the page can scroll without the pane scrolling too.
  useEffect(() => {
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      if (annotationMode !== "off" && !canOperate) {
        event.preventDefault();
        return;
      }
      if (!canOperate || !viewport || !hasFrame) return;
      const point = pointOnPage(canvas, viewport, event.clientX, event.clientY, false);
      if (!point) return;
      event.preventDefault();
      send(wheelMessage(point, wheelDeltaPx(event, viewport.height), modifierBits(event)));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [canvas, canOperate, viewport, hasFrame, send, annotationMode]);

  // "Fill pane" mode: the page viewport follows the surface, as T3's fill viewport does.
  const fillViewport = preview.fillViewport;
  useEffect(() => {
    if (!fillViewport || !stage) return;
    let timer: number | undefined;
    let last = "";
    const apply = () => {
      // The server applies a resize for whoever drives the page; try again when control changes.
      if (!canOperate) return;
      const rect = stage.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width < VIEWPORT_LIMITS.minWidth || height < VIEWPORT_LIMITS.minHeight) return;
      const key = `${width}x${height}`;
      if (key === last) return;
      last = key;
      send({ type: "resize", width, height });
    };
    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(apply, RESIZE_DEBOUNCE_MS);
    };
    apply();
    const observer = new ResizeObserver(schedule);
    observer.observe(stage);
    return () => {
      observer.disconnect();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [fillViewport, stage, send, canOperate]);

  // Briefly show the zoom level over the page after a shortcut or menu change.
  const [zoomNotice, setZoomNotice] = useState<number | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    const onZoom = (event: Event) => {
      const factor = (event as CustomEvent<{ factor?: number }>).detail?.factor;
      if (typeof factor !== "number" || !Number.isFinite(factor)) return;
      setZoomNotice(factor);
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => setZoomNotice(null), 1500);
    };
    window.addEventListener(BROWSER_ZOOM_EVENT, onZoom);
    return () => {
      window.removeEventListener(BROWSER_ZOOM_EVENT, onZoom);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const activeTab = preview.tabs?.activeId ?? null;
    if (annotationMode === "off") annotationTab.current = activeTab;
    else if (annotationTab.current !== null && activeTab !== annotationTab.current) {
      setAnnotationMode("off");
      annotationTab.current = activeTab;
    } else annotationTab.current = activeTab;
  }, [annotationMode, preview.tabs?.activeId, setAnnotationMode]);

  const selectedSelectors = JSON.stringify(
    marks.flatMap((item) => (item.element?.selector ? [item.element.selector] : [])),
  );
  useEffect(() => {
    if (annotationMode === "off" || !preview.projectId) return;
    const selectors = JSON.parse(selectedSelectors) as string[];
    if (!selectors.length) return;
    let cancelled = false;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const rects = await annotationRects(
          preview.projectId!,
          selectors,
          annotationTab.current ?? undefined,
          annotationOrigin?.sessionId ?? preview.sessionId,
        );
        if (cancelled) return;
        setMarks((current) => withCurrentRects(current, selectors, rects));
      } catch {
        // A navigation or tab close can temporarily make a selected element unavailable.
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 300);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    annotationMode,
    annotationOrigin?.sessionId,
    preview.projectId,
    preview.sessionId,
    selectedSelectors,
  ]);

  useEffect(() => {
    if (annotationMode !== "element") {
      hoverSequence.current += 1;
      setHoveredElement(null);
    }
    if (annotationMode === "off") {
      const id = styleSession.current;
      const dirty = styleDirty.current;
      const projectId = annotationOrigin?.projectId ?? preview.projectId;
      styleDirty.current = false;
      styleSession.current = `annotation-${Math.random().toString(36).slice(2)}`;
      if (dirty && projectId)
        void styleWork.current
          .then(() =>
            restoreBrowserAnnotationStyles(
              projectId,
              id,
              undefined,
              annotationOrigin?.sessionId ?? preview.sessionId,
            ),
          )
          .catch(() => undefined);
      annotationGeneration.current += 1;
      setMarks([]);
      updateMark(null);
      setPendingPicks(0);
      setStyleChanges([]);
      setStyleOpen(false);
      setStyleError("");
      setStyleBusy(false);
      setAnnotationComment("");
      setEditorPosition(null);
      editorWasShown.current = false;
      return;
    }
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setAnnotationMode("off");
        return;
      }
      if (
        event.target instanceof HTMLElement &&
        /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
      )
        return;
      const tools: Record<string, "element" | "region" | "draw" | "erase"> = {
        v: "element",
        r: "region",
        d: "draw",
        e: "erase",
      };
      const tool = tools[event.key.toLowerCase()];
      if (tool && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setAnnotationMode(tool);
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [
    annotationMode,
    setAnnotationMode,
    preview.projectId,
    preview.sessionId,
    annotationOrigin?.projectId,
    annotationOrigin?.sessionId,
  ]);

  useEffect(() => {
    if (annotationMode !== "off" && marks.length && !editorWasShown.current) {
      editorWasShown.current = true;
      commentRef.current?.focus({ preventScroll: true });
    }
  }, [annotationMode, marks.length]);

  useEffect(
    () => () => {
      const id = styleSession.current;
      const projectId = annotationOrigin?.projectId ?? preview.projectId;
      if (styleDirty.current && projectId)
        void styleWork.current
          .then(() =>
            restoreBrowserAnnotationStyles(
              projectId,
              id,
              undefined,
              annotationOrigin?.sessionId ?? preview.sessionId,
            ),
          )
          .catch(() => undefined);
    },
    [
      preview.projectId,
      preview.sessionId,
      annotationOrigin?.projectId,
      annotationOrigin?.sessionId,
    ],
  );

  const countClick = (button: BrowserButton, x: number, y: number, time: number) => {
    const last = clicks;
    const count =
      last &&
      last.button === button &&
      time - last.time < MULTI_CLICK_MS &&
      Math.hypot(x - last.x, y - last.y) < MULTI_CLICK_SLOP_PX
        ? last.count + 1
        : 1;
    setClicks({ button, time, x, y, count });
    return count;
  };

  const pointFor = (event: PointerEvent<HTMLCanvasElement>, clamp: boolean) => {
    if (!canvas || !viewport || !hasFrame) return null;
    return pointOnPage(canvas, viewport, event.clientX, event.clientY, clamp);
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button === 3 || event.button === 4) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (annotationMode !== "off" && viewport && hasFrame && canvas) {
      if (event.button !== 0) return;
      const point = pointFor(event, false);
      if (!point) return;
      event.preventDefault();
      setStyleError("");
      hoverSequence.current += 1;
      setHoveredElement(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      updateMark({ mode: annotationMode, points: [point], additive: event.shiftKey });
      return;
    }
    if (!canOperate) return;
    if (event.pointerType === "touch") {
      if (!event.isPrimary) return;
      const point = pointFor(event, false);
      event.preventDefault();
      touch.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        panning: false,
      };
      const last = lastProbe.current;
      const reusable =
        point &&
        last &&
        performance.now() - last.at < PROBE_REUSE_MS &&
        Math.hypot(point.x - last.x, point.y - last.y) < PROBE_REUSE_PX;
      pendingProbe.current = point
        ? {
            x: point.x,
            y: point.y,
            editable: reusable ? (last?.editable ?? null) : null,
            answered: false,
            tapped: false,
          }
        : null;
      if (point) send({ type: "probe", x: point.x, y: point.y });
      return;
    }
    const point = pointFor(event, false);
    if (!point) return;
    if (viewport)
      preview.capture.recordPointer({
        x: point.x,
        y: point.y,
        width: viewport.width,
        height: viewport.height,
        source: "human",
        phase: "down",
        tabId: preview.tabs?.activeId ?? null,
      });
    inputRef.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const button = buttonFromDomButton(event.button);
    send({
      type: "mouse",
      action: "down",
      x: point.x,
      y: point.y,
      button,
      buttons: event.buttons & 7,
      clickCount: countClick(button, point.x, point.y, event.timeStamp),
      modifiers: modifierBits(event),
    });
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (markRef.current) {
      const point = pointFor(event, true);
      if (!point) return;
      const current = markRef.current;
      if (current.mode !== "draw") updateMark({ ...current, points: [current.points[0]!, point] });
      else if (
        Math.hypot(current.points.at(-1)!.x - point.x, current.points.at(-1)!.y - point.y) >= 2
      )
        updateMark({ ...current, points: [...current.points, point] });
      return;
    }
    if (annotationMode !== "off") {
      if (
        annotationMode === "element" &&
        preview.projectId &&
        event.timeStamp - lastHoverAt.current > 120
      ) {
        const point = pointFor(event, false);
        if (point) {
          lastHoverAt.current = event.timeStamp;
          const sequence = ++hoverSequence.current;
          void inspectBrowserElement(
            preview.projectId,
            point.x,
            point.y,
            annotationTab.current ?? undefined,
            false,
            preview.sessionId,
          )
            .then(({ element }) => {
              if (sequence === hoverSequence.current) setHoveredElement(element);
            })
            .catch(() => undefined);
        }
      }
      return;
    }
    if (!canOperate) return;
    if (event.pointerType === "touch") {
      const gesture = touch.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      if (
        !gesture.panning &&
        Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < TAP_SLOP_PX
      )
        return;
      gesture.panning = true;
      const point = pointFor(event, true);
      if (point) {
        queueWheel(
          point,
          (gesture.lastX - event.clientX) * point.scale,
          (gesture.lastY - event.clientY) * point.scale,
          0,
        );
        if (viewport)
          preview.capture.recordPointer({
            x: point.x,
            y: point.y,
            width: viewport.width,
            height: viewport.height,
            source: "human",
            tabId: preview.tabs?.activeId ?? null,
          });
      }
      gesture.lastX = event.clientX;
      gesture.lastY = event.clientY;
      event.preventDefault();
      return;
    }
    const point = pointFor(event, event.buttons !== 0);
    if (!point) return;
    if (viewport)
      preview.capture.recordPointer({
        x: point.x,
        y: point.y,
        width: viewport.width,
        height: viewport.height,
        source: "human",
        tabId: preview.tabs?.activeId ?? null,
      });
    send({
      type: "mouse",
      action: "move",
      x: point.x,
      y: point.y,
      button: pressedButton(event.buttons),
      buttons: event.buttons & 7,
      clickCount: 0,
      modifiers: modifierBits(event),
    });
  };

  const restoreSelection = (selector?: string) => {
    if (!styleDirty.current || !preview.projectId) return;
    const projectId = preview.projectId;
    const id = styleSession.current;
    setStyleChanges((current) =>
      selector ? current.filter((change) => change.selector !== selector) : [],
    );
    styleWork.current = styleWork.current
      .then(() =>
        restoreBrowserAnnotationStyles(
          projectId,
          id,
          selector,
          annotationOrigin?.sessionId ?? preview.sessionId,
        ),
      )
      .then(() => undefined)
      .catch((error: unknown) =>
        setStyleError(error instanceof Error ? error.message : "Could not restore the page style."),
      );
  };

  // Also used for pointercancel, so a lost pointer still releases its button.
  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button === 3 || event.button === 4) {
      event.preventDefault();
      if (event.type === "pointerup" && canOperate && annotationMode === "off")
        send({ type: "history", delta: event.button === 3 ? -1 : 1 });
      return;
    }
    const currentMark = markRef.current;
    if (currentMark && canvas && viewport) {
      const point = pointFor(event, true);
      const finished = point
        ? currentMark.mode === "draw"
          ? { ...currentMark, points: [...currentMark.points, point] }
          : { ...currentMark, points: [currentMark.points[0]!, point] }
        : currentMark;
      updateMark(null);
      if (finished.mode === "erase") {
        const p = finished.points[0]!;
        let index = -1;
        for (let i = marksRef.current.length - 1; i >= 0; i--) {
          const item = marksRef.current[i]!;
          const bounds = markBounds(item);
          if (
            p.x >= bounds.x - 12 &&
            p.x <= bounds.x + bounds.width + 12 &&
            p.y >= bounds.y - 12 &&
            p.y <= bounds.y + bounds.height + 12
          ) {
            index = i;
            break;
          }
        }
        if (index >= 0) {
          const selector = marksRef.current[index]?.element?.selector;
          if (selector) restoreSelection(selector);
          setMarks((current) => current.filter((_, i) => i !== index));
        }
      } else if (finished.mode === "element" && preview.projectId) {
        const generation = annotationGeneration.current;
        setPendingPicks((count) => count + 1);
        void inspectBrowserElement(
          preview.projectId,
          finished.points[0]!.x,
          finished.points[0]!.y,
          annotationTab.current ?? undefined,
          true,
          preview.sessionId,
        )
          .then(({ element }) => {
            if (generation !== annotationGeneration.current) return;
            if (!element) return;
            const existing =
              element &&
              marksRef.current.find(
                (item) =>
                  item.element?.selector === element.selector &&
                  item.element?.pageUrl === element.pageUrl,
              );
            if (existing?.element?.selector) restoreSelection(existing.element.selector);
            else if (!existing && !finished.additive) restoreSelection();
            setMarks((current) => {
              const existing =
                element &&
                current.findIndex(
                  (item) =>
                    item.element?.selector === element.selector &&
                    item.element?.pageUrl === element.pageUrl,
                );
              if (typeof existing === "number" && existing >= 0)
                return current.filter((_, index) => index !== existing);
              return [
                ...(finished.additive
                  ? current
                  : current.filter((item) => item.mode !== "element")),
                { ...finished, element },
              ];
            });
          })
          .catch(() => {
            if (generation === annotationGeneration.current)
              setStyleError("Could not inspect the selected element.");
          })
          .finally(() => {
            if (generation === annotationGeneration.current)
              setPendingPicks((count) => Math.max(0, count - 1));
          });
      } else if (finished.mode === "region" && preview.projectId) {
        const rect = markBounds(finished);
        if (rect.width < 3 || rect.height < 3) return;
        const generation = annotationGeneration.current;
        setPendingPicks((count) => count + 1);
        void inspectBrowserRegion(
          preview.projectId,
          rect,
          annotationTab.current ?? undefined,
          preview.sessionId,
        )
          .then(({ elements }) => {
            if (generation !== annotationGeneration.current) return;
            setMarks((current) => {
              if (!elements.length) return [...current, { ...finished, element: null }];
              const selected = new Set(
                current.map((item) => item.element?.selector).filter(Boolean),
              );
              const additions: AnnotationMark[] = elements
                .filter((item) => !selected.has(item.selector))
                .map((element) => ({
                  mode: "element",
                  points: [
                    {
                      x: element.rect.x + element.rect.width / 2,
                      y: element.rect.y + element.rect.height / 2,
                    },
                  ],
                  element,
                }));
              return [...current, ...additions];
            });
          })
          .catch(() => {
            if (generation === annotationGeneration.current)
              setMarks((current) => [...current, { ...finished, element: null }]);
          })
          .finally(() => {
            if (generation === annotationGeneration.current)
              setPendingPicks((count) => Math.max(0, count - 1));
          });
      } else if (
        finished.mode !== "draw" ||
        finished.points.some(
          (point) =>
            Math.hypot(point.x - finished.points[0]!.x, point.y - finished.points[0]!.y) >= 2,
        )
      ) {
        setMarks((current) => [...current, { ...finished, element: null }]);
      }
      return;
    }
    if (annotationMode !== "off") return;
    if (!canOperate) return;
    if (event.pointerType === "touch") {
      const gesture = touch.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      touch.current = null;
      const probeResult = pendingProbe.current;
      if (gesture.panning) {
        pendingProbe.current = null;
        return;
      }
      const point = pointFor(event, false);
      if (!point) return;
      // Focus during the tap: iOS only opens its keyboard from a tap, not a later reply.
      if (probeResult?.editable === true) inputRef.current?.focus({ preventScroll: true });
      else if (probeResult?.editable === false) inputRef.current?.blur();
      if (probeResult && !probeResult.answered) probeResult.tapped = true;
      else pendingProbe.current = null;
      const clickCount = countClick("left", point.x, point.y, event.timeStamp);
      if (viewport)
        preview.capture.recordPointer({
          x: point.x,
          y: point.y,
          width: viewport.width,
          height: viewport.height,
          source: "human",
          phase: "click",
          tabId: preview.tabs?.activeId ?? null,
        });
      send({
        type: "mouse",
        action: "move",
        x: point.x,
        y: point.y,
        button: "none",
        buttons: 0,
        clickCount: 0,
        modifiers: 0,
      });
      send({
        type: "mouse",
        action: "down",
        x: point.x,
        y: point.y,
        button: "left",
        buttons: 1,
        clickCount,
        modifiers: 0,
      });
      send({
        type: "mouse",
        action: "up",
        x: point.x,
        y: point.y,
        button: "left",
        buttons: 0,
        clickCount,
        modifiers: 0,
      });
      return;
    }
    const point = pointFor(event, true);
    if (!point) return;
    const button = buttonFromDomButton(event.button);
    send({
      type: "mouse",
      action: "up",
      x: point.x,
      y: point.y,
      button,
      buttons: event.buttons & 7,
      clickCount: clicks?.button === button ? clicks.count : 1,
      modifiers: modifierBits(event),
    });
  };

  const applyStyle = (styleProperty: string, styleValue: string) => {
    if (!preview.projectId || !styleValue.trim()) return;
    const selectors = marks.flatMap((item) =>
      item.element?.selector ? [item.element.selector] : [],
    );
    if (!selectors.length) {
      setStyleError("Select an element first.");
      return;
    }
    const projectId = preview.projectId;
    const sessionId = styleSession.current;
    const generation = annotationGeneration.current;
    styleDirty.current = true;
    stylePending.current += 1;
    setStyleBusy(true);
    setStyleError("");
    const work = styleWork.current.then(async () => {
      for (const selector of selectors) {
        const { result } = await applyBrowserAnnotationStyle(
          projectId,
          sessionId,
          selector,
          styleProperty,
          styleValue.trim(),
          annotationTab.current ?? undefined,
          annotationOrigin?.sessionId ?? preview.sessionId,
        );
        if (
          generation !== annotationGeneration.current ||
          !marksRef.current.some((mark) => mark.element?.selector === selector)
        )
          continue;
        setStyleChanges((current) => [
          ...current.filter(
            (item) => item.selector !== selector || item.property !== styleProperty,
          ),
          result,
        ]);
        setMarks((current) =>
          current.map((item) =>
            item.element?.selector === selector
              ? { ...item, element: { ...item.element, rect: result.rect } }
              : item,
          ),
        );
      }
    });
    styleWork.current = work.catch(() => undefined);
    void work
      .catch((error: unknown) => {
        if (generation === annotationGeneration.current)
          setStyleError(error instanceof Error ? error.message : "Could not preview the style.");
      })
      .finally(() => {
        stylePending.current = Math.max(0, stylePending.current - 1);
        if (generation === annotationGeneration.current && stylePending.current === 0)
          setStyleBusy(false);
      });
  };

  const finishAnnotation = async (submission: "attach" | "send") => {
    if (!canvas || !viewport || !marks.length || pendingPicks || !annotationOrigin) return;
    if (styleBusy || capturingAnnotation) return;
    const generation = annotationGeneration.current;
    setCapturingAnnotation(true);
    let captureMarks = marks;
    const selectors = JSON.parse(selectedSelectors) as string[];
    if (selectors.length && preview.projectId) {
      try {
        const rects = await annotationRects(
          preview.projectId,
          selectors,
          annotationTab.current ?? undefined,
          annotationOrigin.sessionId,
        );
        if (generation !== annotationGeneration.current) {
          setCapturingAnnotation(false);
          return;
        }
        captureMarks = withCurrentRects(marks, selectors, rects);
      } catch {
        setStyleError("Could not update selected element positions.");
        setCapturingAnnotation(false);
        return;
      }
    }
    const output = document.createElement("canvas");
    const context = output.getContext("2d");
    if (!context) {
      setCapturingAnnotation(false);
      return;
    }
    if (preview.projectId) {
      try {
        const response = await fetch(
          withBrowserSession(
            `/api/projects/${encodeURIComponent(preview.projectId)}/browser/capture`,
            annotationOrigin.sessionId,
          ),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(annotationTab.current ? { tabId: annotationTab.current } : {}),
          },
        );
        if (!response.ok) throw new Error("Could not capture the page.");
        const bitmap = await createImageBitmap(await response.blob());
        output.width = bitmap.width;
        output.height = bitmap.height;
        context.drawImage(bitmap, 0, 0, output.width, output.height);
        bitmap.close();
      } catch (error) {
        setStyleError(error instanceof Error ? error.message : "Could not capture the page.");
        setCapturingAnnotation(false);
        return;
      }
    } else {
      setCapturingAnnotation(false);
      return;
    }
    if (generation !== annotationGeneration.current) {
      setCapturingAnnotation(false);
      return;
    }
    const sx = output.width / viewport.width;
    const sy = output.height / viewport.height;
    context.strokeStyle = "#ff3b30";
    context.fillStyle = "rgba(255,59,48,.18)";
    context.lineWidth = Math.max(3, Math.min(output.width, output.height) / 250);
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const item of captureMarks) {
      if (item.mode === "draw") {
        context.beginPath();
        item.points.forEach((p, index) =>
          index ? context.lineTo(p.x * sx, p.y * sy) : context.moveTo(p.x * sx, p.y * sy),
        );
        context.stroke();
      } else if (item.mode === "element" && !item.element) {
        context.beginPath();
        context.arc(item.points[0]!.x * sx, item.points[0]!.y * sy, 18 * sx, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      } else {
        const box = markBounds(item);
        context.fillRect(box.x * sx, box.y * sy, box.width * sx, box.height * sy);
        context.strokeRect(box.x * sx, box.y * sy, box.width * sx, box.height * sy);
      }
    }
    const elements = captureMarks.flatMap((item) => (item.element ? [item.element] : []));
    const targets = captureMarks
      .map(
        (item, index) =>
          `Target ${index + 1}: ${item.mode}, bounds ${JSON.stringify(markBounds(item))}`,
      )
      .join("\n");
    const blob = await encodeCaptureImage(output, CAPTURE_IMAGE_LIMIT);
    if (!blob) {
      setStyleError("Could not create the annotation image.");
      setCapturingAnnotation(false);
      return;
    }
    const boxes = captureMarks.map(markBounds);
    const left = Math.max(0, Math.floor((Math.min(...boxes.map((box) => box.x)) - 20) * sx));
    const top = Math.max(0, Math.floor((Math.min(...boxes.map((box) => box.y)) - 20) * sy));
    const right = Math.min(
      output.width,
      Math.ceil((Math.max(...boxes.map((box) => box.x + box.width)) + 20) * sx),
    );
    const bottom = Math.min(
      output.height,
      Math.ceil((Math.max(...boxes.map((box) => box.y + box.height)) + 20) * sy),
    );
    let detail: File | null = null;
    if (
      right > left &&
      bottom > top &&
      (right - left) * (bottom - top) < output.width * output.height * 0.9
    ) {
      const crop = document.createElement("canvas");
      crop.width = right - left;
      crop.height = bottom - top;
      const cropContext = crop.getContext("2d");
      if (!cropContext) {
        setStyleError("Could not create the annotation detail image.");
        setCapturingAnnotation(false);
        return;
      }
      cropContext.drawImage(
        output,
        left,
        top,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height,
      );
      const cropped = await encodeCaptureImage(crop, CAPTURE_IMAGE_LIMIT);
      if (!cropped) {
        setStyleError("Could not create an annotation detail image small enough to attach.");
        setCapturingAnnotation(false);
        return;
      }
      detail = captureImageFile(cropped, "browser-annotation-detail");
    }
    if (styleDirty.current && preview.projectId) {
      try {
        await styleWork.current;
        await restoreBrowserAnnotationStyles(
          preview.projectId,
          styleSession.current,
          undefined,
          annotationOrigin.sessionId,
        );
        styleDirty.current = false;
      } catch (error) {
        setStyleError(
          error instanceof Error ? error.message : "Could not restore the page styles.",
        );
        setCapturingAnnotation(false);
        return;
      }
    }
    if (generation !== annotationGeneration.current) {
      setCapturingAnnotation(false);
      return;
    }
    const annotation = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      origin: annotationOrigin,
      file: captureImageFile(blob, "browser-annotation"),
      detail,
      elements,
      targets,
      styleChanges,
      comment: annotationComment,
    };
    const files = [annotation.file, ...(annotation.detail ? [annotation.detail] : [])];
    const text = formatAnnotationFeedback(annotation, annotationComment);
    if (submission === "attach") {
      await addBrowserFeedback(
        feedbackScope(annotation.origin.projectId, annotation.origin.sessionId),
        {
          text: `Browser annotation${annotation.origin.pageUrl ? `\nPage: ${annotation.origin.pageUrl}` : ""}\n\n${text}`,
          files,
        },
      );
    } else {
      try {
        const attachments = await Promise.all(files.map(uploadAttachment));
        const session = adeState.sessions.find((item) => item.id === annotation.origin.sessionId);
        await steer(
          annotation.origin.sessionId,
          `Browser annotation${annotation.origin.pageUrl ? `\nPage: ${annotation.origin.pageUrl}` : ""}\n\n${text}`,
          attachments.map((attachment) => attachment.id),
          session?.status === "working" || session?.status === "verifying" ? "later" : undefined,
        );
      } catch {
        // Keep the captured image and comment available for retry in the conversation.
        addPendingAnnotation(annotation);
      }
    }
    setCapturingAnnotation(false);
    if (generation === annotationGeneration.current) setAnnotationMode("off");
  };

  const handleKey = (action: "down" | "up", event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (annotationMode !== "off") return;
    if (!canOperate) return;
    keySent.current = false;
    if (
      event.nativeEvent.isComposing ||
      event.keyCode === 229 ||
      event.key === "Process" ||
      event.key === "Unidentified"
    )
      return;
    if (event.key === "Escape" && event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      if (action === "down") event.currentTarget.blur();
      return;
    }
    const shortcut = event.ctrlKey || event.metaKey;
    const message = keyMessage(action, event.nativeEvent);
    if (message) send(message);
    // Soft keyboards edit the hidden input even while keydown is prevented; don't send twice.
    keySent.current =
      action === "down" &&
      !shortcut &&
      (event.key === "Backspace" ||
        event.key === "Delete" ||
        event.key === "Enter" ||
        [...event.key].length === 1);
    // The page performed the copy or cut, so stop this document from repeating it.
    if (
      event.ctrlKey !== event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      ["c", "x"].includes(event.key.toLowerCase())
    )
      event.preventDefault();
    if (shortcut) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const handleClipboard = (
    key: typeof COPY_KEY | typeof CUT_KEY,
    event: ClipboardEvent<HTMLTextAreaElement>,
  ) => {
    // Keep the hidden input's sentinel off the clipboard.
    event.preventDefault();
    if (!canOperate) return;
    sendKeyPress(key, CTRL_MODIFIER);
  };

  const handleInput = (event: FormEvent<HTMLTextAreaElement>) => {
    const native = event.nativeEvent;
    if (native instanceof InputEvent && native.isComposing) return;
    const textarea = event.currentTarget;
    const inputType = native instanceof InputEvent ? native.inputType : "";
    if (keySent.current) keySent.current = false;
    else if (inputType === "deleteContentBackward") sendKeyPress(BACKSPACE_KEY);
    else if (inputType === "deleteContentForward") sendKeyPress(DELETE_KEY);
    else {
      const text = textarea.value.replace(/^\u200b/, "");
      if (text) send({ type: "text", text });
    }
    resetInput(textarea);
  };

  const handleCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    const text = event.data.replace(/^\u200b/, "");
    if (text) send({ type: "text", text });
    resetInput(event.currentTarget);
  };

  // Until the agent opens a page, Chrome paints a white about:blank: the brightest thing on a dark
  // screen, saying nothing. Any real address shows the stream itself.
  const blankPage =
    hasFrame && !nav?.error && !nav?.fileNotShown && (!nav?.url || nav.url === "about:blank");

  const takeOver = () => void changeControl("take");
  const handBack = () => void changeControl("release");

  const placeholder = !status
    ? "Checking the browser…"
    : !status.available
      ? (status.reason ?? "The browser is not available on this computer.")
      : streamStatus === "reconnecting"
        ? "Reconnecting preview…"
        : "Connecting to the browser…";

  return (
    <div
      ref={setStage}
      className={`group relative min-h-0 overflow-hidden bg-paper ${className ?? ""}`}
      data-browser-surface={mode}
    >
      <canvas
        ref={setCanvas}
        aria-label="Browser page"
        className="absolute inset-0 size-full touch-none object-contain outline-none focus-visible:outline-2 focus-visible:outline-amber"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onMouseDown={(event) => event.preventDefault()}
        onPointerLeave={() => {
          if (!markRef.current) {
            hoverSequence.current += 1;
            setHoveredElement(null);
          }
        }}
        onContextMenu={(event) => event.preventDefault()}
        onAuxClick={(event) => {
          if (event.button === 3 || event.button === 4) event.preventDefault();
        }}
      />
      {/* The page's real keyboard: typed text, IME composition and paste go to the page, and
          soft keyboards only open when a touch tap lands on an editable element. */}
      <textarea
        ref={inputRef}
        aria-label="Browser page keyboard input"
        aria-description="Press Shift+Escape to leave the browser page."
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={!canOperate}
        defaultValue={INPUT_SENTINEL}
        onFocus={(event) => resetInput(event.currentTarget)}
        className="sr-only"
        onKeyDown={(event) => handleKey("down", event)}
        onKeyUp={(event) => handleKey("up", event)}
        onInput={handleInput}
        onCompositionEnd={handleCompositionEnd}
        onCopy={(event) => handleClipboard(COPY_KEY, event)}
        onCut={(event) => handleClipboard(CUT_KEY, event)}
        onPaste={(event) => {
          event.preventDefault();
          const text = event.clipboardData.getData("text/plain");
          if (text) send({ type: "text", text });
        }}
      />

      {zoomNotice !== null ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute top-3 left-1/2 z-[16] -translate-x-1/2 rounded-full bg-ink/80 px-3 py-1 font-mono text-xs tabular-nums text-paper shadow-lg"
        >
          {Math.round(zoomNotice * 100)}%
        </div>
      ) : null}

      {preview.projectId && annotationMode === "off" ? (
        <div
          className="absolute right-2 bottom-2 z-[15] grid max-w-[min(24rem,calc(100%-1rem))] gap-1"
          aria-live="polite"
        >
          {preview.downloads
            .filter(
              (item) =>
                item.tabId === preview.tabs?.activeId &&
                item.id !== nav?.fileNotShown?.downloadId &&
                !dismissedDownloads.has(item.id),
            )
            .slice(-3)
            .map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-lg border border-line bg-panel p-2 text-xs shadow-lg"
              >
                <span className="min-w-0 flex-1 truncate" title={item.fileName}>
                  Downloaded {item.fileName}
                </span>
                <a
                  href={withBrowserSession(
                    `/api/projects/${encodeURIComponent(preview.projectId!)}/browser/downloads/${encodeURIComponent(item.id)}`,
                    preview.sessionId,
                  )}
                  download={item.fileName}
                  className="btn-quiet shrink-0 px-2 py-1"
                >
                  Save
                </a>
                <button
                  type="button"
                  aria-label={`Dismiss ${item.fileName}`}
                  className="shrink-0 text-dim"
                  onClick={() => setDismissedDownloads((current) => new Set([...current, item.id]))}
                >
                  ×
                </button>
              </div>
            ))}
        </div>
      ) : null}

      {mode === "dock" &&
      preview.deviceToolbar &&
      !fillViewport &&
      stage &&
      viewport &&
      hasFrame &&
      preview.projectId &&
      annotationMode === "off" ? (
        <BrowserViewportHandles
          stage={stage}
          viewport={viewport}
          projectId={preview.projectId}
          sessionId={preview.sessionId}
          tabId={preview.tabs?.activeId ?? null}
          aspectRatio={preview.deviceAspectRatio}
        />
      ) : null}

      {annotationMode !== "off" && viewport ? (
        <svg
          className="pointer-events-none absolute inset-0 z-[2] size-full"
          viewBox={`0 0 ${viewport.width} ${viewport.height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden
        >
          {hoveredElement && annotationMode === "element" ? (
            <rect
              x={hoveredElement.rect.x}
              y={hoveredElement.rect.y}
              width={hoveredElement.rect.width}
              height={hoveredElement.rect.height}
              fill="rgba(255,59,48,.08)"
              stroke="#ff3b30"
              strokeDasharray="5 4"
              strokeWidth="2"
            />
          ) : null}
          {marks.map((item, index) => {
            if (item.mode === "draw")
              return (
                <polyline
                  key={index}
                  points={item.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke="#ff3b30"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            if (item.mode === "element" && !item.element)
              return (
                <circle
                  key={index}
                  cx={item.points[0]?.x}
                  cy={item.points[0]?.y}
                  r="18"
                  fill="rgba(255,59,48,.18)"
                  stroke="#ff3b30"
                  strokeWidth="3"
                />
              );
            const box = markBounds(item);
            return (
              <rect
                key={index}
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                fill="rgba(255,59,48,.18)"
                stroke="#ff3b30"
                strokeWidth="3"
              />
            );
          })}
          {mark?.mode === "element" ? (
            <circle
              cx={mark.points[0]?.x}
              cy={mark.points[0]?.y}
              r="18"
              fill="rgba(255,59,48,.18)"
              stroke="#ff3b30"
              strokeWidth="3"
            />
          ) : null}
          {mark?.mode === "region" && mark.points.length > 1 ? (
            <rect
              x={Math.min(mark.points[0]!.x, mark.points[1]!.x)}
              y={Math.min(mark.points[0]!.y, mark.points[1]!.y)}
              width={Math.abs(mark.points[1]!.x - mark.points[0]!.x)}
              height={Math.abs(mark.points[1]!.y - mark.points[0]!.y)}
              fill="rgba(255,59,48,.18)"
              stroke="#ff3b30"
              strokeWidth="3"
            />
          ) : null}
          {mark?.mode === "draw" ? (
            <polyline
              points={mark.points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="#ff3b30"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </svg>
      ) : null}

      {annotationMode !== "off" ? (
        <div
          role="toolbar"
          aria-label="Annotation tools"
          className="absolute top-2 left-2 right-2 z-[10] flex items-center gap-1 overflow-x-auto rounded-lg border border-line bg-panel p-1 text-xs shadow-lg"
        >
          {(
            [
              ["element", "Select", "V"],
              ["region", "Region", "R"],
              ["draw", "Draw", "D"],
              ["erase", "Erase", "E"],
            ] as const
          ).map(([tool, label, shortcut]) => (
            <button
              key={tool}
              type="button"
              aria-pressed={annotationMode === tool}
              title={`${label} (${shortcut})`}
              onClick={() => setAnnotationMode(tool)}
              className={`shrink-0 rounded px-2 py-1.5 ${annotationMode === tool ? "bg-amber text-ink" : "hover:bg-surface-muted"}`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            disabled={!marks.some((item) => item.element?.selector)}
            aria-pressed={styleOpen}
            onClick={() => setStyleOpen((open) => !open)}
            className="shrink-0 rounded px-2 py-1.5 disabled:opacity-40"
          >
            Style
          </button>
          <span className="min-w-0 flex-1" />
          <button
            type="button"
            disabled={!marks.length}
            onClick={() => {
              restoreSelection();
              setMarks([]);
            }}
            className="shrink-0 rounded px-2 py-1.5 disabled:opacity-40"
          >
            Clear
          </button>
          <button
            type="button"
            disabled={capturingAnnotation}
            onClick={() => setAnnotationMode("off")}
            className="shrink-0 rounded px-2 py-1.5"
          >
            Cancel
          </button>
        </div>
      ) : null}
      {annotationMode !== "off" && marks.length ? (
        <div
          ref={editorRef}
          role="group"
          aria-label="Annotation feedback"
          className="absolute z-[12] grid w-[min(25rem,calc(100%-1rem))] gap-2 rounded-lg border border-line bg-panel p-2 text-xs shadow-xl"
          style={
            editorPosition
              ? { left: editorPosition.x, top: editorPosition.y }
              : { left: 8, bottom: 8 }
          }
        >
          <div
            role="button"
            tabIndex={0}
            aria-label="Drag annotation editor"
            title="Drag annotation editor"
            className="cursor-move touch-none select-none text-dim"
            onPointerDown={(event) => {
              if (event.button !== 0 || !editorRef.current) return;
              const bounds = editorRef.current.getBoundingClientRect();
              editorDrag.current = {
                pointerId: event.pointerId,
                x: event.clientX - bounds.left,
                y: event.clientY - bounds.top,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!stage || !editorRef.current || editorDrag.current?.pointerId !== event.pointerId)
                return;
              const bounds = stage.getBoundingClientRect();
              setEditorPosition({
                x: Math.max(
                  0,
                  Math.min(
                    bounds.width - editorRef.current.offsetWidth,
                    event.clientX - bounds.left - editorDrag.current.x,
                  ),
                ),
                y: Math.max(
                  0,
                  Math.min(
                    bounds.height - editorRef.current.offsetHeight,
                    event.clientY - bounds.top - editorDrag.current.y,
                  ),
                ),
              });
            }}
            onPointerUp={() => {
              editorDrag.current = null;
            }}
            onPointerCancel={() => {
              editorDrag.current = null;
            }}
          >
            Annotation · {marks.length} {marks.length === 1 ? "target" : "targets"} · drag to move
          </div>
          <textarea
            ref={commentRef}
            aria-label="Annotation feedback"
            value={annotationComment}
            onChange={(event) => setAnnotationComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void finishAnnotation(event.metaKey || event.ctrlKey ? "send" : "attach");
            }}
            placeholder="What should the agent change here?"
            className="min-h-12 max-h-28 w-full resize-y rounded border border-line bg-paper p-2 outline-none focus-visible:ring-2 focus-visible:ring-amber"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={pendingPicks > 0 || styleBusy || capturingAnnotation}
              onClick={() => void finishAnnotation("attach")}
              title="Attach annotation (Enter)"
              className="btn-quiet px-2 py-1.5 disabled:opacity-40"
            >
              Attach
            </button>
            <button
              type="button"
              disabled={pendingPicks > 0 || styleBusy || capturingAnnotation}
              onClick={() => void finishAnnotation("send")}
              title="Send annotation (Ctrl/⌘+Enter)"
              className="btn-amber px-2 py-1.5 disabled:opacity-40"
            >
              {capturingAnnotation ? "Preparing…" : "Send"}
            </button>
          </div>
        </div>
      ) : null}
      {annotationMode !== "off" && styleError && !styleOpen ? (
        <p
          role="alert"
          className="absolute top-14 left-2 z-[11] rounded border border-line bg-panel p-2 text-xs text-danger shadow-lg"
        >
          {styleError}
        </p>
      ) : null}
      {annotationMode !== "off" && styleOpen ? (
        <div
          data-annotation-style
          className="absolute top-14 bottom-2 left-2 z-[11] grid h-fit max-h-[calc(100%-4rem)] w-[min(18rem,calc(100%-1rem))] gap-2 overflow-y-auto rounded-lg border border-line bg-panel p-2 text-xs shadow-lg"
        >
          {marks.find((item) => item.element)?.element ? (
            <BrowserAnnotationStyles
              key={selectedSelectors}
              element={marks.find((item) => item.element)!.element!}
              apply={applyStyle}
            />
          ) : null}
          {styleError ? (
            <p role="alert" className="text-danger">
              {styleError}
            </p>
          ) : null}
        </div>
      ) : null}

      {canvas && pointer && viewport && controller ? (
        <AgentCursor
          pointer={pointer}
          canvas={canvas}
          viewport={viewport}
          controller={controller === "agent" ? "agent" : "human"}
        />
      ) : null}

      {blankPage ? (
        <div className="pointer-events-none absolute inset-0 z-[1] grid place-items-center bg-paper px-4 text-center">
          {emptyState ?? (
            <div className="grid justify-items-center gap-2">
              <Globe className="size-5 text-dim" strokeWidth={1.5} aria-hidden />
              <p className="m-0 text-[13px] text-[var(--text-secondary)]">No preview yet</p>
            </div>
          )}
        </div>
      ) : null}

      {nav?.error && !nav.loading ? (
        <BrowserUnreachable
          key={`${preview.tabs?.activeId ?? ""}:${nav.error.url}`}
          error={nav.error}
          onReload={() => {
            void (async () => {
              if (control?.controller !== "you" && !(await changeControl("take"))) return;
              send({ type: "reload" });
            })();
          }}
        />
      ) : null}

      {nav?.fileNotShown && !nav.loading && preview.projectId ? (
        <BrowserFileNotShown
          file={nav.fileNotShown}
          projectId={preview.projectId}
          sessionId={preview.sessionId}
        />
      ) : null}

      {!hasFrame ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-4 text-center text-xs text-dim">
          <div className="pointer-events-auto grid justify-items-center gap-3">
            <p role="status" className="m-0">
              {streamError && streamStatus === "closed" ? streamError : placeholder}
            </p>
            {streamStatus === "closed" && status?.available ? (
              <button
                type="button"
                onClick={reconnect}
                className="btn-quiet px-3 py-1.5 text-xs text-ink"
              >
                Try again
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {controller === "you" ? (
        <>
          <div className="pointer-events-none absolute inset-0 z-[5] border-2 border-amber" />
          <div className="absolute top-2.5 left-1/2 z-[6] flex max-w-[calc(100%-1.25rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-amber py-0.5 pr-0.5 pl-2.5 text-xs font-medium whitespace-nowrap text-ink shadow-lg motion-reduce:transition-none">
            <span className="truncate">You're driving · agent paused</span>
            <button
              type="button"
              onClick={handBack}
              className="h-6 shrink-0 rounded-full bg-ink px-3 text-xs font-medium text-paper"
            >
              Hand back
            </button>
          </div>
        </>
      ) : null}

      {controller === "agent" ? (
        <div className="pointer-events-none absolute bottom-2.5 left-2.5 z-[5] flex items-center gap-2 rounded-full bg-panel py-0.5 pr-0.5 pl-3 text-xs whitespace-nowrap text-ink opacity-0 ring-1 ring-line ring-inset shadow-lg transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 motion-reduce:transition-none">
          <span className="size-1.5 rounded-full bg-teal" aria-hidden />
          <span>Agent is browsing</span>
          <button
            type="button"
            onClick={takeOver}
            className="h-6 shrink-0 rounded-full bg-paper px-3 font-medium text-ink ring-1 ring-line ring-inset"
          >
            Take over
          </button>
        </div>
      ) : null}

      {controller === "another-viewer" ? (
        <div className="pointer-events-none absolute bottom-2.5 left-2.5 z-[5] rounded-full bg-panel px-3 py-0.5 text-xs whitespace-nowrap text-dim ring-1 ring-line ring-inset">
          Controlled in another window
        </div>
      ) : null}

      {streamError && streamStatus !== "closed" && streamError !== dismissedError ? (
        <div
          role="alert"
          className="absolute bottom-2.5 left-1/2 z-[6] flex max-w-[calc(100%-1.25rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-panel py-0.5 pr-0.5 pl-3 text-xs text-danger shadow-lg ring-1 ring-danger/40 ring-inset"
        >
          <span className="min-w-0 truncate">{streamError}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            title="Dismiss"
            onClick={() => setDismissedError(streamError)}
            className="grid size-6 shrink-0 place-items-center rounded-full text-dim transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
          >
            <X className="size-3.5" strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      ) : null}

      {dialog ? (
        <PageDialog
          key={dialogKey(dialog)}
          dialog={dialog}
          onAnswer={(reply) => void answerDialog({ ...reply, key: dialogKey(dialog) })}
        />
      ) : control?.fileChooser ? (
        <FileChooserPrompt
          key={control.fileChooser.id}
          chooser={control.fileChooser}
          onAnswer={(files) => void answerFileChooser(control.fileChooser!.id, files)}
        />
      ) : null}
    </div>
  );
}
