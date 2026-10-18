import test from "node:test";
import assert from "node:assert/strict";
import {
  clampViewport,
  editingCommand,
  keyEventParams,
  maskValues,
  modifiersOf,
  mouseEventParams,
  isLoopbackUrl,
  normalizeBrowserUrl,
  wheelEventParams,
} from "./browser-page.mjs";

test("normalizeBrowserUrl adds https to bare hosts and http to loopback", () => {
  assert.equal(normalizeBrowserUrl("example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(normalizeBrowserUrl("  localhost:5173  "), "http://localhost:5173/");
  assert.equal(normalizeBrowserUrl("127.0.0.1:8080/x"), "http://127.0.0.1:8080/x");
  assert.equal(normalizeBrowserUrl("http://example.com"), "http://example.com/");
});

test("normalizeBrowserUrl refuses empty input and non-web schemes", () => {
  assert.throws(() => normalizeBrowserUrl("   "), /Enter a URL/);
  assert.throws(() => normalizeBrowserUrl("file:///etc/passwd"), /Only http and https/);
  assert.throws(
    () => normalizeBrowserUrl("javascript:alert(1)"),
    /Only http and https|not a valid/,
  );
});

test("clampViewport keeps sizes inside 240..3840 x 240..2160 and rounds", () => {
  assert.deepEqual(clampViewport({ width: 100, height: 99 }), { width: 240, height: 240 });
  assert.deepEqual(clampViewport({ width: 5000, height: 3000 }), { width: 3840, height: 2160 });
  assert.deepEqual(clampViewport({ width: 1023.6, height: 767.2 }), { width: 1024, height: 767 });
  assert.throws(() => clampViewport({ width: Number.NaN, height: 800 }), TypeError);
});

test("modifiersOf accepts only integers 0..15", () => {
  assert.equal(modifiersOf({ modifiers: 15 }), 15);
  assert.equal(modifiersOf({ modifiers: 16 }), 0);
  assert.equal(modifiersOf({ modifiers: -1 }), 0);
  assert.equal(modifiersOf({ modifiers: 1.5 }), 0);
  assert.equal(modifiersOf({}), 0);
});

test("editingCommand maps ctrl or meta shortcuts only", () => {
  assert.deepEqual(editingCommand("c", 2), { commands: ["copy"] });
  assert.deepEqual(editingCommand("A", 4), { commands: ["selectAll"] });
  // Ctrl+Z already works natively on Linux; only Meta maps to the editing command.
  assert.equal(editingCommand("z", 2), null);
  assert.deepEqual(editingCommand("z", 4), { commands: ["undo"] });
  assert.deepEqual(editingCommand("z", 4 | 8), { commands: ["redo"] });
  assert.equal(editingCommand("a", 2), null);
  assert.equal(editingCommand("c", 1), null);
  assert.equal(editingCommand("c", 2 | 1), null);
});

test("mouseEventParams maps actions, buttons and click counts", () => {
  assert.deepEqual(
    mouseEventParams({ action: "down", x: 10, y: 20, button: "left", buttons: 1, clickCount: 1 }),
    {
      type: "mousePressed",
      x: 10,
      y: 20,
      button: "left",
      buttons: 1,
      clickCount: 1,
      modifiers: 0,
    },
  );
  const moved = mouseEventParams({ action: "move", x: 3, y: 4, button: "bogus" });
  assert.equal(moved.type, "mouseMoved");
  assert.equal(moved.button, "none");
  assert.equal(moved.clickCount, 0);
  assert.equal(
    mouseEventParams({ action: "up", x: 0, y: 0, button: "right" }).type,
    "mouseReleased",
  );
});

test("wheelEventParams carries deltas and modifiers", () => {
  assert.deepEqual(wheelEventParams({ x: 1, y: 2, deltaX: 0, deltaY: -120, modifiers: 8 }), {
    type: "mouseWheel",
    x: 1,
    y: 2,
    deltaX: 0,
    deltaY: -120,
    modifiers: 8,
  });
});

test("keyEventParams uses keyDown with text, rawKeyDown without, and keyUp on release", () => {
  const typed = keyEventParams({ action: "down", key: "a", code: "KeyA", text: "a" });
  assert.equal(typed.type, "keyDown");
  assert.equal(typed.text, "a");
  assert.equal(typed.unmodifiedText, "a");
  assert.equal(typed.windowsVirtualKeyCode, 65);

  const enter = keyEventParams({ action: "down", key: "Enter", code: "Enter", keyCode: 13 });
  assert.equal(enter.type, "rawKeyDown");
  assert.equal(enter.text, undefined);
  assert.equal(enter.windowsVirtualKeyCode, 13);

  const copy = keyEventParams({ action: "down", key: "c", code: "KeyC", modifiers: 2 });
  assert.deepEqual(copy.commands, ["copy"]);

  assert.deepEqual(
    keyEventParams({ action: "up", key: "Shift", code: "ShiftLeft", modifiers: 8 }),
    {
      type: "keyUp",
      key: "Shift",
      code: "ShiftLeft",
      modifiers: 8,
    },
  );
});

test("maskValues hides long values everywhere and short values only as whole words", () => {
  const tree = '- textbox "Password": hunter22\n- text: a cat and the word cat';
  assert.equal(
    maskValues(tree, ["hunter22"]),
    '- textbox "Password": ••••••••\n- text: a cat and the word cat',
  );
  assert.equal(maskValues("cat concat", ["cat"]), `${"••••••••"} concat`);
  assert.equal(maskValues("nothing", []), "nothing");
});

test("normalizeBrowserUrl rejects bad input with code invalid_url", () => {
  for (const input of ["", "   ", "file:///etc/passwd", "http://exa mple.com"]) {
    assert.throws(
      () => normalizeBrowserUrl(input),
      (error) => error.code === "invalid_url",
      `input ${JSON.stringify(input)}`,
    );
  }
});

test("isLoopbackUrl matches localhost, *.localhost, 127.0.0.1 and [::1] only", () => {
  assert.equal(isLoopbackUrl("http://localhost:3000/"), true);
  assert.equal(isLoopbackUrl("http://app.localhost/x"), true);
  assert.equal(isLoopbackUrl("http://127.0.0.1:8080"), true);
  assert.equal(isLoopbackUrl("http://[::1]:5173/"), true);
  assert.equal(isLoopbackUrl("https://example.com/"), false);
  assert.equal(isLoopbackUrl("https://localhost.example.com/"), false);
  assert.equal(isLoopbackUrl("http://10.0.0.5/"), false);
  assert.equal(isLoopbackUrl("not a url"), false);
});
