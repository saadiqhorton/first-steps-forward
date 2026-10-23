// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/server/src/preview/ServerBrowser.ts,
// apps/server/src/preview/ServerBrowserPage.ts, packages/shared/src/preview.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
//
// Browser layer for the agent computer: each project's headless Chrome context, launched on this
// machine by browser-contexts.mjs. ADE works on the context's active page: viewer frames come
// from one CDP screencast per viewer, human input goes straight to CDP Input.*, browser_* tools
// use Playwright locators on aria refs, and computer_* tools drive the page by coordinates.
// Pages present as ordinary Chrome, copies made with the viewer's keys reach the viewer's
// clipboard, and file pickers are answered by whoever drives the page, as in T3.
// Versus T3 this is a plain module: no Effect runtime, no tab broker and no desktop attach.

import path from "node:path";

import { presentAsChrome } from "./browser-contexts.mjs";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const VIEWPORT_LIMITS = { minWidth: 240, maxWidth: 3840, minHeight: 240, maxHeight: 2160 };
// Frames and input render at 2x like T3's RENDER_SCALE, so text stays sharp in the viewer.
const RENDER_SCALE = 2;
// Chromium allows three unacked frames, so 100 ms pacing caps viewers near 30 fps.
const SCREENCAST_ACK_PACE_MS = 100;
const SCREENCAST_SETTLE_MS = 200;
const SCREENCAST_MOTION_FRAMES = 4;
const SCREENCAST_MOTION_WINDOW_MS = 300;
const SCREENCAST_MOTION_QUALITY = 50;
const AGENT_CURSOR_MOVE_MS = 160;
const AGENT_CURSOR_CLICK_LEAD_MS = 40;
const NAV_POLL_MS = 1_000;
const TEXT_LIMIT = 10_000;
const SNAPSHOT_TEXT_LIMIT = 20_000;
const DIALOG_TEXT_LIMIT = 4_000;
const MASK = "••••••••";
const LOOPBACK_PREFIX = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::|\/|$)/i;
const REF_PATTERN = /^(\d+)-((?:f\d+)?e\d+)$/;
// computer_* actions let the page react before the screenshot, as the old desktop did.
const COMPUTER_SETTLE_MS = 350;
const COMPUTER_WHEEL_STEP = 100;
const COMPUTER_MAX_WAIT_S = 10;

const CLIPBOARD_TEXT_LIMIT = 1024 * 1024;
const CLIPBOARD_WORLD = "ade-browser-clipboard";
// Headless Chromium shares one clipboard between every context, so the copy a viewer's copy or
// cut key makes is read from this world instead of the clipboard. Page scripts cannot see the
// world, and only a copy made while a real key is handled counts. (T3's CLIPBOARD_SCRIPT.)
const CLIPBOARD_SCRIPT = `(() => {
  let keying = false;
  let copied = "";
  // The same Ctrl or Cmd + C or X that editingCommand sends as copy or cut.
  addEventListener("keydown", (event) => {
    if (!event.isTrusted || event.altKey || event.ctrlKey === event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key !== "c" && key !== "x") return;
    keying = true;
    copied = "";
    setTimeout(() => { keying = false; });
  }, true);
  const selection = () => {
    let field = document.activeElement;
    while (field?.shadowRoot?.activeElement) field = field.shadowRoot.activeElement;
    if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && field.selectionStart !== null)
      return field.value.slice(field.selectionStart, field.selectionEnd ?? field.selectionStart);
    return String(document.getSelection() ?? "");
  };
  const record = (text) => {
    copied = String(text ?? "").slice(0, ${CLIPBOARD_TEXT_LIMIT});
  };
  // Capturing at window runs before page handlers can stop the event, and before cut removes
  // the selection.
  const snapshot = (event) => {
    if (keying && event.isTrusted) record(selection());
  };
  // Bubbling back to window picks up text a page handler set instead.
  const replace = (event) => {
    if (keying && event.isTrusted && event.defaultPrevented) record(event.clipboardData?.getData("text/plain"));
  };
  for (const type of ["copy", "cut"]) {
    addEventListener(type, snapshot, true);
    addEventListener(type, replace);
  }
  globalThis.takeCopy = () => {
    const text = copied;
    copied = "";
    return text;
  };
})();`;

const noop = () => {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** Resolves to `promise`'s value, or `fallback` on rejection or after `ms`. */
const withTimeout = (promise, ms, fallback) => {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise.catch(() => fallback), late]).finally(() => clearTimeout(timer));
};

const asRecord = (value) => (typeof value === "object" && value !== null ? value : null);
const numberOr = (value, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const coded = (code, message) => Object.assign(new Error(message), { code });
// Install and launch failures keep their own code and words (browser_installing,
// browser_libraries_missing, ...); anything else reads as the browser being unavailable.
const cdpUnavailable = (cause) =>
  cause?.code?.startsWith?.("browser_")
    ? cause
    : coded(
        "cdp_unavailable",
        `The agent browser is not available: ${cause instanceof Error ? cause.message : String(cause)}`,
      );

/**
 * Normalizes what the user or agent typed into an http(s) URL. Bare hosts get https, loopback
 * hosts get http, and other schemes are refused.
 * @param {string} rawUrl
 * @returns {string}
 */
export function normalizeBrowserUrl(rawUrl) {
  const trimmed = String(rawUrl ?? "").trim();
  if (trimmed.length === 0) throw coded("invalid_url", "Enter a URL to open.");
  const useHttp = LOOPBACK_PREFIX.test(trimmed);
  const candidate = trimmed.includes("://")
    ? trimmed
    : `${useHttp ? "http" : "https"}://${trimmed}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw coded("invalid_url", `"${trimmed}" is not a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw coded("invalid_url", `Only http and https URLs can be opened, not ${parsed.protocol}`);
  }
  return parsed.href;
}

/**
 * Clamps a requested CSS viewport to the limits ADE accepts.
 * @param {{ width: number, height: number }} size
 * @returns {{ width: number, height: number }}
 */
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

/** Protocol modifier bits: alt 1, ctrl 2, meta 4, shift 8. Anything out of 0..15 is 0. */
export function modifiersOf(message) {
  const value = numberOr(message.modifiers);
  return Number.isInteger(value) && value >= 0 && value < 16 ? value : 0;
}

// Cmd (meta) shortcuts and Ctrl copy/cut/undo/redo become editing commands, because headless
// Chromium does not run them as key bindings on Linux.
export function editingCommand(key, modifiers) {
  const modifier = modifiers & 0b0111;
  if (modifier !== 2 && modifier !== 4) return null;
  const lower = key.toLowerCase();
  const command =
    lower === "c"
      ? "copy"
      : lower === "x"
        ? "cut"
        : modifier !== 4
          ? null
          : lower === "a"
            ? "selectAll"
            : lower === "z"
              ? modifiers & 8
                ? "redo"
                : "undo"
              : null;
  return command ? { commands: [command] } : null;
}

