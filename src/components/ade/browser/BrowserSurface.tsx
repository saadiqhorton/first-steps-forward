// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/web/src/browser/ServerBrowserSurface.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.

import { useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";
import { X } from "lucide-react";
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
import { useBrowserPreview } from "./browserPreviewContext";

const RESIZE_DEBOUNCE_MS = 150;
const MULTI_CLICK_MS = 500;
const MULTI_CLICK_SLOP_PX = 4;

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
}: {
  mode: "dock" | "float";
  className?: string;
}) {
  const preview = useBrowserPreview();
  const {
    attachCanvas,
    releaseCanvas,
    send,
    viewport,
    hasFrame,
    control,
    pointer,
    status,
    streamStatus,
    streamError,
    requestViewportSize,
    changeControl,
    reconnect,
  } = preview;
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [clicks, setClicks] = useState<ClickState | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [pendingReply, setPendingReply] = useState<DialogReply | null>(null);
  const canOperate = control?.controller === "you";
  const controller = control?.controller;
  const dialog = control?.dialog ?? null;

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

  // Keep the agent computer's native desktop browser viewport (1280x800 window)
  // and scale the frame to fit the docked/floating surface, rather than shrinking
  // the remote page's CSS viewport down to the side-pane pixel size.

  // Wheel must be non-passive so the page can scroll without the pane scrolling too.
  useEffect(() => {
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      if (!canOperate || !viewport || !hasFrame) return;
      const point = pointOnPage(canvas, viewport, event.clientX, event.clientY, false);
      if (!point) return;
      event.preventDefault();
      send(wheelMessage(point, wheelDeltaPx(event, viewport.height), modifierBits(event)));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [canvas, canOperate, viewport, hasFrame, send]);

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
    if (!canOperate) return;
    const point = pointFor(event, false);
    if (!point) return;
    event.currentTarget.focus({ preventScroll: true });
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
    if (!canOperate) return;
    const point = pointFor(event, event.buttons !== 0);
    if (!point) return;
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

  // Also used for pointercancel, so a lost pointer still releases its button.
  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!canOperate) return;
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

  const handleKey = (action: "down" | "up", event: KeyboardEvent<HTMLCanvasElement>) => {
    if (!canOperate) return;
    if (action === "down" && event.key === "Escape" && event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    const message = keyMessage(action, event.nativeEvent);
    if (!message) return;
    send(message);
    event.preventDefault();
  };

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
        tabIndex={0}
        aria-label="Browser page"
        className="absolute inset-0 size-full touch-none object-contain outline-none focus-visible:outline-2 focus-visible:outline-amber"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={(event) => handleKey("down", event)}
        onKeyUp={(event) => handleKey("up", event)}
        onContextMenu={(event) => event.preventDefault()}
      />

      {canvas && pointer && viewport && controller ? (
        <AgentCursor
          pointer={pointer}
          canvas={canvas}
          viewport={viewport}
          controller={controller === "agent" ? "agent" : "human"}
        />
      ) : null}

      {!hasFrame ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-4 text-center text-[12px] text-dim">
          <div className="pointer-events-auto grid justify-items-center gap-3">
            <p role="status" className="m-0">
              {streamError && streamStatus === "closed" ? streamError : placeholder}
            </p>
            {streamStatus === "closed" && status?.available ? (
              <button
                type="button"
                onClick={reconnect}
                className="btn-quiet px-3 py-1.5 text-[12px] text-ink"
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
          <div className="absolute top-2.5 left-1/2 z-[6] flex max-w-[calc(100%-1.25rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-amber py-0.5 pr-0.5 pl-2.5 text-[12px] font-medium whitespace-nowrap text-ink shadow-lg motion-reduce:transition-none">
            <span className="truncate">You're driving · agent paused</span>
            <button
              type="button"
              onClick={handBack}
              className="h-6 shrink-0 rounded-full bg-ink px-2.5 text-[12px] font-semibold text-paper"
            >
              Hand back
            </button>
          </div>
        </>
      ) : null}

      {controller === "agent" ? (
        <div className="pointer-events-none absolute bottom-2.5 left-2.5 z-[5] flex items-center gap-2 rounded-full bg-panel py-0.5 pr-0.5 pl-2.5 text-[12px] whitespace-nowrap text-ink opacity-0 ring-1 ring-line ring-inset shadow-lg transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 motion-reduce:transition-none">
          <span className="size-2 rounded-full bg-teal" aria-hidden />
          <span>Agent is browsing</span>
          <button
            type="button"
            onClick={takeOver}
            className="h-6 shrink-0 rounded-full bg-paper px-2.5 font-semibold text-ink ring-1 ring-line ring-inset"
          >
            Take over
          </button>
        </div>
      ) : null}

      {controller === "another-viewer" ? (
        <div className="pointer-events-none absolute bottom-2.5 left-2.5 z-[5] rounded-full bg-panel px-2.5 py-0.5 text-[12px] whitespace-nowrap text-dim ring-1 ring-line ring-inset">
          Controlled in another window
        </div>
      ) : null}

      {streamError && streamStatus !== "closed" && streamError !== dismissedError ? (
        <div
          role="alert"
          className="absolute bottom-2.5 left-1/2 z-[6] flex max-w-[calc(100%-1.25rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-panel py-0.5 pr-0.5 pl-3 text-[11px] text-danger shadow-lg ring-1 ring-danger/40 ring-inset"
        >
          <span className="min-w-0 truncate">{streamError}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            title="Dismiss"
            onClick={() => setDismissedError(streamError)}
            className="grid size-6 shrink-0 place-items-center rounded-full text-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
          >
            <X className="size-3" aria-hidden />
          </button>
        </div>
      ) : null}

      {dialog ? (
        <PageDialog
          key={dialogKey(dialog)}
          dialog={dialog}
          onAnswer={(reply) => void answerDialog({ ...reply, key: dialogKey(dialog) })}
        />
      ) : null}
    </div>
  );
}

/**
 * A page dialog (alert, confirm, prompt or beforeunload) that the page is waiting on. The page is
 * frozen until someone answers, so this is shown whoever holds control.
 */
function PageDialog({
  dialog,
  onAnswer,
}: {
  dialog: BrowserDialog;
  onAnswer: (reply: { accept: boolean; promptText?: string }) => void;
}) {
  const [text, setText] = useState(dialog.defaultValue);
  const isPrompt = dialog.type === "prompt";
  const isAlert = dialog.type === "alert";
  return (
    <div
      role="dialog"
      aria-label="Page dialog"
      className="absolute top-1/2 left-1/2 z-[7] grid w-[min(20rem,calc(100%-1.5rem))] -translate-x-1/2 -translate-y-1/2 gap-2.5 rounded-xl bg-panel p-3 text-[12px] text-ink shadow-lg ring-1 ring-line ring-inset"
    >
      <p className="m-0 break-words">{dialog.message || "The page is asking for a response."}</p>
      {isPrompt ? (
        <input
          aria-label="Dialog response"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="h-7 w-full min-w-0 rounded-md bg-paper px-2 ring-1 ring-line ring-inset outline-none focus-visible:outline-2 focus-visible:outline-amber"
        />
      ) : null}
      <div className="flex justify-end gap-2">
        {isAlert ? null : (
          <button
            type="button"
            onClick={() => onAnswer({ accept: false })}
            className="btn-quiet px-3 py-1.5 text-[12px]"
          >
            Dismiss
          </button>
        )}
        <button
          type="button"
          onClick={() => onAnswer({ accept: true, ...(isPrompt ? { promptText: text } : {}) })}
          className="btn-amber px-3 py-1.5 text-[12px]"
        >
          {isAlert ? "OK" : "Accept"}
        </button>
      </div>
    </div>
  );
}
