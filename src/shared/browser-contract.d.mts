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
