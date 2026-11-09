export const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 800 });
export const VIEWPORT_LIMITS = Object.freeze({
  minWidth: 240,
  maxWidth: 3840,
  minHeight: 240,
  maxHeight: 2160,
});
export const STREAM_PATH = "/preview-stream";
export const INPUT_BUTTONS = Object.freeze(["none", "left", "middle", "right"]);
export const MODIFIER_BITS = Object.freeze({ alt: 1, ctrl: 2, meta: 4, shift: 8 });
export const MAX_MODIFIER_MASK = 15;
/** Query param names shared by the browser stream client and server. */
export const STREAM_QUERY_PARAMS = Object.freeze({
  maxWidth: "maxWidth",
  maxHeight: "maxHeight",
  quality: "quality",
  recordingFrameRate: "recordingFrameRate",
  recordingKeys: "recordingKeys",
});
/** localStorage keys for recording prefs shared by chrome controls and capture. */
export const RECORDING_STORAGE_KEYS = Object.freeze({
  frameRate: "ade.browser.recordingFrameRate",
  showMousePresses: "ade.browser.recordingShowMousePresses",
  showKeyPresses: "ade.browser.recordingShowKeyPresses",
});
export const MAX_INPUT_TEXT_CHARS = 10_000;
export const BROWSER_RENDER_SCALE = 2;
export const WEBSOCKET_CLOSE_REASON_MAX_BYTES = 123;
export const STREAM_CLOSE_CODES = Object.freeze({
  policyViolation: 1008,
  reconnect: 1012,
  slowViewer: 1013,
  internal: 1011,
  badRequest: 4400,
  unauthorized: 4401,
  hostUnavailable: 4503,
});

/** Server → client JSON text-frame `type` values used by the browser stream. */
export const SERVER_STREAM_MESSAGE_TYPES = Object.freeze([
  "viewport",
  "downloads",
  "tabs",
  "control",
  "pointer",
  "recording-key",
  "probe",
  "nav",
  "clipboard",
  "error",
]);

/** Client → server JSON text-frame `type` values used by the browser stream. */
export const CLIENT_STREAM_MESSAGE_TYPES = Object.freeze([
  "ack",
  "mouse",
  "wheel",
  "key",
  "text",
  "probe",
  "resize",
  "navigate",
  "history",
  "reload",
  "stop-loading",
  "tab-audio",
  "tab",
  "dialog",
]);

export const STREAM_MESSAGE_TYPES = Object.freeze({
  server: SERVER_STREAM_MESSAGE_TYPES,
  client: CLIENT_STREAM_MESSAGE_TYPES,
});

/** True when width/height are finite, within VIEWPORT_LIMITS, and area ≤ maxWidth×maxHeight. */
export function viewportAcceptable({ width, height }) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  const { minWidth, maxWidth, minHeight, maxHeight } = VIEWPORT_LIMITS;
  return (
    width >= minWidth &&
    width <= maxWidth &&
    height >= minHeight &&
    height <= maxHeight &&
    width * height <= maxWidth * maxHeight
  );
}

/** Clamps a CSS viewport to the limits accepted by the browser stream. */
export function clampViewport({ width, height }) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new TypeError("Viewport width and height must be numbers.");
  }
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));
  return {
    width: clamp(width, VIEWPORT_LIMITS.minWidth, VIEWPORT_LIMITS.maxWidth),
    height: clamp(height, VIEWPORT_LIMITS.minHeight, VIEWPORT_LIMITS.maxHeight),
  };
}
