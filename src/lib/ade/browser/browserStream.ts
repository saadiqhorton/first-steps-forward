// Adapted from T3 Code (https://github.com/pingdotgg/t3code): packages/client-runtime/src/preview/serverBrowserStream.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
//
// WebSocket client for the agent computer's browser stream. Binary frames are JPEG bytes that
// are acked immediately; JSON frames carry viewport, control, pointer, nav and error messages.

export type BrowserButton = "none" | "left" | "middle" | "right";

export type BrowserStreamController = "agent" | "you" | "another-viewer";

export interface BrowserDialog {
  readonly type: string;
  readonly message: string;
  readonly defaultValue: string;
}

export type BrowserStreamStatus = "connecting" | "open" | "reconnecting" | "closed";

/** Messages the server sends as JSON text frames. */
export type ServerMessage =
  | { readonly type: "viewport"; readonly width: number; readonly height: number }
  | {
      readonly type: "control";
      readonly canOperate: true;
      readonly controller: BrowserStreamController;
      readonly generation: number;
      readonly dialog: BrowserDialog | null;
    }
  | {
      readonly type: "pointer";
      readonly phase: "move" | "click";
      readonly x: number;
      readonly y: number;
      readonly sequence: number;
    }
  | {
      readonly type: "nav";
      readonly url: string;
      readonly title: string;
      readonly loading: boolean;
      readonly canGoBack: boolean;
      readonly canGoForward: boolean;
    }
  | { readonly type: "error"; readonly message: string };

/** Messages the client sends. Coordinates are page CSS px; modifiers are a 0..15 bitmask. */
export type ClientMessage =
  | { readonly type: "ack" }
  | { readonly type: "takeControl" }
  | { readonly type: "releaseControl" }
  | { readonly type: "resize"; readonly width: number; readonly height: number }
  | {
      readonly type: "mouse";
      readonly action: "move" | "down" | "up";
      readonly x: number;
      readonly y: number;
      readonly button: BrowserButton;
      /** Pressed buttons: left 1, right 2, middle 4. */
      readonly buttons: number;
      readonly clickCount: number;
      readonly modifiers: number;
    }
  | {
      readonly type: "wheel";
      readonly x: number;
      readonly y: number;
      readonly deltaX: number;
      readonly deltaY: number;
      readonly modifiers: number;
    }
  | {
      readonly type: "key";
      readonly action: "down" | "up";
      readonly key: string;
      readonly code: string;
      readonly keyCode?: number;
      readonly text?: string;
      readonly modifiers: number;
    }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "navigate"; readonly url: string }
  | { readonly type: "history"; readonly delta: -1 | 1 }
  | { readonly type: "reload"; readonly ignoreCache?: boolean }
  | { readonly type: "dialog"; readonly accept: boolean; readonly promptText?: string };

export interface BrowserStreamViewport {
  readonly width: number;
  readonly height: number;
}

export interface BrowserStreamControl {
  readonly canOperate: true;
  readonly controller: BrowserStreamController;
  readonly generation: number;
  readonly dialog: BrowserDialog | null;
}

export interface BrowserStreamPointer {
  readonly phase: "move" | "click";
  readonly x: number;
  readonly y: number;
  readonly sequence: number;
}

export interface BrowserStreamNav {
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

export interface BrowserStreamOptions {
  /** Server-issued `ws://` URL that already carries `project` and `token`. */
  readonly url: string;
  /** Stable per-page-load id, see viewer.ts. */
  readonly viewer: string;
  readonly maxWidth: number;
  readonly maxHeight: number;
  /** The callback owns the bitmap and must call `close()` once it no longer needs it. */
  readonly onFrame: (bitmap: ImageBitmap) => void;
  readonly onViewport: (viewport: BrowserStreamViewport) => void;
  readonly onControl: (control: BrowserStreamControl) => void;
  readonly onPointer: (pointer: BrowserStreamPointer) => void;
  readonly onNav: (nav: BrowserStreamNav) => void;
  readonly onError: (message: string) => void;
  readonly onStatus: (status: BrowserStreamStatus) => void;
}

export interface BrowserStream {
  /** Returns false when the message was not sent (socket closed, or the send gate refused it). */
  readonly send: (message: ClientMessage) => boolean;
  readonly close: () => void;
}

const ACK_MESSAGE = JSON.stringify({ type: "ack" });
const MAX_RECONNECT_DELAY_MS = 10_000;
/** Close codes for refused upgrades: policy violation, bad token, host setup missing. */
const POLICY_VIOLATION = 1008;
const REFUSED_TOKEN = 4401;
const HOST_UNAVAILABLE = 4503;

const isNumber = (value: unknown): value is number => typeof value === "number";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isString = (value: unknown): value is string => typeof value === "string";

const isController = (value: unknown): value is BrowserStreamController =>
  value === "agent" || value === "you" || value === "another-viewer";

function isDialog(value: unknown): value is BrowserDialog | null {
  if (value === null) return true;
  if (typeof value !== "object" || value === null) return false;
  const dialog = value as Record<string, unknown>;
  return (
    isString(dialog["type"]) && isString(dialog["message"]) && isString(dialog["defaultValue"])
  );
}

/** Validate a JSON text frame. Unknown or malformed frames are dropped. */
export function parseServerMessage(text: string): ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;
  const { type } = message;
  if (type === "viewport") {
    const { width, height } = message;
    return isNumber(width) && isNumber(height) ? { type, width, height } : null;
  }
  if (type === "control") {
    const { canOperate, controller, generation, dialog } = message;
    return canOperate === true &&
      isController(controller) &&
      isNumber(generation) &&
      isDialog(dialog)
      ? { type, canOperate: true, controller, generation, dialog }
      : null;
  }
  if (type === "pointer") {
    const { phase, x, y, sequence } = message;
    return (phase === "move" || phase === "click") &&
      isNumber(x) &&
      isNumber(y) &&
      isNumber(sequence)
      ? { type, phase, x, y, sequence }
      : null;
  }
  if (type === "nav") {
    const { url, title, loading, canGoBack, canGoForward } = message;
    return isString(url) &&
      isString(title) &&
      isBoolean(loading) &&
      isBoolean(canGoBack) &&
      isBoolean(canGoForward)
      ? { type, url, title, loading, canGoBack, canGoForward }
      : null;
  }
  if (type === "error") {
    const { message: text } = message;
    return isString(text) ? { type, message: text } : null;
  }
  return null;
}

