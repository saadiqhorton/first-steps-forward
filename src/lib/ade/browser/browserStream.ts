// Adapted from T3 Code (https://github.com/pingdotgg/t3code): packages/client-runtime/src/preview/serverBrowserStream.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
//
// WebSocket client for the agent browser's stream. Binary frames are JPEG bytes that are acked
// immediately; JSON frames carry viewport, control, pointer, nav, clipboard and error messages.

import { STREAM_CLOSE_CODES } from "@/shared/browser-contract.mjs";

export type BrowserButton = "none" | "left" | "middle" | "right";

export type BrowserStreamController = "agent" | "you" | "another-viewer";

export interface BrowserDialog {
  readonly type: string;
  readonly message: string;
  readonly defaultValue: string;
}

/** A file picker the page opened. The viewer in control answers it (see answerFileChooser). */
export interface BrowserFileChooser {
  readonly id: string;
  readonly multiple: boolean;
  /** The file input's `accept` attribute, for the local picker. */
  readonly accept: string;
}

export interface BrowserDownload {
  readonly id: string;
  readonly tabId: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly completedAt: number;
}

export type BrowserStreamStatus = "connecting" | "open" | "reconnecting" | "closed";

/** Messages the server sends as JSON text frames. */
export type ServerMessage =
  | { readonly type: "viewport"; readonly width: number; readonly height: number }
  | { readonly type: "downloads"; readonly downloads: readonly BrowserDownload[] }
  | {
      readonly type: "tabs";
      readonly activeId: string | null;
      readonly tabs: readonly BrowserTab[];
    }
  | {
      readonly type: "control";
      readonly canOperate: true;
      readonly controller: BrowserStreamController;
      readonly generation: number;
      readonly dialog: BrowserDialog | null;
      readonly fileChooser?: BrowserFileChooser | null;
    }
  | {
      readonly type: "pointer";
      readonly phase: "move" | "click";
      readonly tabId?: string | null | undefined;
      readonly x: number;
      readonly y: number;
      readonly sequence: number;
    }
  | { readonly type: "recording-key"; readonly label: string | null }
  /** Whether the page element under a touch point accepts text, so mobile keyboards only open there. */
  | { readonly type: "probe"; readonly x: number; readonly y: number; readonly editable: boolean }
  | {
      readonly type: "nav";
      readonly url: string;
      readonly title: string;
      readonly loading: boolean;
      readonly canGoBack: boolean;
      readonly canGoForward: boolean;
      readonly error: BrowserNavigationError | null;
      readonly fileNotShown: BrowserFileNotShown | null;
      /** This tab is showing the first page opened in it. */
      readonly opened: boolean;
    }
  /** Text the page copied when this viewer pressed copy or cut. */
  | { readonly type: "clipboard"; readonly text: string }
  | { readonly type: "error"; readonly message: string };

/** Messages the client sends. Coordinates are page CSS px; modifiers are a 0..15 bitmask. */
export type ClientMessage =
  | { readonly type: "ack" }
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
  | { readonly type: "probe"; readonly x: number; readonly y: number }
  | { readonly type: "resize"; readonly width: number; readonly height: number }
  | { readonly type: "navigate"; readonly url: string }
  | { readonly type: "history"; readonly delta: -1 | 1 }
  | { readonly type: "reload"; readonly ignoreCache?: boolean }
  | { readonly type: "stop-loading" }
  | { readonly type: "tab-audio"; readonly id: string; readonly muted: boolean }
  | { readonly type: "tab"; readonly action: "new"; readonly profileId?: string }
  | { readonly type: "tab"; readonly action: "select" | "close"; readonly id: string }
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
  readonly fileChooser: BrowserFileChooser | null;
}

export interface BrowserStreamPointer {
  readonly phase: "move" | "click";
  readonly tabId?: string | null | undefined;
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
  readonly error: BrowserNavigationError | null;
  readonly fileNotShown: BrowserFileNotShown | null;
  /** The first page opened in this tab; the preview surfaces itself when it is not on screen. */
  readonly opened: boolean;
}

export interface BrowserFileNotShown {
  readonly url: string;
  readonly fileName: string;
  readonly downloadId: string | null;
  readonly status: "saving" | "ready" | "failed";
}

export interface BrowserNavigationError {
  readonly url: string;
  readonly description: string;
}

