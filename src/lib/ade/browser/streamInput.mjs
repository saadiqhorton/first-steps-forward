// Adapted from T3 Code (https://github.com/pingdotgg/t3code): packages/client-runtime/src/preview/serverBrowserStream.ts
// (modifier and key input builders) and apps/web/src/browser/ServerBrowserSurface.tsx (pointer
// mapping, wheel units and key filtering).
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.

import { MODIFIER_BITS } from "../../../shared/browser-contract.mjs";

/** Modifier bits in the protocol: alt 1, ctrl 2, meta 4, shift 8. */
export const MODIFIER_ALT = MODIFIER_BITS.alt;
export const MODIFIER_CTRL = MODIFIER_BITS.ctrl;
export const MODIFIER_META = MODIFIER_BITS.meta;
export const MODIFIER_SHIFT = MODIFIER_BITS.shift;

/** DOM `WheelEvent.deltaMode` values. */
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
/** Pixels per wheel "line" for browsers that report line deltas. */
export const WHEEL_LINE_PX = 16;

/**
 * @param {{ altKey: boolean, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean }} event
 * @returns {number} Modifier bitmask, 0..15.
 */
export function modifierBits(event) {
  return (
    (event.altKey ? MODIFIER_ALT : 0) |
    (event.ctrlKey ? MODIFIER_CTRL : 0) |
    (event.metaKey ? MODIFIER_META : 0) |
    (event.shiftKey ? MODIFIER_SHIFT : 0)
  );
}

/**
 * Map a DOM `MouseEvent.button` value to the protocol button name.
 * @param {number} button
 * @returns {"none" | "left" | "middle" | "right"}
 */
export function buttonFromDomButton(button) {
  return button === 0 ? "left" : button === 1 ? "middle" : button === 2 ? "right" : "none";
}

/**
 * Bit for a protocol button in the `buttons` mask (DOM `MouseEvent.buttons`): left 1,
 * right 2, middle 4.
 * @param {"none" | "left" | "middle" | "right"} button
 * @returns {number}
 */
export function buttonBit(button) {
  return button === "left" ? 1 : button === "right" ? 2 : button === "middle" ? 4 : 0;
}

/**
 * The first pressed button in a DOM `buttons` mask, in left, right, middle order.
 * @param {number} buttons
 * @returns {"none" | "left" | "middle" | "right"}
 */
export function pressedButton(buttons) {
  return buttons & 1 ? "left" : buttons & 2 ? "right" : buttons & 4 ? "middle" : "none";
}

/**
 * Map a pointer position in the client viewport to page CSS px. The frame is drawn
 * `object-fit: contain` inside the canvas rectangle, so letterbox bars are outside the page.
 * Returns null when the point is outside the page, unless `clamp` is set (drags keep
 * tracking past the edge).
 * @param {{ clientX: number, clientY: number, clamp: boolean }} point
 * @param {{ left: number, top: number, width: number, height: number }} rect Canvas CSS box.
 * @param {{ width: number, height: number }} frame Canvas backing size (the last decoded frame).
 * @param {{ width: number, height: number }} viewport Page viewport in CSS px.
 * @returns {{ x: number, y: number, scale: number } | null}
 */
export function pagePointFromClient({ clientX, clientY, clamp }, rect, frame, viewport) {
  const fit = Math.min(rect.width / frame.width, rect.height / frame.height);
  const width = frame.width * fit;
  const height = frame.height * fit;
  if (!(width > 0 && height > 0)) return null;
  const scale = viewport.width / width;
  const x = (clientX - rect.left - (rect.width - width) / 2) * scale;
  const y = (clientY - rect.top - (rect.height - height) / 2) * (viewport.height / height);
  const inside = x >= 0 && y >= 0 && x <= viewport.width && y <= viewport.height;
  if (!inside && !clamp) return null;
  return {
    x: Math.min(Math.max(x, 0), viewport.width),
    y: Math.min(Math.max(y, 0), viewport.height),
    scale,
  };
}

/**
 * Convert a DOM wheel event's delta to pixels.
 * @param {{ deltaX: number, deltaY: number, deltaMode: number }} event
 * @param {number} viewportHeight Used for page-mode deltas.
 * @returns {{ deltaX: number, deltaY: number }}
 */
export function wheelDeltaPx(event, viewportHeight) {
  const unit =
    event.deltaMode === DOM_DELTA_LINE
      ? WHEEL_LINE_PX
      : event.deltaMode === DOM_DELTA_PAGE
        ? viewportHeight
        : 1;
  return { deltaX: event.deltaX * unit, deltaY: event.deltaY * unit };
}

/**
 * Protocol `wheel` message. Coordinates are page CSS px.
 * @param {{ x: number, y: number }} point
 * @param {{ deltaX: number, deltaY: number }} delta Pixels, from wheelDeltaPx.
 * @param {number} modifiers
 */
export function wheelMessage(point, delta, modifiers) {
  return {
    type: "wheel",
    x: point.x,
    y: point.y,
    deltaX: delta.deltaX,
    deltaY: delta.deltaY,
    modifiers,
  };
}

/**
 * Protocol `key` message for a DOM keyboard event, or null when the key must stay local.
 * Text is only sent with keydown, for printable keys without ctrl or meta. Enter sends "\r".
 * Shift+Escape (blur), Ctrl/Meta+V (paste) and Shift+Insert are left to the browser.
 * @param {"down" | "up"} action
 * @param {{
 *   key: string, code: string, keyCode: number, isComposing?: boolean,
 *   altKey: boolean, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean,
 * }} event
 * @returns {object | null} A `key` ClientMessage, or null.
 */
export function keyMessage(action, event) {
  if (event.isComposing || event.keyCode === 229 || event.key === "Process") return null;
  if (event.key === "Unidentified") return null;
  if (event.key === "Escape" && event.shiftKey) return null;
  const shortcut = event.ctrlKey || event.metaKey;
  if (shortcut && event.key.toLowerCase() === "v") return null;
  if (event.shiftKey && event.key === "Insert") return null;
  const text = shortcut
    ? undefined
    : [...event.key].length === 1
      ? event.key
      : event.key === "Enter"
        ? "\r"
        : undefined;
  return {
    type: "key",
    action,
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    ...(action === "down" && text !== undefined ? { text } : {}),
    modifiers: modifierBits(event),
  };
}
