// Adapted from T3 Code (https://github.com/pingdotgg/t3code): packages/client-runtime/src/preview/serverBrowserStream.ts
// and apps/web/src/browser/ServerBrowserSurface.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
import assert from "node:assert/strict";
import test from "node:test";
import {
  buttonBit,
  buttonFromDomButton,
  keyMessage,
  modifierBits,
  pagePointFromClient,
  pressedButton,
  wheelDeltaPx,
  wheelMessage,
} from "./streamInput.mjs";

const noModifiers = {
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
};

const keyEvent = (fields) => ({ ...noModifiers, key: "a", code: "KeyA", keyCode: 65, ...fields });

test("packs modifiers into the protocol bitmask: alt 1, ctrl 2, meta 4, shift 8", () => {
  assert.equal(modifierBits(noModifiers), 0);
  assert.equal(modifierBits({ ...noModifiers, altKey: true, shiftKey: true }), 9);
  assert.equal(modifierBits({ ...noModifiers, ctrlKey: true, metaKey: true }), 6);
  assert.equal(modifierBits({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true }), 15);
});

test("maps DOM buttons to protocol names and DOM buttons masks", () => {
  assert.equal(buttonFromDomButton(0), "left");
  assert.equal(buttonFromDomButton(1), "middle");
  assert.equal(buttonFromDomButton(2), "right");
  assert.equal(buttonFromDomButton(3), "none");
  assert.equal(buttonBit("left"), 1);
  assert.equal(buttonBit("right"), 2);
  assert.equal(buttonBit("middle"), 4);
  assert.equal(buttonBit("none"), 0);
  assert.equal(pressedButton(0), "none");
  assert.equal(pressedButton(2), "right");
  assert.equal(pressedButton(5), "left");
  assert.equal(pressedButton(4), "middle");
});

test("maps a pointer over a same-aspect frame to page CSS px", () => {
  // Frame is 2x device pixels, so the 800x400 canvas is shown at 0.5 scale with no bars.
  const point = pagePointFromClient(
    { clientX: 500, clientY: 250, clamp: false },
    { left: 100, top: 50, width: 800, height: 400 },
    { width: 1600, height: 800 },
    { width: 1280, height: 800 },
  );
  assert.deepEqual(point, { x: 640, y: 400, scale: 1.6 });
});

test("ignores letterbox bars unless the drag is clamped", () => {
  // Frame 1600x800 contained in a 1000x1000 box: drawn 1000x500 starting at y=250.
  const rect = { left: 0, top: 0, width: 1000, height: 1000 };
  const frame = { width: 1600, height: 800 };
  const viewport = { width: 1280, height: 640 };
  const inside = pagePointFromClient(
    { clientX: 500, clientY: 260, clamp: false },
    rect,
    frame,
    viewport,
  );
  assert.ok(inside);
  assert.equal(inside.x, 640);
  assert.ok(Math.abs(inside.y - 12.8) < 1e-9);
  assert.equal(
    pagePointFromClient({ clientX: 500, clientY: 100, clamp: false }, rect, frame, viewport),
    null,
  );
  assert.deepEqual(
    pagePointFromClient({ clientX: 500, clientY: 100, clamp: true }, rect, frame, viewport),
    { x: 640, y: 0, scale: 1.28 },
  );
});

test("returns null before a frame has a size", () => {
  assert.equal(
    pagePointFromClient(
      { clientX: 0, clientY: 0, clamp: true },
      { left: 0, top: 0, width: 0, height: 0 },
      { width: 1600, height: 800 },
      { width: 1280, height: 800 },
    ),
    null,
  );
});

test("converts wheel deltas to pixels for each delta mode", () => {
  assert.deepEqual(wheelDeltaPx({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800), {
    deltaX: 0,
    deltaY: 48,
  });
  assert.deepEqual(wheelDeltaPx({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 800), {
    deltaX: 0,
    deltaY: 800,
  });
  assert.deepEqual(wheelDeltaPx({ deltaX: 4, deltaY: -12, deltaMode: 0 }, 800), {
    deltaX: 4,
    deltaY: -12,
  });
});

test("builds a wheel message with page coordinates and modifiers", () => {
  assert.deepEqual(wheelMessage({ x: 10, y: 20 }, { deltaX: 0, deltaY: 48 }, 8), {
    type: "wheel",
    x: 10,
    y: 20,
    deltaX: 0,
    deltaY: 48,
    modifiers: 8,
  });
});

test("sends printable keys with text on keydown only", () => {
  assert.deepEqual(keyMessage("down", keyEvent({ shiftKey: true, key: "A" })), {
    type: "key",
    action: "down",
    key: "A",
    code: "KeyA",
    keyCode: 65,
    text: "A",
    modifiers: 8,
  });
  assert.equal(keyMessage("up", keyEvent({ key: "a" })).text, undefined);
});

test("sends Enter with a carriage return as its text", () => {
  const down = keyMessage("down", keyEvent({ key: "Enter", code: "Enter", keyCode: 13 }));
  assert.equal(down.text, "\r");
  assert.equal(
    keyMessage("up", keyEvent({ key: "Enter", code: "Enter", keyCode: 13 })).text,
    undefined,
  );
});

test("sends control shortcuts without text and keeps the modifier bits", () => {
  assert.deepEqual(keyMessage("down", keyEvent({ key: "c", ctrlKey: true })), {
    type: "key",
    action: "down",
    key: "c",
    code: "KeyA",
    keyCode: 65,
    modifiers: 2,
  });
});

test("sends non-printable keys without text", () => {
  const left = keyMessage("down", keyEvent({ key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 }));
  assert.equal(left.text, undefined);
  assert.equal(left.keyCode, 37);
});

test("leaves paste, blur, Shift+Insert, composition and unidentified keys to the browser", () => {
  assert.equal(keyMessage("down", keyEvent({ key: "v", ctrlKey: true })), null);
  assert.equal(keyMessage("down", keyEvent({ key: "V", metaKey: true })), null);
  assert.equal(keyMessage("down", keyEvent({ key: "Escape", shiftKey: true })), null);
  assert.equal(keyMessage("down", keyEvent({ key: "Insert", shiftKey: true })), null);
  assert.equal(keyMessage("down", keyEvent({ isComposing: true })), null);
  assert.equal(keyMessage("down", keyEvent({ keyCode: 229 })), null);
  assert.equal(keyMessage("down", keyEvent({ key: "Process" })), null);
  assert.equal(keyMessage("down", keyEvent({ key: "Unidentified" })), null);
});
