// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/server/src/preview/ServerBrowser.ts,
// apps/server/src/preview/ServerBrowserPage.ts, packages/shared/src/preview.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
//
// Browser layer for the agent computer. Chromium runs inside the Docker agent computer and
// exposes CDP on 127.0.0.1. ADE attaches with playwright-core's connectOverCDP and works on
// the context's active page: viewer frames come from one CDP screencast per viewer, human
// input goes straight to CDP Input.*, and agent tools use Playwright locators on aria refs.
// Versus T3 this is a plain module: no Effect runtime, no tab broker, no desktop attach, no
// clipboard bridge, and no anti-detection flags. The browser presents as it is.

import { chromium } from "playwright-core";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const VIEWPORT_LIMITS = { minWidth: 240, maxWidth: 3840, minHeight: 240, maxHeight: 2160 };
const CDP_CONNECT_TIMEOUT_MS = 15_000;
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
const cdpUnavailable = (cause) =>
  coded(
    "cdp_unavailable",
    `The agent computer's browser is not reachable: ${cause instanceof Error ? cause.message : String(cause)}`,
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
 * True when the URL targets this machine's loopback: localhost, *.localhost, 127.0.0.1 or [::1].
 * Those addresses resolve inside the agent computer, so they need the host port forward.
 * @param {string | URL} url
 */
export function isLoopbackUrl(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
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
  #browser;
  #context;
  #onClosed;
  #loopbackHook;
  #active = null;
  #closed = false;
  #listeners = new Map();
  #controls = new WeakMap();
  #watched = new WeakSet();
  #screencasts = new Set();
  #viewport = { ...DEFAULT_VIEWPORT };
  #resized = false;
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

  /** @private Use createBrowserHub. */
  constructor(browser, context, onClosed, loopbackHook) {
    this.#browser = browser;
    this.#context = context;
    this.#onClosed = onClosed;
    this.#loopbackHook = loopbackHook;
  }

  static async open({ browser, context, onClosed, loopbackHook }) {
    const session = new BrowserSession(browser, context, onClosed, loopbackHook);
    await session.#init();
    return session;
  }

  async #init() {
    this.#browser.on("disconnected", () => this.#finish());
    this.#context.on("page", (page) => {
      this.#watch(page);
      this.#activate(page);
    });
    for (const page of this.#context.pages()) this.#watch(page);
    let initial = this.#usable().at(-1);
    if (!initial) initial = await this.#context.newPage();
    this.#watch(initial);
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
   * Subscribes to "nav", "viewport", "pointer", "dialog" or "closed".
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
    if (!this.#resized && this.#active) void this.#syncViewport(this.#active);
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
   * Human input for the active page, applied in arrival order. Rejects if CDP fails.
   * @param {object} message protocol `mouse`, `wheel`, `key` or `text` message
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
        await cdp.send("Input.dispatchKeyEvent", params);
        const id = String(message.code || message.key || "");
        if (message.action === "up") this.#pressedKeys.delete(id);
        else this.#pressedKeys.set(id, { key: params.key, code: params.code });
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
   * Sets the CSS viewport on the active page, at RENDER_SCALE device pixels. Emits "viewport".
   * @returns {Promise<{ width: number, height: number }>}
   */
  async resize({ width, height }) {
    this.#viewport = clampViewport({ width, height });
    this.#resized = true;
    if (this.#active) await this.#applyViewport(this.#active);
    this.#emit("viewport", this.viewport());
    return this.viewport();
  }

  async #applyViewport(page) {
    const cdp = await this.#control(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: this.#viewport.width,
      height: this.#viewport.height,
      deviceScaleFactor: RENDER_SCALE,
      mobile: false,
    });
  }

  /** Navigates the active page (http and https only). */
  async navigate(url) {
    const target = normalizeBrowserUrl(url);
    await this.#beforeNavigate(target);
    await this.#go(this.#page().goto(target, { waitUntil: "commit", timeout: DEFAULT_TIMEOUT_MS }));
  }

  // The hub's hook runs before a loopback navigation, so the container's port forward exists.
  async #beforeNavigate(target) {
    if (this.#loopbackHook && isLoopbackUrl(target)) await this.#loopbackHook(new URL(target));
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
        await this.#beforeNavigate(url);
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
      default:
        throw coded("unknown_action", `Unknown browser action "${input?.action}".`);
    }
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
    return this.#browser.close().catch(noop);
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
    if (this.#resized) {
      void this.#applyViewport(page).catch(noop);
    } else {
      void this.#syncViewport(page);
    }
    void this.#refreshNav();
  }

  // Without a resize, the viewport is whatever the browser window shows (Chromium's window
  // inside the computer's display), so read the real CSS size back from layout metrics.
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
    if (page !== this.#active || this.#resized) return;
    if (size.width === this.#viewport.width && size.height === this.#viewport.height) return;
    this.#viewport = { width: size.width, height: size.height };
    this.#emit("viewport", this.viewport());
  }

  async #pageGone(page) {
    if (this.#dialog?.page === page) {
      this.#dialog = null;
      this.#emit("dialog", null);
    }
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

function requireString(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing ${name}.`);
  if (name === "text" && value.length > TEXT_LIMIT) {
    throw new Error(`Text is longer than ${TEXT_LIMIT} characters.`);
  }
  return value;
}

/**
 * Lazily attaches to each project's agent computer Chromium over CDP, and reattaches after the
 * browser disconnects or is relaunched.
 * @param {{
 *   getCdpEndpoint: (projectId: string) => Promise<string>,
 *   beforeNavigate?: (projectId: string, url: URL) => Promise<void>,
 * }} options
 *   `beforeNavigate` runs, and its errors propagate, before every navigation to a loopback
 *   host (localhost, *.localhost, 127.0.0.1, [::1]). ADE uses it to set up the container's
 *   localhost port forward. Other navigations do not call it.
 */
export function createBrowserHub({ getCdpEndpoint, beforeNavigate }) {
  /** @type {Map<string, Promise<BrowserSession>>} */
  const sessions = new Map();

  async function connect(projectId, onClosed) {
    let endpoint;
    try {
      endpoint = await getCdpEndpoint(projectId);
    } catch (cause) {
      throw cdpUnavailable(cause);
    }
    if (!endpoint) throw cdpUnavailable(new Error("no CDP endpoint"));
    let browser;
    try {
      browser = await chromium.connectOverCDP(endpoint, { timeout: CDP_CONNECT_TIMEOUT_MS });
    } catch (cause) {
      throw cdpUnavailable(cause);
    }
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close().catch(noop);
      throw cdpUnavailable(new Error("the browser has no default context"));
    }
    const loopbackHook = beforeNavigate ? (url) => beforeNavigate(projectId, url) : null;
    return BrowserSession.open({ browser, context, onClosed, loopbackHook });
  }

  /** Drops the project's session. The computer's browser keeps running. */
  async function close(projectId) {
    const key = String(projectId);
    const current = sessions.get(key);
    sessions.delete(key);
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
      });
      sessions.set(key, entry);
      try {
        return await entry;
      } catch (cause) {
        if (sessions.get(key) === entry) sessions.delete(key);
        throw cause;
      }
    },

    close,

    async closeAll() {
      await Promise.all([...sessions.keys()].map((key) => close(key)));
    },
  };
}