/** CDP `Input.dispatchMouseEvent` params for a protocol `mouse` message. */
export function mouseEventParams(message) {
  const action = message.action;
  const type =
    action === "down" ? "mousePressed" : action === "up" ? "mouseReleased" : "mouseMoved";
  const button = ["none", "left", "middle", "right"].includes(String(message.button))
    ? message.button
    : "none";
  return {
    type,
    x: numberOr(message.x),
    y: numberOr(message.y),
    button,
    buttons: numberOr(message.buttons),
    clickCount: numberOr(message.clickCount, type === "mouseMoved" ? 0 : 1),
    modifiers: modifiersOf(message),
  };
}

/** CDP `Input.dispatchMouseEvent` params for a protocol `wheel` message. */
export function wheelEventParams(message) {
  return {
    type: "mouseWheel",
    x: numberOr(message.x),
    y: numberOr(message.y),
    deltaX: numberOr(message.deltaX),
    deltaY: numberOr(message.deltaY),
    modifiers: modifiersOf(message),
  };
}

/**
 * CDP `Input.dispatchKeyEvent` params for a protocol `key` message. Text makes a keyDown with
 * text, and no text makes a rawKeyDown, as T3 does.
 */
export function keyEventParams(message) {
  const key = typeof message.key === "string" ? message.key : "";
  const code = typeof message.code === "string" ? message.code : "";
  const modifiers = modifiersOf(message);
  if (message.action === "up") return { type: "keyUp", key, code, modifiers };
  const text = typeof message.text === "string" && message.text.length > 0 ? message.text : null;
  return {
    type: text ? "keyDown" : "rawKeyDown",
    key,
    code,
    modifiers,
    ...(text ? { text, unmodifiedText: text } : {}),
    ...(editingCommand(key, modifiers) ?? {}),
    windowsVirtualKeyCode: numberOr(
      message.keyCode,
      key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
    ),
  };
}

// xdotool key names (what computer_key documents) to Playwright's. Single characters pass through.
const XDOTOOL_KEYS = {
  ctrl: "Control",
  control: "Control",
  control_l: "Control",
  control_r: "Control",
  shift: "Shift",
  shift_l: "Shift",
  shift_r: "Shift",
  alt: "Alt",
  alt_l: "Alt",
  alt_r: "Alt",
  meta: "Meta",
  super: "Meta",
  super_l: "Meta",
  super_r: "Meta",
  cmd: "Meta",
  win: "Meta",
  enter: "Enter",
  return: "Enter",
  kp_enter: "Enter",
  esc: "Escape",
  escape: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  tab: "Tab",
  iso_left_tab: "Tab",
  space: "Space",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  pageup: "PageUp",
  page_up: "PageUp",
  prior: "PageUp",
  pagedown: "PageDown",
  page_down: "PageDown",
  next: "PageDown",
  home: "Home",
  end: "End",
  minus: "-",
  plus: "+",
  equal: "=",
  period: ".",
  comma: ",",
  slash: "/",
  backslash: "\\",
  semicolon: ";",
  apostrophe: "'",
  grave: "`",
  bracketleft: "[",
  bracketright: "]",
};
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

/**
 * Turns computer_key's xdotool-style keys ("ctrl+l", "Tab Tab Return", ["Return"]) into
 * Playwright chords for keyboard.press, in order.
 * @param {string | string[]} keys
 * @returns {string[]}
 */
export function xdotoolChords(keys) {
  const combos = typeof keys === "string" ? keys.split(/\s+/).filter(Boolean) : keys;
  if (
    !Array.isArray(combos) ||
    combos.length === 0 ||
    !combos.every((k) => typeof k === "string" && k)
  ) {
    throw new Error('keys is required, e.g. "ctrl+l" or ["Return"]');
  }
  return combos.map((combo) => {
    // A lone "+" is the plus key, not an empty chord.
    const parts = combo === "+" ? ["+"] : combo.split("+").filter(Boolean);
    if (parts.length === 0) throw new Error(`Empty key combo: "${combo}"`);
    const names = parts.map((part) => {
      const mapped = XDOTOOL_KEYS[part.toLowerCase()];
      if (mapped) return mapped;
      if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(part)) return part.toUpperCase();
      if ([...part].length === 1) return part;
      throw new Error(`Unknown key: ${part}`);
    });
    // With a modifier held, letters and digits press by code, so Shift+R really reads as "R".
    const modified = names.slice(0, -1).some((name) => MODIFIER_KEYS.has(name));
    const last = names.at(-1);
    if (modified && /^[a-z]$/i.test(last)) names[names.length - 1] = `Key${last.toUpperCase()}`;
    else if (modified && /^[0-9]$/.test(last)) names[names.length - 1] = `Digit${last}`;
    return names.join("+");
  });
}

/**
 * Masks password values wherever the snapshot prints them. Values under four characters only
 * match between non-word characters, so short values do not hide unrelated text.
 * @param {string} text
 * @param {ReadonlyArray<string>} values
 */
export function maskValues(text, values) {
  let masked = text;
  const unique = [...new Set(values.filter((value) => value.length > 0))];
  // Longest first, so a value inside another never leaves the rest of it showing.
  for (const value of unique.sort((a, b) => b.length - a.length)) {
    const literal = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern =
      value.length < 4
        ? new RegExp(`(?<![\\p{L}\\p{N}_])${literal}(?![\\p{L}\\p{N}_])`, "gu")
        : new RegExp(literal, "gu");
    masked = masked.replace(pattern, MASK);
  }
  return masked;
}

/** Page-side helpers. Playwright serializes these, so they must not close over anything. */
const FOCUS_TEXT_FIELD = (element) => {
  const nonText = [
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ];
  const textControl =
    element.tagName === "TEXTAREA" ||
    (element.tagName === "INPUT" && !nonText.includes(element.type || "text"));
  if (!(textControl || element.isContentEditable) || element.disabled || element.readOnly) {
    return false;
  }
  element.focus();
  const active = element.getRootNode().activeElement;
  return active != null && (active === element || element.contains(active));
};
const SELECT_OPTIONS = (element) =>
  element.tagName === "SELECT"
    ? Array.from(element.options, ({ value, label }) => ({ value, label: label.trim() }))
    : null;
const PASSWORD_VALUES = () =>
  Array.from(document.querySelectorAll('input[type="password"]'), (input) => input.value);

/** A pending dialog is reported to the viewer and blocks page-side work until answered. */
const dialogState = (dialog) => ({
  type: dialog.type(),
  message: dialog.message().slice(0, DIALOG_TEXT_LIMIT),
  defaultValue: dialog.defaultValue().slice(0, DIALOG_TEXT_LIMIT),
});

/**
 * One viewer's CDP screencast. It follows the session's active page, paces acks like T3, and
 * drops to half scale while the viewer scrolls, then settles with a full-scale still.
 */