/** Messages the send gate lets through without the viewer holding control. */
const ALWAYS_SENDABLE = new Set<ClientMessage["type"]>(["takeControl", "releaseControl", "resize"]);

/** Human-readable reason for an upgrade the server refused, from its close code and reason. */
function refusalMessage(code: number, reason: string): string | null {
  if (code === REFUSED_TOKEN || code === POLICY_VIOLATION) {
    return "The browser stream refused this connection. Reopen the preview.";
  }
  if (code === HOST_UNAVAILABLE) {
    try {
      const parsed = JSON.parse(reason) as { message?: unknown };
      if (isString(parsed.message)) return parsed.message;
    } catch {
      // Fall through to the generic message.
    }
    return "The browser is not available on this computer.";
  }
  return null;
}

/**
 * Open the browser stream. Reconnects with backoff `min(500 * 2^n, 10000)` ms after a drop.
 * The backoff counter resets on any frame or viewport message.
 */
export function connectBrowserStream(options: BrowserStreamOptions): BrowserStream {
  const target = new URL(options.url);
  target.searchParams.set("viewer", options.viewer);
  target.searchParams.set("maxWidth", String(Math.max(1, Math.round(options.maxWidth))));
  target.searchParams.set("maxHeight", String(Math.max(1, Math.round(options.maxHeight))));

  let stopped = false;
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let control: BrowserStreamControl | null = null;
  // One decode at a time. A frame that arrives mid-decode replaces the waiting one.
  let decoding = false;
  let waiting: ArrayBuffer | null = null;

  const decode = (jpeg: ArrayBuffer) => {
    decoding = true;
    void createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }))
      .then((bitmap) => {
        if (stopped) bitmap.close();
        else options.onFrame(bitmap);
      })
      .catch(() => undefined)
      .finally(() => {
        decoding = false;
        const next = waiting;
        waiting = null;
        if (next && !stopped) decode(next);
      });
  };

  const paint = (jpeg: ArrayBuffer) => {
    if (stopped) return;
    if (decoding) waiting = jpeg;
    else decode(jpeg);
  };

  const dispatch = (message: ServerMessage) => {
    switch (message.type) {
      case "viewport":
        failures = 0;
        options.onViewport({ width: message.width, height: message.height });
        return;
      case "control":
        control = {
          canOperate: true,
          controller: message.controller,
          generation: message.generation,
          dialog: message.dialog,
        };
        options.onControl(control);
        return;
      case "pointer":
        options.onPointer({
          phase: message.phase,
          x: message.x,
          y: message.y,
          sequence: message.sequence,
        });
        return;
      case "nav":
        options.onNav({
          url: message.url,
          title: message.title,
          loading: message.loading,
          canGoBack: message.canGoBack,
          canGoForward: message.canGoForward,
        });
        return;
      case "error":
        options.onError(message.message);
        return;
    }
  };

  const connect = () => {
    if (stopped) return;
    const ws = new WebSocket(target.toString());
    ws.binaryType = "arraybuffer";
    socket = ws;
    ws.addEventListener("open", () => {
      if (socket !== ws) return;
      options.onStatus("open");
    });
    ws.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (socket !== ws) return;
      if (event.data instanceof ArrayBuffer) {
        failures = 0;
        // Ack every frame, including the ones the decoder later drops.
        ws.send(ACK_MESSAGE);
        paint(event.data);
        return;
      }
      if (typeof event.data !== "string") return;
      const message = parseServerMessage(event.data);
      if (message) dispatch(message);
    });
    ws.addEventListener("close", (event) => {
      if (socket !== ws) return;
      socket = null;
      control = null;
      if (stopped) return;
      const refusal = refusalMessage(event.code, event.reason);
      if (refusal !== null) {
        // A refused connection would be refused again with the same token: stop instead of retrying.
        stopped = true;
        options.onStatus("closed");
        options.onError(refusal);
        return;
      }
      options.onStatus("reconnecting");
      retryTimer = setTimeout(connect, Math.min(500 * 2 ** failures++, MAX_RECONNECT_DELAY_MS));
    });
    ws.addEventListener("error", () => ws.close());
  };

  options.onStatus("connecting");
  connect();

  return {
    send: (message) => {
      const ws = socket;
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      if (!ALWAYS_SENDABLE.has(message.type) && control?.controller !== "you") return false;
      ws.send(JSON.stringify(message));
      return true;
    },
    close: () => {
      if (stopped) return;
      stopped = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      const ws = socket;
      socket = null;
      control = null;
      waiting = null;
      ws?.close();
      options.onStatus("closed");
    },
  };
}
