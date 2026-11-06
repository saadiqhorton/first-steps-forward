import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  clampViewport,
  editingCommand,
  keyEventParams,
  modifiersOf,
  mouseEventParams,
  normalizeBrowserUrl,
  wheelEventParams,
  xdotoolChords,
} from "./browser-protocol.mjs";
import {
  createBrowserHub,
  maskValues,
  normalizeBrowserUrl as publicNormalizeBrowserUrl,
} from "./browser-page.mjs";
import { createComputerManager } from "./computer.mjs";

test("normalizeBrowserUrl adds https to bare hosts and http to loopback", () => {
  assert.equal(normalizeBrowserUrl("example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(normalizeBrowserUrl("  localhost:5173  "), "http://localhost:5173/");
  assert.equal(normalizeBrowserUrl("127.0.0.1:8080/x"), "http://127.0.0.1:8080/x");
  assert.equal(normalizeBrowserUrl("http://example.com"), "http://example.com/");
});

test("browser-page keeps re-exporting protocol helpers for existing consumers", () => {
  assert.equal(publicNormalizeBrowserUrl, normalizeBrowserUrl);
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

test("xdotoolChords maps xdotool key names to Playwright chords, in order", () => {
  assert.deepEqual(xdotoolChords("Return"), ["Enter"]);
  assert.deepEqual(xdotoolChords("Tab Tab Return"), ["Tab", "Tab", "Enter"]);
  assert.deepEqual(xdotoolChords(["BackSpace", "Escape"]), ["Backspace", "Escape"]);
  assert.deepEqual(xdotoolChords("ctrl+a"), ["Control+KeyA"]);
  assert.deepEqual(xdotoolChords("ctrl+shift+r"), ["Control+Shift+KeyR"]);
  assert.deepEqual(xdotoolChords("shift+Tab super+1"), ["Shift+Tab", "Meta+Digit1"]);
  assert.deepEqual(xdotoolChords("Prior Next Up space"), [
    "PageUp",
    "PageDown",
    "ArrowUp",
    "Space",
  ]);
  assert.deepEqual(xdotoolChords("F5 a ! + minus"), ["F5", "a", "!", "+", "-"]);
});

test("xdotoolChords refuses empty input and unknown key names", () => {
  assert.throws(() => xdotoolChords(""), /keys is required/);
  assert.throws(() => xdotoolChords([]), /keys is required/);
  assert.throws(() => xdotoolChords("ctrl+Hyperdrive"), /Unknown key: Hyperdrive/);
});

// A context that answers every CDP command with an empty result, enough for BrowserSession.open.
class FakeContext extends EventEmitter {
  closed = false;
  calls = [];
  #page = Object.assign(new EventEmitter(), {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    url: () => "about:blank",
    title: async () => "",
    isClosed: () => false,
    mainFrame: () => ({}),
  });
  pages() {
    return [this.#page];
  }
  async newPage() {
    return this.#page;
  }
  async grantPermissions() {}
  async newCDPSession() {
    return Object.assign(new EventEmitter(), {
      send: async (method, params) => {
        this.calls.push({ method, params });
        return (
          {
            "Browser.getVersion": { userAgent: "Mozilla/5.0 Chrome/1.0" },
            "Page.getNavigationHistory": { entries: [{}], currentIndex: 0 },
            "Page.captureScreenshot": { data: "" },
          }[method] ?? {}
        );
      },
      detach: async () => {},
    });
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, description, timeoutMs = 2000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (check()) return;
    await sleep(5);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

/** A hub over fake contexts that records every context it opened, per project. */
function fakeHub(options) {
  const opened = [];
  const hub = createBrowserHub({
    ...options,
    async contextFor(projectId) {
      const context = new FakeContext();
      opened.push({ projectId, context });
      return context;
    },
  });
  return { hub, opened };
}

test("a hub closes an idle project, keeps one with a viewer, and reopens on the next call", async () => {
  const { hub, opened } = fakeHub({ idleMs: 60 });
  const idle = await hub.get("idle");
  const watched = await hub.get("watched");
  const stop = await watched.startScreencast({}, () => {});
  assert.equal(watched.viewerCount, 1);

  await waitFor(() => hub.peek("idle") === null, "idle session to close");
  assert.equal(idle.closed, true);
  assert.equal(opened[0].context.closed, true);
  assert.equal(hub.peek("watched"), watched, "a project with a viewer stays open");
  assert.equal(opened[1].context.closed, false);

  // The viewer leaving starts the idle clock from then, not from when it attached.
  await stop();
  assert.equal(hub.peek("watched"), watched);
  await waitFor(() => hub.peek("watched") === null, "unwatched session to close");

  const again = await hub.get("idle");
  assert.notEqual(again, idle);
  assert.equal(again.closed, false);
  assert.equal(opened.length, 3, "reopening used a fresh context");
  assert.equal(hub.peek("idle"), again);
  await hub.closeAll();
});

test("releaseInput waits until held keys and buttons are released", async () => {
  const { hub, opened } = fakeHub();
  const session = await hub.get("p");
  await session.input({ type: "key", action: "down", key: "Shift", code: "ShiftLeft" });
  await session.input({ type: "mouse", action: "down", button: "left", x: 5, y: 6 });

  await session.releaseInput();

  assert.deepEqual(
    opened[0].context.calls
      .filter(({ method }) => method.startsWith("Input.dispatch"))
      .map(({ method, params }) => [method, params.type]),
    [
      ["Input.dispatchKeyEvent", "rawKeyDown"],
      ["Input.dispatchMouseEvent", "mousePressed"],
      ["Input.dispatchKeyEvent", "keyUp"],
      ["Input.dispatchMouseEvent", "mouseReleased"],
    ],
  );

  await hub.closeAll();
});

test("every get() restarts the idle clock", async () => {
  const { hub } = fakeHub({ idleMs: 200 });
  const session = await hub.get("busy");
  for (let i = 0; i < 4; i++) {
    await sleep(80);
    assert.equal(await hub.get("busy"), session, "still the same session while it is used");
  }
  await waitFor(() => hub.peek("busy") === null, "unused session to close");
});

test("ADE_BROWSER_IDLE_MS sets the idle timeout", async () => {
  const before = process.env.ADE_BROWSER_IDLE_MS;
  process.env.ADE_BROWSER_IDLE_MS = "40";
  try {
    const { hub } = fakeHub();
    await hub.get("p");
    await waitFor(() => hub.peek("p") === null, "configured idle timeout");
  } finally {
    if (before === undefined) delete process.env.ADE_BROWSER_IDLE_MS;
    else process.env.ADE_BROWSER_IDLE_MS = before;
  }
});

test("computer status goes running, then stopped when idle, then running on the next action", async () => {
  const { hub } = fakeHub({ idleMs: 60 });
  const computers = createComputerManager({
    installer: { executable: async () => "/chrome", status: () => ({ state: "ready" }) },
    hub,
  });
  assert.equal(computers.status("p").status, "stopped");
  await computers.start("p");
  assert.equal(computers.status("p").status, "running");
  await waitFor(() => computers.status("p").status === "stopped", "computer session to stop");
  await computers.start("p");
  assert.equal(computers.status("p").status, "running");
  await hub.closeAll();
});
