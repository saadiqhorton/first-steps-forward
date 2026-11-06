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