export interface BrowserTab {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly profileId?: string;
  readonly favicon?: string;
  readonly audio?: { readonly muted: boolean; readonly audible: boolean };
}
export interface BrowserTabs {
  readonly activeId: string | null;
  readonly tabs: readonly BrowserTab[];
}

export interface BrowserStreamOptions {
  /** Server-issued `/preview-stream` path that already carries `project` and `token`. */
  readonly url: string;
  /** Stable per-page-load id, see viewer.ts. */
  readonly viewer: string;
  readonly maxWidth: number;
  readonly maxHeight: number;
  /** Keep this viewer on a specific tab, used for background recording. */
  readonly tabId?: string;
  readonly recordingFrameRate?: 30 | 60;
  readonly showRecordingKeys?: boolean;
  /** The callback owns the bitmap and must call `close()` once it no longer needs it. */
  readonly onFrame: (bitmap: ImageBitmap) => void;
  readonly onViewport: (viewport: BrowserStreamViewport) => void;
  readonly onControl: (control: BrowserStreamControl) => void;
  readonly onPointer: (pointer: BrowserStreamPointer) => void;
  readonly onRecordingKey?: (label: string | null) => void;
  readonly onProbe?: (probe: { x: number; y: number; editable: boolean }) => void;
  readonly onNav: (nav: BrowserStreamNav) => void;
  readonly onTabs: (tabs: BrowserTabs) => void;
  readonly onDownloads?: (downloads: readonly BrowserDownload[]) => void;
  readonly onClipboard: (text: string) => void;
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
const POLICY_VIOLATION = STREAM_CLOSE_CODES.policyViolation;
const REFUSED_TOKEN = STREAM_CLOSE_CODES.unauthorized;
const HOST_UNAVAILABLE = STREAM_CLOSE_CODES.hostUnavailable;

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

// Absent means no picker, so a server that predates file pickers still parses.
function isFileChooser(value: unknown): value is BrowserFileChooser | null | undefined {
  if (value === null || value === undefined) return true;
  if (typeof value !== "object") return false;
  const chooser = value as Record<string, unknown>;
  return isString(chooser["id"]) && isBoolean(chooser["multiple"]) && isString(chooser["accept"]);
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
  if (type === "tabs") {
    const { activeId, tabs } = message;
    if (!(activeId === null || isString(activeId)) || !Array.isArray(tabs)) return null;
    if (
      !tabs.every(
        (tab: unknown) =>
          typeof tab === "object" &&
          tab !== null &&
          isString((tab as Record<string, unknown>)["id"]) &&
          isString((tab as Record<string, unknown>)["url"]) &&
          isString((tab as Record<string, unknown>)["title"]) &&
          ((tab as Record<string, unknown>)["profileId"] === undefined ||
            isString((tab as Record<string, unknown>)["profileId"])) &&
          ((tab as Record<string, unknown>)["audio"] === undefined ||
            (typeof (tab as Record<string, unknown>)["audio"] === "object" &&
              (tab as Record<string, unknown>)["audio"] !== null &&
              isBoolean(
                ((tab as Record<string, unknown>)["audio"] as Record<string, unknown>)["muted"],
              ) &&
              isBoolean(
                ((tab as Record<string, unknown>)["audio"] as Record<string, unknown>)["audible"],
              ))) &&
          ((tab as Record<string, unknown>)["favicon"] === undefined ||
            (isString((tab as Record<string, unknown>)["favicon"]) &&
              /^data:image\/png;base64,[a-z0-9+/]+=*$/i.test(
                (tab as Record<string, string>)["favicon"]!,
              ) &&
              (tab as Record<string, string>)["favicon"]!.length <= 134_000)),
      )
    )
      return null;
    return { type, activeId, tabs: tabs as BrowserTab[] };
  }
  if (type === "viewport") {
    const { width, height } = message;
    return isNumber(width) && isNumber(height) ? { type, width, height } : null;
  }
  if (type === "downloads") {
    const { downloads } = message;
    if (
      !Array.isArray(downloads) ||
      !downloads.every((item: unknown) => {
        if (!item || typeof item !== "object") return false;
        const value = item as Record<string, unknown>;
        return (
          isString(value["id"]) &&
          isString(value["tabId"]) &&
          isString(value["fileName"]) &&
          isNumber(value["sizeBytes"]) &&
          isNumber(value["completedAt"])
        );
      })
    )
      return null;
    return { type, downloads: downloads as BrowserDownload[] };
  }
  if (type === "control") {
    const { canOperate, controller, generation, dialog, fileChooser } = message;
    return canOperate === true &&
      isController(controller) &&
      isNumber(generation) &&
      isDialog(dialog) &&
      isFileChooser(fileChooser)
      ? { type, canOperate: true, controller, generation, dialog, fileChooser: fileChooser ?? null }
      : null;
  }
  if (type === "pointer") {
    const { phase, x, y, sequence, tabId } = message;
    return (phase === "move" || phase === "click") &&
      (tabId === undefined || tabId === null || isString(tabId)) &&
      isNumber(x) &&
      isNumber(y) &&
      isNumber(sequence)
      ? { type, phase, x, y, sequence, tabId }
      : null;
  }
  if (type === "nav") {
    const { url, title, loading, canGoBack, canGoForward, error, fileNotShown, opened } = message;
    const validError =
      error == null ||
      (typeof error === "object" &&
        isString((error as Record<string, unknown>)["url"]) &&
        isString((error as Record<string, unknown>)["description"]));
    const validFile = fileNotShown == null ||
      (typeof fileNotShown === "object" && isString((fileNotShown as Record<string, unknown>)["url"]) &&
        isString((fileNotShown as Record<string, unknown>)["fileName"]) &&
        ((fileNotShown as Record<string, unknown>)["downloadId"] === null || isString((fileNotShown as Record<string, unknown>)["downloadId"])) &&
        ["saving", "ready", "failed"].includes(String((fileNotShown as Record<string, unknown>)["status"])));
    return isString(url) &&
      isString(title) &&
      isBoolean(loading) &&
      isBoolean(canGoBack) &&
      isBoolean(canGoForward) &&
      isBoolean(opened) &&
      validError && validFile
      ? {
          type,
          url,
          title,
          loading,
          canGoBack,
          canGoForward,
          error: (error as BrowserNavigationError | null | undefined) ?? null,
          fileNotShown: (fileNotShown as BrowserFileNotShown | null | undefined) ?? null,
          opened,
        }
      : null;
  }
  if (type === "recording-key") {
    const { label } = message;
    return label === null || (isString(label) && label.length <= 100) ? { type, label } : null;
  }
  if (type === "probe") {
    const { x, y, editable } = message;
    return isNumber(x) && isNumber(y) && isBoolean(editable) ? { type, x, y, editable } : null;
  }
  if (type === "clipboard") {
    const { text } = message;
    return isString(text) ? { type, text } : null;
  }
  if (type === "error") {
    const { message: text } = message;
    return isString(text) ? { type, message: text } : null;
  }
  return null;
}

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
  // The server issues a path on the origin that served the page; ws: or wss: follows that origin.
  const target = new URL(options.url, window.location.href);
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
  target.searchParams.set("viewer", options.viewer);
  if (options.tabId) target.searchParams.set("tab", options.tabId);
  if (options.recordingFrameRate)
    target.searchParams.set("recordingFrameRate", String(options.recordingFrameRate));
  if (options.showRecordingKeys) target.searchParams.set("recordingKeys", "1");
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
      case "tabs":
        options.onTabs({ activeId: message.activeId, tabs: message.tabs });
        return;
      case "downloads":
        options.onDownloads?.(message.downloads);
        return;
      case "control":
        control = {
          canOperate: true,
          controller: message.controller,
          generation: message.generation,
          dialog: message.dialog,
          fileChooser: message.fileChooser ?? null,
        };
        options.onControl(control);
        return;
      case "pointer":
        options.onPointer({
          phase: message.phase,
          tabId: message.tabId,
          x: message.x,
          y: message.y,
          sequence: message.sequence,
        });
        return;
      case "recording-key":
        options.onRecordingKey?.(message.label);
        return;
      case "probe":
        options.onProbe?.({ x: message.x, y: message.y, editable: message.editable });
        return;
      case "nav":
        options.onNav({
          url: message.url,
          title: message.title,
          loading: message.loading,
          canGoBack: message.canGoBack,
          canGoForward: message.canGoForward,
          error: message.error,
          fileNotShown: message.fileNotShown,
          opened: message.opened,
        });
        return;
      case "clipboard":
        options.onClipboard(message.text);
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
      if (control?.controller !== "you") return false;
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
