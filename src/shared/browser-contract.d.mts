export const DEFAULT_VIEWPORT: Readonly<{ width: number; height: number }>;
export const VIEWPORT_LIMITS: Readonly<{
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
}>;
export const STREAM_PATH: string;
export const INPUT_BUTTONS: readonly ["none", "left", "middle", "right"];
export const MODIFIER_BITS: Readonly<{ alt: 1; ctrl: 2; meta: 4; shift: 8 }>;
export const MAX_MODIFIER_MASK: number;
export const STREAM_QUERY_PARAMS: Readonly<{
  maxWidth: "maxWidth";
  maxHeight: "maxHeight";
  quality: "quality";
  recordingFrameRate: "recordingFrameRate";
  recordingKeys: "recordingKeys";
}>;
export const RECORDING_STORAGE_KEYS: Readonly<{
  frameRate: "ade.browser.recordingFrameRate";
  showMousePresses: "ade.browser.recordingShowMousePresses";
  showKeyPresses: "ade.browser.recordingShowKeyPresses";
}>;
export const MAX_INPUT_TEXT_CHARS: number;
export const BROWSER_RENDER_SCALE: number;
export const WEBSOCKET_CLOSE_REASON_MAX_BYTES: number;
export const STREAM_CLOSE_CODES: Readonly<{
  policyViolation: 1008;
  reconnect: 1012;
  slowViewer: 1013;
  internal: 1011;
  badRequest: 4400;
  unauthorized: 4401;
  hostUnavailable: 4503;
}>;
export const SERVER_STREAM_MESSAGE_TYPES: readonly [
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
];
export const CLIENT_STREAM_MESSAGE_TYPES: readonly [
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
];
export const STREAM_MESSAGE_TYPES: Readonly<{
  server: typeof SERVER_STREAM_MESSAGE_TYPES;
  client: typeof CLIENT_STREAM_MESSAGE_TYPES;
}>;
export function viewportAcceptable(viewport: {
  width: number;
  height: number;
}): boolean;
export function clampViewport(viewport: {
  width: number;
  height: number;
}): { width: number; height: number };