class Screencast {
  #host;
  #params;
  #onFrame;
  #page = null;
  #session = null;
  #closed = false;
  #queue = Promise.resolve();
  #scale = 1;
  #motion = false;
  #recent = [];
  #framesInFlight = 0;
  #mayHaveDropped = false;
  #settle = null;
  #started = false;

  /**
   * @param {{ context: () => import("playwright-core").BrowserContext, lastWheelAt: () => number }} host
   * @param {{ maxWidth: number, maxHeight: number, quality: number }} params
   * @param {(jpeg: Buffer, ack: () => void) => void} onFrame
   */
  constructor(host, params, onFrame) {
    this.#host = host;
    this.#params = params;
    this.#onFrame = onFrame;
  }

  async start(page) {
    await this.#attach(page);
    await this.#restart(1);
    // An idle page sends no frame to a new screencast, so the viewer starts from a still.
    if (!this.#started) await this.#still();
  }

  /** Moves the stream to a new active page. Frames from the old page are acked and dropped. */
  async retarget(page) {
    if (this.#closed || page === this.#page) return;
    const previous = this.#session;
    try {
      await this.#attach(page);
    } catch {
      return;
    }
    clearTimeout(this.#settle);
    this.#settle = null;
    this.#motion = false;
    this.#recent.length = 0;
    void previous
      ?.send("Page.stopScreencast")
      .catch(noop)
      .then(() => previous.detach())
      .catch(noop);
    await this.#restart(1);
    await this.#still();
  }

  async stop() {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#settle);
    this.#settle = null;
    const session = this.#session;
    this.#session = null;
    await this.#queue;
    await session?.send("Page.stopScreencast").catch(noop);
    await session?.detach().catch(noop);
  }

  async #attach(page) {
    const session = await this.#host.context().newCDPSession(page);
    this.#page = page;
    this.#session = session;
    session.on("Page.screencastFrame", (frame) => this.#frame(session, frame));
  }

  // Start and stop calls are serialized so a motion change never races a settle.
  #restart(scale) {
    this.#scale = scale;
    this.#queue = this.#queue.then(async () => {
      const session = this.#session;
      if (this.#closed || !session) return;
      const { maxWidth, maxHeight, quality } = this.#params;
      await session.send("Page.stopScreencast").catch(noop);
      await session
        .send("Page.startScreencast", {
          format: "jpeg",
          quality: this.#scale < 1 ? Math.min(quality, SCREENCAST_MOTION_QUALITY) : quality,
          maxWidth: Math.max(1, Math.round(maxWidth * this.#scale)),
          maxHeight: Math.max(1, Math.round(maxHeight * this.#scale)),
        })
        .catch(noop);
    });
    return this.#queue;
  }

  async #still() {
    const session = this.#session;
    if (this.#closed || !session) return;
    const shot = await session
      .send("Page.captureScreenshot", { format: "jpeg", quality: this.#params.quality })
      .catch(() => null);
    if (!shot || this.#closed || session !== this.#session) return;
    this.#onFrame(Buffer.from(shot.data, "base64"), noop);
  }

  #frame(session, frame) {
    if (this.#closed) return;
    // A frame from a page that is no longer active is released to Chromium, not forwarded.
    if (session !== this.#session) {
      void session.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(noop);
      return;
    }
    this.#started = true;
    if (this.#framesInFlight > 0) this.#mayHaveDropped = true;
    this.#framesInFlight += 1;
    const arrivedAt = Date.now();
    this.#recent.push(arrivedAt);
    while (this.#recent[0] < arrivedAt - SCREENCAST_MOTION_WINDOW_MS) this.#recent.shift();
    const lastWheel = this.#host.lastWheelAt();
    if (
      !this.#motion &&
      this.#recent.length >= SCREENCAST_MOTION_FRAMES &&
      arrivedAt - lastWheel < SCREENCAST_MOTION_WINDOW_MS
    ) {
      this.#motion = true;
      void this.#restart(0.5);
    } else if (this.#motion && arrivedAt - lastWheel > SCREENCAST_SETTLE_MS) {
      this.#motion = false;
      this.#recent.length = 0;
      void this.#restart(1);
    }
    clearTimeout(this.#settle);
    this.#settle = setTimeout(() => {
      this.#settle = null;
      if (!this.#motion && !this.#mayHaveDropped) return;
      this.#mayHaveDropped = false;
      if (this.#motion) {
        this.#motion = false;
        this.#recent.length = 0;
        void this.#restart(1);
      }
      void this.#still();
    }, SCREENCAST_SETTLE_MS);
    let acked = false;
    // Called once the viewer acks. Chromium gets its ack no sooner than the pacing allows.
    const ack = () => {
      if (acked) return;
      acked = true;
      setTimeout(
        () => {
          this.#framesInFlight -= 1;
          void session.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(noop);
        },
        arrivedAt + SCREENCAST_ACK_PACE_MS - Date.now(),
      );
    };
    this.#onFrame(Buffer.from(frame.data, "base64"), ack);
  }
}

class BrowserSession {
  #context;
  #onClosed;
  #active = null;
  #closed = false;
  #listeners = new Map();
  #controls = new WeakMap();
  #watched = new WeakSet();
  /** Each watched page's preparation; navigations wait for it. */
  #preparing = new WeakMap();
  #screencasts = new Set();
  #viewport = { ...DEFAULT_VIEWPORT };
  #lastWheelAt = 0;
  #inputChain = Promise.resolve();
  #pressedKeys = new Map();
  #pressedButtons = new Map();
  #title = "";
  #loading = false;
  #history = { canGoBack: false, canGoForward: false };
  #navSeq = 0;
  #lastNav = "";
  #dialog = null;
  #refs = null;
  #refGeneration = 0;
  #pointerSequence = 0;
  #poll = null;
  #mouse = { x: 0, y: 0 };
  /** @type {{ id: string, page: import("playwright-core").Page, chooser: import("playwright-core").FileChooser, multiple: boolean, accept: string } | null} */
  #fileChooser = null;
  #fileChooserSeq = 0;

  /** @private Use createBrowserHub. */
  constructor(context, onClosed) {
    this.#context = context;
    this.#onClosed = onClosed;
  }

  static async open({ context, onClosed }) {
    const session = new BrowserSession(context, onClosed);
    await session.#init();
    return session;
  }

  async #init() {
    this.#context.on("close", () => this.#finish());
    // Pages may write the clipboard as they would in a normal tab, as T3 grants.
    await this.#context.grantPermissions(["clipboard-write"]).catch(noop);
    this.#context.on("page", (page) => {
      this.#watch(page);
      this.#activate(page);
    });
    for (const page of this.#context.pages()) this.#watch(page);
    const usable = this.#usable();
    let initial = usable.find((p) => p.url() && p.url() !== "about:blank") ?? usable.at(-1);
    if (!initial) initial = await this.#context.newPage();
    this.#watch(initial);
    // The first page presents as Chrome before anything navigates it.
    await this.#preparing.get(initial);
    this.#activate(initial);
    this.#poll = setInterval(() => {
      if (!this.#dialog) void this.#refreshNav();
    }, NAV_POLL_MS);
    this.#poll.unref?.();
  }

  get closed() {
    return this.#closed;
  }

  /** Current navigation state. canGoBack and canGoForward are cached from CDP history. */
  nav() {
    return {
      url: this.#active?.url() ?? "about:blank",
      title: this.#title,
      loading: this.#loading,
      canGoBack: this.#history.canGoBack,
      canGoForward: this.#history.canGoForward,
    };
  }

  viewport() {
    return { ...this.#viewport };
  }

  /**
   * Subscribes to "nav", "viewport", "pointer", "dialog", "fileChooser" or "closed".
   * @returns {() => void} unsubscribe
   */
  on(event, callback) {
    let set = this.#listeners.get(event);
    if (!set) this.#listeners.set(event, (set = new Set()));
    set.add(callback);
    return () => set.delete(callback);
  }

  #emit(event, payload) {
    for (const callback of this.#listeners.get(event) ?? []) callback(payload);
  }

  /**
   * Starts a screencast for one viewer on its own CDP session.
   * @returns {Promise<() => Promise<void>>} stop function
   */
  async startScreencast(options = {}, onFrame) {
    if (this.#closed || !this.#active) throw cdpUnavailable(new Error("The browser closed."));
    const params = {
      maxWidth: Math.max(1, Math.round(numberOr(options.maxWidth, 1280))),
      maxHeight: Math.max(1, Math.round(numberOr(options.maxHeight, 800))),
      quality: Math.min(100, Math.max(1, Math.round(numberOr(options.quality, 70)))),
    };
    // A viewer attaching re-reads the real viewport, so its first frame matches the mapping.
    if (this.#active) void this.#syncViewport(this.#active);
    const stream = new Screencast(
      { context: () => this.#context, lastWheelAt: () => this.#lastWheelAt },
      params,
      onFrame,
    );
    this.#screencasts.add(stream);
    try {
      await stream.start(this.#active);
    } catch (cause) {
      this.#screencasts.delete(stream);
      throw cdpUnavailable(cause);
    }
    return async () => {
      this.#screencasts.delete(stream);
      await stream.stop();
    };
  }

  /**
   * Human input for the active page, applied in arrival order. Rejects if CDP fails. A copy or
   * cut key resolves with the text it copied, for the viewer's own clipboard.
   * @param {object} message protocol `mouse`, `wheel`, `key` or `text` message
   * @returns {Promise<{ copied?: string } | undefined>}
   */
  input(message) {
    const run = this.#inputChain.then(() => this.#dispatch(message));
    this.#inputChain = run.catch(noop);
    return run;
  }

  async #dispatch(raw) {
    const message = asRecord(raw);
    const page = this.#active;
    if (!message || !page) return;
    const cdp = await this.#control(page);
    switch (message.type) {
      case "mouse": {
        const params = mouseEventParams(message);
        await cdp.send("Input.dispatchMouseEvent", params);
        if (params.button !== "none") {
          if (message.action === "down") {
            this.#pressedButtons.set(params.button, { x: params.x, y: params.y });
          } else if (message.action === "up") {
            this.#pressedButtons.delete(params.button);
          }
        }
        return;
      }
      case "wheel":
        this.#lastWheelAt = Date.now();
        await cdp.send("Input.dispatchMouseEvent", wheelEventParams(message));
        return;
      case "key": {
        const params = keyEventParams(message);
        const command = params.commands?.[0];
        const copying = params.type !== "keyUp" && (command === "copy" || command === "cut");
        // Clears any copy a page script recorded without a real key, so only this one counts.
        if (copying) await this.#takeCopiedText(cdp);
        await cdp.send("Input.dispatchKeyEvent", params);
        const id = String(message.code || message.key || "");
        if (message.action === "up") this.#pressedKeys.delete(id);
        else this.#pressedKeys.set(id, { key: params.key, code: params.code });
        if (copying) {
          const copied = await this.#takeCopiedText(cdp);
          if (copied) return { copied };
        }
        return;
      }
      case "text":
        if (typeof message.text === "string" && message.text.length > 0) {
          await cdp.send("Input.insertText", { text: message.text.slice(0, TEXT_LIMIT) });
        }
        return;
    }
  }

  /**
   * Releases keys and buttons the viewer left held on the active page, as T3 does on hand-back.
   */
  releaseInput() {
    if (this.#active) this.#releaseHeldInput(this.#active);
  }

  #releaseHeldInput(page) {
    const keys = [...this.#pressedKeys.values()];
    const buttons = [...this.#pressedButtons];
    this.#pressedKeys.clear();
    this.#pressedButtons.clear();
    if (keys.length === 0 && buttons.length === 0) return;
    void (async () => {
      const cdp = await this.#control(page).catch(() => null);
      if (!cdp) return;
      for (const { key, code } of keys) {
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code }).catch(noop);
      }
      for (const [button, point] of buttons) {
        await cdp
          .send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            button,
            ...point,
            buttons: 0,
            clickCount: 1,
          })
          .catch(noop);
      }
    })();
  }

  /**
   * Re-reads the CSS viewport. The context keeps a fixed 1280x800 page, the size computer_*
   * coordinates refer to, and viewers scale it to fit.
   * @returns {Promise<{ width: number, height: number }>}
   */
  async resize(_size) {
    if (this.#active) await this.#syncViewport(this.#active);
    this.#emit("viewport", this.viewport());
    return this.viewport();
  }

  /** Navigates the active page (http and https only). */
  async navigate(url) {
    const target = normalizeBrowserUrl(url);
    const page = this.#page();
    await this.#preparing.get(page);
    await this.#go(page.goto(target, { waitUntil: "commit", timeout: DEFAULT_TIMEOUT_MS }));
  }

  /** @param {-1 | 1} delta */
  async history(delta) {
    const page = this.#page();
    const options = { waitUntil: "commit", timeout: DEFAULT_TIMEOUT_MS };
    await this.#go(delta < 0 ? page.goBack(options) : page.goForward(options));
  }

  async reload({ ignoreCache } = {}) {
    const page = this.#page();
    if (ignoreCache === true) {
      const cdp = await this.#control(page);
      await cdp.send("Page.reload", { ignoreCache: true });
      return;
    }
    await this.#go(page.reload({ waitUntil: "commit", timeout: DEFAULT_TIMEOUT_MS }));
  }

  /** Answers the pending dialog. Clears it before answering, so a failure never leaves it stuck. */
  async dialog({ accept, promptText } = {}) {
    const pending = this.#dialog;
    if (!pending) throw new Error("No dialog is pending.");
    this.#dialog = null;
    this.#emit("dialog", null);
    if (accept) {
      await pending.dialog.accept(typeof promptText === "string" ? promptText : undefined);
    } else {
      await pending.dialog.dismiss();
    }
    this.#refs = null;
  }

  /**
   * Runs one browser_* tool action. Names are the short forms (`click`) or the tool names
   * (`browser_click`). Results are concise text, or { image, mimeType } for screenshots.
   * @param {{ action: string, [key: string]: unknown }} input
   */
  async runAgentAction(input) {
    const name = String(input?.action ?? "").replace(/^browser_/, "");
    const page = this.#page();
    // Page script is blocked while a dialog is open, so only status and the answer can run.
    if (this.#dialog && name !== "status" && name !== "dialog") {
      throw coded(
        "dialog_pending",
        "A browser dialog is pending. Call browser_dialog to accept or dismiss it first.",
      );
    }
    switch (name) {
      case "status":
        return { text: this.#statusText() };
      case "navigate": {
        const url = normalizeBrowserUrl(input.url);
        await this.#preparing.get(page);
        await this.#go(page.goto(url, { waitUntil: "load", timeout: DEFAULT_TIMEOUT_MS }));
        return { text: await this.#settledStatus() };
      }
      case "back":
      case "forward": {
        // Commit first, then a short best-effort wait: a history step can finish without a load.
        const options = { waitUntil: "commit", timeout: DEFAULT_TIMEOUT_MS };
        const moved = await this.#go(
          name === "back" ? page.goBack(options) : page.goForward(options),
        );
        if (moved === null) {
          const where = name === "back" ? "back to" : "forward to";
          return { text: `No page to go ${where}.\n${this.#statusText()}` };
        }
        await page.waitForLoadState("load", { timeout: 5000 }).catch(noop);
        return { text: await this.#settledStatus() };
      }
      case "reload":
        await this.#go(page.reload({ waitUntil: "commit", timeout: DEFAULT_TIMEOUT_MS }));
        await page.waitForLoadState("load", { timeout: 5000 }).catch(noop);
        return { text: await this.#settledStatus() };
      case "snapshot":
        return { text: await this.#snapshotText() };
      case "screenshot": {
        const buffer = await page.screenshot({
          type: "png",
          scale: "css",
          timeout: DEFAULT_TIMEOUT_MS,
        });
        return { image: buffer.toString("base64"), mimeType: "image/png" };
      }
      case "click": {
        const locator = this.#locator(input.ref);
        const point = await this.#target(locator);
        await this.#cursor(point, "click");
        const clicked = locator.click({
          button: input.button ?? "left",
          clickCount: input.double === true ? 2 : 1,
          timeout: DEFAULT_TIMEOUT_MS,
        });
        return { text: (await this.#untilDialog(page, clicked)) ?? `Clicked ${input.ref}.` };
      }
      case "type": {
        const text = requireString(input.text, "text");
        const locator = this.#locator(input.ref);
        const point = await this.#target(locator);
        await this.#cursor(point, "click");
        const focused = await locator.evaluate(FOCUS_TEXT_FIELD, undefined, {
          timeout: DEFAULT_TIMEOUT_MS,
        });
        if (!focused) {
          throw new Error("The target is not an enabled text field, so no text was typed.");
        }
        await page.keyboard.insertText(text);
        if (input.submit === true) await page.keyboard.press("Enter");
        return { text: `Typed into ${input.ref}.` };
      }
      case "press": {
        const key = requireString(input.key, "key");
        await page.keyboard.press(key);
        return { text: `Pressed ${key}.` };
      }
      case "hover": {
        const locator = this.#locator(input.ref);
        const point = await this.#target(locator);
        await this.#cursor(point, "move");
        await locator.hover({ timeout: DEFAULT_TIMEOUT_MS });
        return { text: `Hovered ${input.ref}.` };
      }
      case "select": {
        const values = Array.isArray(input.values) ? input.values.map(String) : [];
        if (values.length === 0) throw new Error("Pass at least one option value or label.");
        const locator = this.#locator(input.ref);
        const point = await this.#target(locator);
        await this.#cursor(point, "click");
        const options = await locator.evaluate(SELECT_OPTIONS, undefined, {
          timeout: DEFAULT_TIMEOUT_MS,
        });
        if (options === null) {
          throw new Error(
            "This element is not a <select>. Click a custom dropdown, then click its option.",
          );
        }
        const resolved = values.map(
          (entry) =>
            options.find((option) => option.value === entry)?.value ??
            options.find((option) => option.label === entry.trim())?.value ??
            entry,
        );
        const selected = await locator.selectOption(resolved, { timeout: DEFAULT_TIMEOUT_MS });
        return { text: `Selected ${selected.join(", ")} in ${input.ref}.` };
      }
      case "scroll": {
        const deltaX = numberOr(input.deltaX);
        const deltaY = numberOr(input.deltaY);
        if (input.ref !== undefined) {
          await this.#locator(input.ref).evaluate(
            (element, [x, y]) => element.scrollBy(x, y),
            [deltaX, deltaY],
          );
        } else {
          await page.evaluate(([x, y]) => globalThis.scrollBy(x, y), [deltaX, deltaY]);
        }
        return { text: `Scrolled by ${deltaX}, ${deltaY}.` };
      }
      case "wait_for":
        return { text: await this.#waitFor(input) };
      case "dialog":
        await this.dialog({ accept: input.accept === true, promptText: input.promptText });
        return { text: `${input.accept === true ? "Accepted" : "Dismissed"} the dialog.` };
      case "upload":
        return { text: await this.#upload(input) };
      default:
        throw coded("unknown_action", `Unknown browser action "${input?.action}".`);
    }
  }

  // T3's uploadFiles: a file input by ref, or else the file picker the page has open.
  async #upload(input) {
    const paths = Array.isArray(input.paths) ? input.paths.map(String) : [];
    const relative = paths.find((file) => !path.isAbsolute(file));
    if (relative !== undefined) throw new Error(`Upload paths must be absolute: ${relative}`);
    if (input.ref !== undefined) {
      await this.#locator(input.ref).setInputFiles(paths, { timeout: DEFAULT_TIMEOUT_MS });
      return `Set ${paths.length} file(s) on ${input.ref}.`;
    }
    const open = this.#fileChooser;
    if (!open) {
      throw coded(
        "no_file_chooser",
        "No file picker is open. Click the page's upload control first, or pass the file input's ref.",
      );
    }
    if (paths.length > 1 && !open.multiple) throw new Error("This file picker accepts one file.");
    if (paths.length > 0) await open.chooser.setFiles(paths, { timeout: DEFAULT_TIMEOUT_MS });
    this.#closeFileChooser(open);
    return paths.length > 0
      ? `Chose ${paths.length} file(s) in the file picker.`
      : "Closed the file picker without a file.";
  }

  /**
   * Runs one computer_* tool action by viewport coordinates, then captures the page, as the old
   * desktop control server did. Returns { screenshot, mimeType, cursor, width, height, note? };
   * the screenshot is left out while a JavaScript dialog blocks the page.
   * @param {{ action: string, [key: string]: unknown }} input
   */
  async runComputerAction(input) {
    const action = String(input?.action ?? "");
    let page = this.#page();
    if (this.#dialog && action !== "screenshot" && action !== "wait") {
      throw coded("dialog_pending", this.#dialogNote());
    }
    const chooserBefore = this.#fileChooser;
    let note = null;
    switch (action) {
      case "screenshot":
        break;
      case "click":
      case "double_click":
      case "right_click":
      case "middle_click": {
        const point = pointOf(input);
        const button =
          { right_click: "right", middle_click: "middle" }[action] ?? input.button ?? "left";
        if (!["left", "middle", "right"].includes(button)) {
          throw new Error("button must be left, middle, or right");
        }
        await this.#cursor(point, "click");
        this.#mouse = point;
        note = await this.#untilDialog(
          page,
          page.mouse.click(point.x, point.y, {
            button,
            clickCount: action === "double_click" ? 2 : 1,
          }),
        );
        break;
      }
      case "move": {
        const point = pointOf(input);
        await this.#cursor(point, "move");
        this.#mouse = point;
        await page.mouse.move(point.x, point.y);
        break;
      }
      case "drag": {
        const from = pointOf(input);
        const to = pointOf(input, "to_x", "to_y");
        await this.#cursor(from, "move");
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        // Intermediate motion so apps see a real drag.
        await page.mouse.move(to.x, to.y, { steps: 10 });
        await page.mouse.up();
        this.#mouse = to;
        await this.#cursor(to, "move");
        break;
      }
      case "type":
        await page.keyboard.type(requireString(input.text, "text"));
        break;
      case "key":
        for (const chord of xdotoolChords(input.keys)) {
          await page.keyboard.press(chord);
          await sleep(40);
        }
        break;
      case "scroll": {
        const direction = input.direction ?? "down";
        if (!["up", "down", "left", "right"].includes(direction)) {
          throw new Error("direction must be up, down, left, or right");
        }
        const amount = Math.max(1, Math.min(Math.trunc(numberOr(input.amount, 3)), 20));
        if (input.x !== undefined || input.y !== undefined) {
          const point = pointOf(input);
          await this.#cursor(point, "move");
          this.#mouse = point;
          await page.mouse.move(point.x, point.y);
        }
        const step = amount * COMPUTER_WHEEL_STEP;
        this.#lastWheelAt = Date.now();
        await page.mouse.wheel(
          direction === "left" ? -step : direction === "right" ? step : 0,
          direction === "up" ? -step : direction === "down" ? step : 0,
        );
        break;
      }
      case "open_url": {
        const url = normalizeBrowserUrl(input.url);
        await this.#preparing.get(page);
        await this.#go(page.goto(url, { waitUntil: "load", timeout: DEFAULT_TIMEOUT_MS }));
        break;
      }
      case "wait":
        await sleep(Math.max(0, Math.min(numberOr(input.seconds, 1), COMPUTER_MAX_WAIT_S)) * 1000);
        break;
      default:
        throw coded("unknown_action", `Unknown computer action "${input?.action}".`);
    }
    if (action !== "screenshot" && action !== "wait" && action !== "open_url") {
      await sleep(COMPUTER_SETTLE_MS);
    }
    if (this.#fileChooser && this.#fileChooser !== chooserBefore) {
      note = "A file picker opened. Answer it with browser_upload and absolute file paths.";
    }
    const { width, height } = this.#viewport;
    const result = { width, height, cursor: { ...this.#mouse }, ...(note ? { note } : {}) };
    // Page script, and so a capture, is blocked while a dialog is open.
    if (this.#dialog) return { ...result, note: note ?? this.#dialogNote() };
    page = this.#page();
    const shot = await page.screenshot({ type: "png", scale: "css", timeout: DEFAULT_TIMEOUT_MS });
    return { ...result, screenshot: shot.toString("base64"), mimeType: "image/png" };
  }

  #dialogNote() {
    const { type, message } = dialogState(this.#dialog.dialog);
    return `A JavaScript ${type} dialog is open: "${message}". Call browser_dialog to accept or dismiss it.`;
  }

  /** The file picker the page has open, as viewers see it, or null. */
  fileChooser() {
    const open = this.#fileChooser;
    return open ? { id: open.id, multiple: open.multiple, accept: open.accept } : null;
  }

  /**
   * Answers the open file picker with local file paths. No paths closes it without a file.
   * @returns {Promise<boolean>} false when `id` is not the picker that is open
   */
  async answerFileChooser(id, paths) {
    const open = this.#fileChooser;
    if (!open || open.id !== id) return false;
    if (paths.length > 0) {
      await open.chooser.setFiles(open.multiple ? paths : paths.slice(0, 1), {
        timeout: DEFAULT_TIMEOUT_MS,
      });
    }
    this.#closeFileChooser(open);
    return true;
  }

  async #offerFileChooser(page, chooser) {
    const accept =
      (await chooser
        .element()
        .getAttribute("accept")
        .catch(() => null)) ?? "";
    if (this.#closed) return;
    this.#fileChooser = {
      id: `${++this.#fileChooserSeq}`,
      page,
      chooser,
      multiple: chooser.isMultiple(),
      accept: accept.slice(0, 1024),
    };
    this.#emit("fileChooser", this.fileChooser());
  }

  #closeFileChooser(open) {
    if (this.#fileChooser !== open) return;
    this.#fileChooser = null;
    this.#emit("fileChooser", null);
  }

  /** Copy text the page's clipboard world recorded since the last call, across its frames. */
  async #takeCopiedText(cdp) {
    const tree = await cdp.send("Page.getFrameTree").catch(() => null);
    if (!tree) return "";
    const frameIds = (node) => [node.frame.id, ...(node.childFrames ?? []).flatMap(frameIds)];
    const copies = await Promise.all(
      frameIds(tree.frameTree).map((frameId) =>
        cdp
          .send("Page.createIsolatedWorld", { frameId, worldName: CLIPBOARD_WORLD })
          .then(({ executionContextId }) =>
            cdp.send("Runtime.evaluate", {
              contextId: executionContextId,
              expression: "globalThis.takeCopy?.()",
              returnByValue: true,
            }),
          )
          .then(
            ({ result }) => (typeof result.value === "string" ? result.value : ""),
            () => "",
          ),
      ),
    );
    return copies.find((text) => text.length > 0) ?? "";
  }

  // Every page presents as ordinary Chrome and records the viewer's copies, as T3's tabs do.
  // Scripts for new documents run only while this session's Page domain is on.
  async #prepare(page) {
    const cdp = await this.#control(page).catch(() => null);
    if (!cdp) return;
    await presentAsChrome(cdp).catch(noop);
    await cdp.send("Page.enable").catch(noop);
    await cdp
      .send("Page.addScriptToEvaluateOnNewDocument", {
        source: CLIPBOARD_SCRIPT,
        worldName: CLIPBOARD_WORLD,
        runImmediately: true,
      })
      .catch(noop);
  }

  async #waitFor(input) {
    if (input.timeMs !== undefined) {
      const ms = Math.min(DEFAULT_TIMEOUT_MS, Math.max(0, numberOr(input.timeMs)));
      await sleep(ms);
      return `Waited ${ms} ms.`;
    }
    const { text, ref } = input;
    if (text === undefined && ref === undefined) {
      throw new Error("Pass text, ref, or timeMs to wait for.");
    }
    const locator = ref === undefined ? null : this.#locator(ref);
    const page = this.#page();
    const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
    for (;;) {
      const hasRef = locator === null || (await locator.count()) > 0;
      const hasText =
        text === undefined ||
        (await page
          .evaluate((needle) => (document.body?.innerText ?? "").includes(needle), text)
          .catch(() => false));
      if (hasRef && hasText) return "The condition is met.";
      if (Date.now() >= deadline) {
        throw coded("timeout", `Waited ${DEFAULT_TIMEOUT_MS} ms without the condition holding.`);
      }
      await sleep(100);
    }
  }

  // Playwright refs are only valid for the snapshot that issued them. Each snapshot gets a new
  // generation, and navigation, activation or a dialog clears it, so a stale ref fails loudly.
  #locator(ref) {
    const text = String(ref ?? "");
    const match = REF_PATTERN.exec(text);
    const native =
      this.#refs && match && match[1] === this.#refs.generation
        ? this.#refs.refs.get(text)
        : undefined;
    if (native === undefined) {
      throw coded(
        "stale_ref",
        "This element ref is stale or unknown. Take a fresh browser_snapshot and use its refs.",
      );
    }
    return this.#page().locator(`aria-ref=${native}`);
  }

  async #target(locator) {
    await locator.scrollIntoViewIfNeeded({ timeout: DEFAULT_TIMEOUT_MS });
    const box = await locator.boundingBox({ timeout: DEFAULT_TIMEOUT_MS });
    if (!box) throw new Error("The element is not visible.");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  // Emits the agent cursor like T3's pointerFor: a move, then for clicks a click just after.
  async #cursor(point, phase) {
    this.#emit("pointer", {
      phase: "move",
      x: point.x,
      y: point.y,
      sequence: ++this.#pointerSequence,
    });
    await sleep(AGENT_CURSOR_MOVE_MS);
    if (phase !== "click") return;
    this.#emit("pointer", {
      phase: "click",
      x: point.x,
      y: point.y,
      sequence: ++this.#pointerSequence,
    });
    await sleep(AGENT_CURSOR_CLICK_LEAD_MS);
  }

  /**
   * A click whose handler opens a dialog does not finish until the dialog is answered, so it
   * returns once the dialog opens and the caller reports it.
   * @returns {Promise<string | null>} a message when a dialog opened, else null
   */
  async #untilDialog(page, action) {
    let onDialog = noop;
    const opened = new Promise((resolve) => {
      onDialog = () => resolve("dialog");
      page.once("dialog", onDialog);
    });
    try {
      const outcome = await Promise.race([action.then(() => "done"), opened]);
      if (outcome !== "dialog") return null;
      action.catch(noop);
      const pending = this.#dialog;
      return pending
        ? `A dialog opened: ${pending.dialog.type()} "${pending.dialog.message()}". Call browser_dialog to accept or dismiss it.`
        : "A dialog opened. Call browser_dialog to accept or dismiss it.";
    } finally {
      page.off("dialog", onDialog);
    }
  }

  async #snapshotText() {
    const page = this.#page();
    const generation = String(++this.#refGeneration);
    const refs = new Map();
    this.#refs = { generation, refs };
    const tree = await page.ariaSnapshot({ mode: "ai", timeout: DEFAULT_TIMEOUT_MS });
    const secrets = await page.evaluate(PASSWORD_VALUES).catch(() => []);
    // Refs are rewritten after masking, so a secret never reaches the tree the agent reads.
    const body = maskValues(tree, secrets).replace(/\[ref=((?:f\d+)?e\d+)\]/g, (_match, native) => {
      const ref = `${generation}-${native}`;
      refs.set(ref, native);
      return `[ref=${ref}]`;
    });
    const title = await withTimeout(page.title(), 1000, this.#title);
    const clipped =
      body.length > SNAPSHOT_TEXT_LIMIT
        ? `${body.slice(0, SNAPSHOT_TEXT_LIMIT)}\n[Snapshot truncated: ${body.length - SNAPSHOT_TEXT_LIMIT} characters omitted.]`
        : body;
    return `URL: ${page.url()}\nTitle: ${title}\n\n${clipped}`;
  }

  #statusText() {
    const nav = this.nav();
    const lines = [
      `URL: ${nav.url}`,
      `Title: ${nav.title || "(none)"}`,
      `Loading: ${nav.loading ? "yes" : "no"}`,
      `History: back ${nav.canGoBack ? "available" : "unavailable"}, forward ${nav.canGoForward ? "available" : "unavailable"}`,
      `Viewport: ${this.#viewport.width}x${this.#viewport.height}`,
    ];
    if (this.#dialog) {
      const { type, message } = dialogState(this.#dialog.dialog);
      lines.push(`Dialog: ${type} "${message}" is waiting. Call browser_dialog to answer it.`);
    }
    return lines.join("\n");
  }

  async #settledStatus() {
    await this.#refreshNav();
    return this.#statusText();
  }

  async #go(promise) {
    try {
      return await promise;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message.includes("Download is starting")) {
        throw new Error("That address is a file this browser cannot show, so it was downloaded.");
      }
      const net = /ERR_[A-Z_]+/.exec(message);
      if (net) throw new Error(`Navigation failed: ${net[0]}`);
      throw cause;
    }
  }

  close() {
    if (this.#closed) return Promise.resolve();
    this.#finish();
    return this.#context.close().catch(noop);
  }

  #finish() {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#poll);
    for (const stream of this.#screencasts) void stream.stop();
    this.#screencasts.clear();
    this.#emit("closed");
    this.#listeners.clear();
    this.#onClosed?.();
  }

  #page() {
    if (this.#closed) throw cdpUnavailable(new Error("The browser closed."));
    if (!this.#active) throw new Error("No browser page is open.");
    return this.#active;
  }

  #usable() {
    return this.#context
      .pages()
      .filter(
        (page) => !page.isClosed() && !/^(?:devtools|chrome|chrome-untrusted):/i.test(page.url()),
      );
  }

  #control(page) {
    let cdp = this.#controls.get(page);
    if (!cdp) {
      cdp = this.#context.newCDPSession(page);
      this.#controls.set(page, cdp);
      cdp.catch(() => this.#controls.delete(page));
    }
    return cdp;
  }

  #watch(page) {
    if (this.#watched.has(page)) return;
    this.#watched.add(page);
    page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT_MS);
    this.#preparing.set(page, this.#prepare(page));
    // Listening intercepts the picker; whoever drives the page answers it (T3's onFileChooser).
    page.on("filechooser", (chooser) => void this.#offerFileChooser(page, chooser));
    const mainNavigation = (request) =>
      request.isNavigationRequest() && request.frame() === page.mainFrame();
    page.on("request", (request) => {
      if (page !== this.#active || !mainNavigation(request)) return;
      this.#refs = null;
      this.#setLoading(true);
    });
    page.on("requestfailed", (request) => {
      if (page === this.#active && mainNavigation(request)) this.#setLoading(false);
    });
    page.on("load", () => {
      if (page !== this.#active) return;
      this.#setLoading(false);
      void this.#refreshNav();
    });
    // A main-frame navigation makes its page the active one, like T3's most recent navigation.
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      this.#activate(page);
      if (page !== this.#active) return;
      this.#refs = null;
      void this.#refreshNav();
    });
    page.on("dialog", (dialog) => {
      this.#dialog = { page, dialog };
      this.#emit("dialog", dialogState(dialog));
    });
    page.on("close", () => void this.#pageGone(page));
    page.on("crash", () => void this.#pageGone(page));
  }

  #setLoading(value) {
    this.#loading = value;
    this.#emitNav();
  }

  #emitNav() {
    const nav = this.nav();
    const key = JSON.stringify(nav);
    if (key === this.#lastNav) return;
    this.#lastNav = key;
    this.#emit("nav", nav);
  }

  async #refreshNav() {
    if (this.#active?.url() === "about:blank") {
      const nonBlank = this.#usable().find((p) => p.url() && p.url() !== "about:blank");
      if (nonBlank && nonBlank !== this.#active) {
        this.#activate(nonBlank);
        return;
      }
    }
    const page = this.#active;
    if (!page || this.#closed) return;
    const seq = ++this.#navSeq;
    const title = await withTimeout(page.title(), 1000, null);
    const history = await withTimeout(
      this.#control(page).then((cdp) => cdp.send("Page.getNavigationHistory")),
      1000,
      null,
    );
    if (this.#closed || seq !== this.#navSeq || page !== this.#active) return;
    if (title !== null) this.#title = title.slice(0, 512);
    if (history) {
      const count = history.entries.length;
      this.#history = {
        canGoBack: history.currentIndex > 0,
        canGoForward: history.currentIndex < count - 1,
      };
    }
    this.#emitNav();
  }

  /** Makes `page` the active page. Pages that are closed or not usable are ignored. */
  #activate(page) {
    if (this.#closed || page === this.#active || page.isClosed()) return;
    if (!this.#usable().includes(page)) return;
    const previous = this.#active;
    this.#active = page;
    this.#refs = null;
    this.#title = "";
    this.#loading = false;
    if (previous) this.#releaseHeldInput(previous);
    for (const stream of this.#screencasts) void stream.retarget(page);
    void this.#syncViewport(page);
    void this.#refreshNav();
  }

  // The context fixes the viewport, but a popup can open at its own size, so read the real CSS
  // size back from layout metrics.
  async #syncViewport(page) {
    const size = await withTimeout(
      this.#control(page).then(async (cdp) => {
        const metrics = await cdp.send("Page.getLayoutMetrics");
        const view = metrics.cssVisualViewport ?? metrics.cssLayoutViewport;
        return { width: Math.round(view.clientWidth), height: Math.round(view.clientHeight) };
      }),
      2000,
      null,
    );
    if (!size || size.width <= 0 || size.height <= 0) return;
    if (page !== this.#active) return;
    if (size.width === this.#viewport.width && size.height === this.#viewport.height) return;
    this.#viewport = { width: size.width, height: size.height };
    this.#emit("viewport", this.viewport());
  }

  async #pageGone(page) {
    if (this.#dialog?.page === page) {
      this.#dialog = null;
      this.#emit("dialog", null);
    }
    if (this.#fileChooser?.page === page) this.#closeFileChooser(this.#fileChooser);
    if (this.#closed || page !== this.#active) return;
    this.#active = null;
    this.#refs = null;
    const next = this.#usable().at(-1);
    if (next) {
      this.#activate(next);
      return;
    }
    // Keep one page, as T3 keeps a tab. The new page's event activates it.
    const fresh = await this.#context.newPage().catch(() => null);
    if (fresh && !this.#active) {
      this.#watch(fresh);
      this.#activate(fresh);
    }
  }
}

function pointOf(input, keyX = "x", keyY = "y") {
  const x = Number(input[keyX]);
  const y = Number(input[keyY]);
  if (
    input[keyX] === undefined ||
    input[keyY] === undefined ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    throw new Error(`${keyX} and ${keyY} must be numbers.`);
  }
  return { x: Math.round(x), y: Math.round(y) };
}

function requireString(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing ${name}.`);
  if (name === "text" && value.length > TEXT_LIMIT) {
    throw new Error(`Text is longer than ${TEXT_LIMIT} characters.`);
  }
  return value;
}

/**
 * One browser session per project, opened lazily on that project's headless Chrome context and
 * reopened after the context closes.
 * @param {{ contextFor: (projectId: string) => Promise<import("playwright-core").BrowserContext> }} options
 */
export function createBrowserHub({ contextFor }) {
  /** @type {Map<string, Promise<BrowserSession>>} */
  const sessions = new Map();
  /** Sessions that finished opening, for synchronous status checks. */
  const open = new Map();

  async function connect(projectId, onClosed) {
    let context;
    try {
      context = await contextFor(projectId);
    } catch (cause) {
      throw cdpUnavailable(cause);
    }
    return BrowserSession.open({ context, onClosed });
  }

  /** Closes the project's session and its context. */
  async function close(projectId) {
    const key = String(projectId);
    const current = sessions.get(key);
    sessions.delete(key);
    open.delete(key);
    if (!current) return;
    const session = await current.catch(() => null);
    await session?.close();
  }

  return {
    /**
     * Returns the project's live session, connecting first if there is none.
     * @returns {Promise<BrowserSession>}
     */
    async get(projectId) {
      const key = String(projectId);
      const current = sessions.get(key);
      if (current) {
        try {
          const session = await current;
          if (!session.closed) return session;
        } catch {
          // A failed connect is retried below.
        }
        if (sessions.get(key) === current) sessions.delete(key);
      }
      const entry = connect(projectId, () => {
        if (sessions.get(key) === entry) sessions.delete(key);
        if (open.get(key)?.closed) open.delete(key);
      });
      sessions.set(key, entry);
      try {
        const session = await entry;
        if (sessions.get(key) === entry && !session.closed) open.set(key, session);
        return session;
      } catch (cause) {
        if (sessions.get(key) === entry) sessions.delete(key);
        throw cause;
      }
    },

    /** The project's open session, without connecting. */
    peek(projectId) {
      const session = open.get(String(projectId));
      return session && !session.closed ? session : null;
    },

    close,

    async closeAll() {
      await Promise.all([...sessions.keys()].map((key) => close(key)));
    },
  };
}
