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
import { readFile } from "node:fs/promises";
import { inspectElementAt } from "./browser-inspection.mjs";
import { recordingKeyLabel, recordingKeysAreSensitive } from "./browser-recording-input.mjs";
import { createBrowserDownloads } from "./browser-downloads.mjs";
import { captureBrowserFavicon } from "./browser-favicon.mjs";
import { browserAudioAvailable, tabAudioState } from "./browser-audio.mjs";

// react-grab 0.1.32, bundled for injection into the inspected page (see THIRD_PARTY_NOTICES.md).
const reactGrabSource = readFile(
  new URL("./browser-react-grab.bundle.js", import.meta.url),
  "utf8",
);
const reactGrabInstalling = new WeakMap();

// A touch tap only opens the on-screen keyboard when the page element under it takes text.
// From T3's ServerBrowser.ts EDITABLE_AT_POINT_SCRIPT; open shadow roots are included.
const EDITABLE_AT_POINT_SCRIPT = `(x, y) => {
  let element = document.elementFromPoint(x, y);
  while (element && element.shadowRoot) {
    const inner = element.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === element) break;
    element = inner;
  }
  if (element && element.tagName === "LABEL" && element.control) element = element.control;
  if (!element) return false;
  if (element.tagName === "IFRAME" || element.tagName === "FRAME") return true;
  if (element.isContentEditable) return true;
  if (element.tagName === "TEXTAREA") return !element.disabled && !element.readOnly;
  if (element.tagName !== "INPUT") return false;
  const nonText = ["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"];
  return !nonText.includes(element.type) && !element.disabled && !element.readOnly;
}`;

async function reactContextAt(page, point) {
  try {
    if (!(await page.evaluate(() => typeof globalThis.__adeReactGrab === "function"))) {
      let installing = reactGrabInstalling.get(page);
      if (!installing) {
        installing = reactGrabSource.then(async (content) => {
          const cdp = await page.context().newCDPSession(page);
          try {
            const result = await cdp.send("Runtime.evaluate", {
              expression: content,
              allowUnsafeEvalBlockedByCSP: true,
            });
            if (result.exceptionDetails) throw new Error("Could not load React inspection.");
          } finally {
            await cdp.detach().catch(noop);
          }
        });
        reactGrabInstalling.set(page, installing);
      }
      try {
        await installing;
      } finally {
        if (reactGrabInstalling.get(page) === installing) reactGrabInstalling.delete(page);
      }
    }
    return await page.evaluate(async ({ x, y }) => {
      let element = document.elementFromPoint(x, y);
      while (element?.shadowRoot) {
        const inner = element.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === element) break;
        element = inner;
      }
      if (!element || typeof globalThis.__adeReactGrab !== "function") return null;
      const context = await Promise.race([
        Promise.resolve(globalThis.__adeReactGrab(element)),
        new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      if (!context) return null;
      const stack = (context.stack ?? []).slice(0, 40).map((frame) => ({
        functionName: frame.functionName ?? null,
        fileName: frame.fileName ?? null,
        lineNumber: frame.lineNumber ?? null,
        columnNumber: frame.columnNumber ?? null,
      }));
      return { componentName: context.componentName ?? null, stack };
    }, point);
  } catch {
    // Source metadata is optional; CSP and production builds may prevent inspection.
    return null;
  }
}

import { presentAsChrome } from "./browser-contexts.mjs";
import {
  BROWSER_RENDER_SCALE,
  DEFAULT_VIEWPORT,
  MAX_INPUT_TEXT_CHARS,
} from "../shared/browser-contract.mjs";
import {
  clampViewport,
  coded,
  editingCommand,
  keyEventParams,
  modifiersOf,
  mouseEventParams,
  normalizeBrowserUrl,
  numberOr,
  wheelEventParams,
  xdotoolChords,
} from "./browser-protocol.mjs";

export {
  clampViewport,
  editingCommand,
  keyEventParams,
  modifiersOf,
  mouseEventParams,
  normalizeBrowserUrl,
  wheelEventParams,
  xdotoolChords,
} from "./browser-protocol.mjs";

const DEFAULT_TIMEOUT_MS = 15_000;
// Frames and input render at 2x like T3's RENDER_SCALE, so text stays sharp in the viewer.
const RENDER_SCALE = BROWSER_RENDER_SCALE;
// Chromium allows three unacked frames, so 100 ms pacing caps viewers near 30 fps.
const SCREENCAST_ACK_PACE_MS = 100;
const SCREENCAST_SETTLE_MS = 200;
const SCREENCAST_MOTION_FRAMES = 4;
const SCREENCAST_MOTION_WINDOW_MS = 300;
const SCREENCAST_MOTION_QUALITY = 50;
const AGENT_CURSOR_MOVE_MS = 160;
const AGENT_CURSOR_CLICK_LEAD_MS = 40;
const NAV_POLL_MS = 1_000;
const SNAPSHOT_TEXT_LIMIT = 20_000;
const DIALOG_TEXT_LIMIT = 4_000;
const MASK = "••••••••";
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
   * @param {{ maxWidth: number, maxHeight: number, quality: number, ackPaceMs?: number }} params
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
    const context = typeof page.context === "function" ? page.context() : this.#host.context();
    const session = await context.newCDPSession(page);
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
      !this.#params.ackPaceMs &&
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
        arrivedAt + (this.#params.ackPaceMs ?? SCREENCAST_ACK_PACE_MS) - Date.now(),
      );
    };
    this.#onFrame(Buffer.from(frame.data, "base64"), ack);
  }
}

class BrowserSession {
  #context;
  #onClosed;
  #ownership;
  #owned = new Set();
  #contexts = new Map();
  #acquiringProfiles = new Map();
  #pageProfiles = new WeakMap();
  #initialProfile;
  #acquireProfile;
  #defaultProfile;
  #validProfile;
  #closePromise;
  #active = null;
  #closed = false;
  #listeners = new Map();
  #controls = new WeakMap();
  #watched = new WeakSet();
  /** Each watched page's preparation; navigations wait for it. */
  #preparing = new WeakMap();
  #screencasts = new Set();
  #pinnedScreencasts = new Set();
  #devtoolsSessions = new Set();
  #recordingKeyPages = new Map();
  #viewport = { ...DEFAULT_VIEWPORT };
  #pageViewports = new WeakMap();
  #tabSettings = new WeakMap();
  #annotationStyles = new Map();
  #tabIds = new WeakMap();
  #tabTitles = new WeakMap();
  #tabFavicons = new WeakMap();
  #faviconGenerations = new WeakMap();
  #restoreUrls = new WeakMap();
  #navigationErrors = new WeakMap();
  #navigationRequests = new WeakMap();
  #failedTransitions = new WeakMap();
  #fileNotShown = new WeakMap();
  /** The tab whose first page this browser session just opened, until a viewer is shown it. */
  #openedPage = null;
  #audioStates = new WeakMap();
  #audioGenerations = new WeakMap();
  #audioRefreshes = new WeakSet();
  #tabSequence = 0;
  #selectedBlank = null;
  #creatingTab = false;
  #lastWheelAt = 0;
  #inputChain = Promise.resolve();
  #pressedKeys = new Map();
  #pressedButtons = new Map();
  #stopCounts = new WeakMap();
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
  #downloads = createBrowserDownloads((downloads) => this.#emit("downloads", downloads));

  /** @private Use createBrowserHub. */
  constructor(
    context,
    onClosed,
    ownership,
    profileId,
    acquireProfile,
    defaultProfile,
    validProfile,
  ) {
    this.#context = context;
    this.#onClosed = onClosed;
    this.#ownership = ownership;
    this.#initialProfile = profileId ?? "default";
    this.#acquireProfile = acquireProfile;
    this.#defaultProfile = defaultProfile ?? (() => this.#initialProfile);
    this.#validProfile = validProfile ?? ((profile) => profile === this.#initialProfile);
  }

  static async open({
    context,
    onClosed,
    ownership,
    releaseContext,
    profileId,
    acquireProfile,
    defaultProfile,
    validProfile,
  }) {
    const session = new BrowserSession(
      context,
      onClosed,
      ownership,
      profileId,
      acquireProfile,
      defaultProfile,
      validProfile,
    );
    try {
      await session.#init(releaseContext);
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  }

  async #registerContext(profileId, context, release) {
    const entry = { context, release, initialPage: null, onClose: null, onPage: null };
    this.#contexts.set(profileId, entry);
    if (this.#ownership && !this.#ownership.contexts.has(context)) {
      this.#ownership.contexts.add(context);
      const initial = context.pages().find((page) => !this.#ownership.owners.has(page));
      if (initial && this.#claim(initial, profileId)) entry.initialPage = initial;
    }
    entry.onClose = () => void this.close();
    context.on("close", entry.onClose);
    // Pages may write the clipboard as they would in a normal tab, as T3 grants.
    await context.grantPermissions(["clipboard-write"]).catch(noop);
    if (this.#closed) throw new Error("The browser closed.");
    entry.onPage = (page) => {
      if (!this.#ownership) {
        this.#claim(page, profileId);
        if (this.#creatingTab) this.#selectedBlank = page;
        this.#activate(page);
        return;
      }
      // A page opened by page script belongs to its opener's conversation. Pages explicitly
      // created by ADE are claimed by the caller of #newPage instead.
      void page
        .opener()
        .then((opener) => {
          if (this.#closed || !opener || this.#ownership.owners.get(opener) !== this) return;
          if (!this.#claim(page, profileId)) return;
          this.#activate(page);
          this.#emitTabs();
        })
        .catch(noop);
    };
    context.on("page", entry.onPage);
    return entry;
  }

  async #entryFor(profileId) {
    // Registration includes asynchronous permission setup. Concurrent tab creation must wait
    // for that setup rather than observing the partially registered context.
    const pending = this.#acquiringProfiles.get(profileId);
    if (pending) return pending;
    const existing = this.#contexts.get(profileId);
    if (existing) return existing;
    if (!this.#acquireProfile || !this.#validProfile(profileId))
      throw new Error("Browser profile not found.");
    const work = (async () => {
      const lease = await this.#acquireProfile(profileId);
      if (this.#closed) {
        await lease.release();
        throw new Error("The browser closed.");
      }
      return this.#registerContext(profileId, lease.context, lease.release);
    })();
    this.#acquiringProfiles.set(profileId, work);
    try {
      return await work;
    } finally {
      if (this.#acquiringProfiles.get(profileId) === work)
        this.#acquiringProfiles.delete(profileId);
    }
  }

  async #init(releaseContext) {
    const entry = await this.#registerContext(this.#initialProfile, this.#context, releaseContext);
    if (!this.#ownership) {
      for (const page of this.#context.pages()) this.#claim(page, this.#initialProfile);
    }
    const usable = this.#usable();
    let initial = usable.find((p) => p.url() && p.url() !== "about:blank") ?? usable.at(-1);
    if (initial === entry.initialPage) entry.initialPage = null;
    if (!initial) initial = await this.#newPage(this.#initialProfile);
    this.#watch(initial);
    // The first page presents as Chrome before anything navigates it.
    await this.#preparing.get(initial);
    this.#activate(initial);
    this.#poll = setInterval(() => {
      if (!this.#dialog) void this.#refreshNav();
      for (const page of this.#usable()) void this.#refreshAudio(page);
    }, NAV_POLL_MS);
    this.#poll.unref?.();
  }

  get closed() {
    return this.#closed;
  }

  /** How many viewers are streaming this session's screen. */
  get viewerCount() {
    return this.#screencasts.size + this.#devtoolsSessions.size;
  }

  /** Current navigation state. canGoBack and canGoForward are cached from CDP history. */
  nav() {
    return {
      url: this.#active
        ? (this.#restoreUrls.get(this.#active) ?? this.#active.url())
        : "about:blank",
      title: this.#title,
      loading: this.#loading,
      canGoBack: this.#history.canGoBack,
      canGoForward: this.#history.canGoForward,
      error: this.#active ? (this.#navigationErrors.get(this.#active) ?? null) : null,
      fileNotShown: this.#active ? (this.#fileNotShown.get(this.#active) ?? null) : null,
      // True while this tab is showing the first page opened in it, so a hidden preview can
      // surface the browser the agent just opened. Cleared by the next navigation on the tab.
      opened: this.#active !== null && this.#openedPage === this.#active,
    };
  }

  viewport(tabId) {
    if (tabId) {
      const page = this.#tabPage(tabId);
      if (page !== this.#active)
        return this.#pageViewports.get(page) ?? page.viewportSize() ?? { ...this.#viewport };
    }
    return { ...this.#viewport };
  }

  #tabId(page) {
    let id = this.#tabIds.get(page);
    if (!id) {
      id = `tab-${++this.#tabSequence}`;
      this.#tabIds.set(page, id);
    }
    return id;
  }

  #tabPage(id) {
    if (!id) return this.#page();
    const page = this.#usable().find((candidate) => this.#tabId(candidate) === id);
    if (!page) throw new Error("That browser tab is no longer open.");
    return page;
  }

  tabs() {
    return {
      activeId: this.#active ? this.#tabId(this.#active) : null,
      tabs: this.#usable().map((page) => ({
        id: this.#tabId(page),
        url: this.#restoreUrls.get(page) ?? page.url(),
        title: this.#tabTitles.get(page) ?? "",
        ...(this.#tabFavicons.has(page) ? { favicon: this.#tabFavicons.get(page) } : {}),
        ...(this.#audioStates.has(page) ? { audio: this.#audioStates.get(page) } : {}),
        ...(this.#ownership
          ? { profileId: this.#pageProfiles.get(page) ?? this.#initialProfile }
          : {}),
      })),
    };
  }

  activeProfile() {
    return this.#active
      ? (this.#pageProfiles.get(this.#active) ?? this.#initialProfile)
      : this.#initialProfile;
  }

  profileForTab(tabId) {
    const page = this.#tabPage(tabId);
    return this.#pageProfiles.get(page) ?? this.#initialProfile;
  }

  downloads() {
    return this.#downloads.list();
  }

  openDownload(id) {
    return this.#downloads.get(id);
  }

  hasProfile(profileId) {
    // A profile can still hold a context lease after its last tab closes.
    return this.#contexts.has(profileId) || this.#acquiringProfiles.has(profileId);
  }

  /** Reopen a conversation's saved tabs before the first viewer or agent action attaches. */
  async restoreTabs(snapshot) {
    if (!snapshot?.tabs?.length) return;
    const initial = this.#page();
    await Promise.all(
      this.#usable()
        .filter((page) => page !== initial)
        .map((page) => page.close().catch(noop)),
    );
    this.#tabSequence = Math.max(
      this.#tabSequence,
      ...snapshot.tabs.map((tab) => Number(tab.id.slice(4)) || 0),
    );
    const navigations = [];
    for (const [index, tab] of snapshot.tabs.entries()) {
      if (this.#closed) return;
      const profile =
        typeof tab.profileId === "string" && this.#validProfile(tab.profileId)
          ? tab.profileId
          : this.#validProfile("default")
            ? "default"
            : this.#initialProfile;
      if (index > 0) await this.newTab(profile);
      else if (profile !== this.activeProfile()) {
        await this.newTab(profile);
        await initial.close().catch(noop);
      }
      const page = this.#page();
      this.#tabIds.set(page, tab.id);
      this.#selectedBlank = page;
      if (tab.url !== "about:blank") {
        navigations.push(
          (async () => {
            try {
              const target = normalizeBrowserUrl(tab.url);
              await this.#preparing.get(page);
              await page.goto(target, { waitUntil: "commit", timeout: 4000 });
              if (this.#selectedBlank === page) this.#selectedBlank = null;
            } catch {
              this.#restoreUrls.set(page, tab.url);
            }
          })(),
        );
      }
    }
    await Promise.all(navigations);
    const selected = snapshot.tabs.find((tab) => tab.id === snapshot.activeId);
    if (selected) await this.selectTab(selected.id);
    this.#emitTabs();
  }

  #emitTabs() {
    this.#emit("tabs", this.tabs());
  }

  async newTab(profileId = this.#defaultProfile()) {
    this.#creatingTab = true;
    try {
      const page = await this.#newPage(profileId);
      this.#watch(page);
      this.#selectedBlank = page;
      this.#activate(page);
      this.#emitTabs();
    } finally {
      this.#creatingTab = false;
    }
  }

  async selectTab(id) {
    const page = this.#usable().find((candidate) => this.#tabId(candidate) === id);
    if (!page) throw new Error("That browser tab is no longer open.");
    this.#selectedBlank = page.url() === "about:blank" ? page : null;
    this.#activate(page);
    this.#emitTabs();
  }

  async closeTab(id) {
    const page = this.#usable().find((candidate) => this.#tabId(candidate) === id);
    if (!page) throw new Error("That browser tab is no longer open.");
    if (this.#selectedBlank === page) this.#selectedBlank = null;
    await page.close();
    this.#emitTabs();
  }

  /** Set actual Chromium tab mute, publishing only state confirmed by Chrome. */
  async setTabAudio(id, muted) {
    const page = this.#tabPage(id);
    const generation = (this.#audioGenerations.get(page) ?? 0) + 1;
    this.#audioGenerations.set(page, generation);
    const state = await tabAudioState(this.#contextOf(page), await this.#control(page), muted);
    if (!state) throw new Error("Tab audio control is unavailable in this browser.");
    if (this.#closed || page.isClosed() || this.#audioGenerations.get(page) !== generation) return;
    this.#audioStates.set(page, state);
    this.#emitTabs();
  }

  /** Describes the real element at a viewport point without changing browser control. */
  async inspectElement(x, y, tabId, includeContext = true) {
    const page = this.#tabPage(tabId);
    const element = await page.evaluate(inspectElementAt, { x, y });
    if (!element || !includeContext) return element;
    const context = await reactContextAt(page, { x, y });
    if (!context) return element;
    const source = context.stack.find((frame) => frame.fileName) ?? element.source;
    return {
      ...element,
      componentName: context.componentName ?? element.componentName,
      source,
      stack: context.stack,
    };
  }

  async inspectRegion(rect, tabId) {
    const page = this.#tabPage(tabId);
    const candidates = await page.evaluate(inspectElementAt, { region: rect });
    const elements = await Promise.all(
      candidates.map(async ({ element, center }) => {
        // React Grab inspects the topmost element at a point. Keep the actual selected
        // candidate when another overlapping element covers its center.
        const top = await page.evaluate(inspectElementAt, center);
        if (top?.selector !== element.selector) return element;
        const context = await reactContextAt(page, center);
        if (!context) return element;
        return {
          ...element,
          componentName: context.componentName ?? element.componentName,
          source: context.stack.find((frame) => frame.fileName) ?? element.source,
          stack: context.stack,
        };
      }),
    );
    return elements.filter(
      (element, index) =>
        element &&
        elements.findIndex((candidate) => candidate?.selector === element.selector) === index,
    );
  }

  /** Remeasure selected elements after scrolling or page layout changes. */
  async annotationRects(selectors, tabId) {
    const page = this.#tabPage(tabId);
    return Promise.all(
      selectors.map(async (selector) => {
        let handle;
        try {
          handle = await page.$(selector);
          if (!handle) return null;
          return await handle.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            if (
              !rect.width ||
              !rect.height ||
              style.visibility === "hidden" ||
              style.display === "none"
            )
              return null;
            let left = Math.max(0, rect.left);
            let top = Math.max(0, rect.top);
            let right = Math.min(document.documentElement.clientWidth, rect.right);
            let bottom = Math.min(document.documentElement.clientHeight, rect.bottom);
            const parent = (node) => {
              if (node.parentElement) return node.parentElement;
              const root = node.getRootNode();
              return root instanceof ShadowRoot ? root.host : null;
            };
            if (style.position !== "fixed") {
              for (let ancestor = parent(element); ancestor; ancestor = parent(ancestor)) {
                if (ancestor === document.body || ancestor === document.documentElement) break;
                const ancestorStyle = getComputedStyle(ancestor);
                const bounds = ancestor.getBoundingClientRect();
                if (ancestorStyle.overflowX !== "visible") {
                  left = Math.max(left, bounds.left + ancestor.clientLeft);
                  right = Math.min(right, bounds.left + ancestor.clientLeft + ancestor.clientWidth);
                }
                if (ancestorStyle.overflowY !== "visible") {
                  top = Math.max(top, bounds.top + ancestor.clientTop);
                  bottom = Math.min(
                    bottom,
                    bounds.top + ancestor.clientTop + ancestor.clientHeight,
                  );
                }
              }
            }
            return right > left && bottom > top
              ? { x: left, y: top, width: right - left, height: bottom - top }
              : null;
          });
        } catch {
          return null;
        } finally {
          await handle?.dispose().catch(noop);
        }
      }),
    );
  }

  /** Capture the page directly at device resolution instead of re-encoding a streamed JPEG. */
  async captureScreenshot(tabId) {
    return this.#tabPage(tabId).screenshot({
      type: "png",
      scale: "device",
      timeout: DEFAULT_TIMEOUT_MS,
    });
  }

  /** Import cookies into this conversation's selected shared profile. */
  async importCookies(cookies, tabId) {
    let imported = 0;
    let skipped = 0;
    const cdp = await this.#control(this.#tabPage(tabId));
    // Playwright's addCookies rewrites URL cookies and disallows an explicit path. CDP lets
    // host-only cookies keep both their original path and their host-only scope.
    for (let offset = 0; offset < cookies.length; offset += 16) {
      const outcomes = await Promise.all(
        cookies.slice(offset, offset + 16).map(async (cookie) => {
          try {
            return (await cdp.send("Network.setCookie", cookie)).success === true;
          } catch {
            return false;
          }
        }),
      );
      imported += outcomes.filter(Boolean).length;
      skipped += outcomes.filter((ok) => !ok).length;
    }
    return { imported, skipped };
  }

  async openDevtools(tabId) {
    const page = this.#tabPage(tabId);
    const session = await this.#contextOf(page).newCDPSession(page);
    this.#devtoolsSessions.add(session);
    session.once("close", () => this.#devtoolsSessions.delete(session));
    return {
      session,
      close: async () => {
        this.#devtoolsSessions.delete(session);
        await session.detach().catch(noop);
      },
    };
  }

  /** Temporarily preview a style change and remember the original inline value for restoration. */
  async setAnnotationStyle(sessionId, selector, property, value, tabId) {
    const page = this.#tabPage(tabId);
    let entries = this.#annotationStyles.get(sessionId);
    if (!entries) this.#annotationStyles.set(sessionId, (entries = new Map()));
    const key = `${selector}\0${property}`;
    let entry = entries.get(key);
    if (!entry) {
      const handle = await page.$(selector);
      if (!handle) throw new Error("The selected element is no longer on the page.");
      try {
        const baseline = await handle.evaluate(
          (element, name) => ({
            value: element.style.getPropertyValue(name),
            priority: element.style.getPropertyPriority(name),
            computed: getComputedStyle(element).getPropertyValue(name).trim(),
          }),
          property,
        );
        entry = { handle, selector, property, ...baseline };
        entries.set(key, entry);
      } catch (error) {
        await handle.dispose().catch(noop);
        throw error;
      }
    }
    const result = await entry.handle.evaluate(
      (element, input) => {
        if (!CSS.supports(input.property, input.value))
          throw new Error("That style value is not valid.");
        element.style.setProperty(input.property, input.value, "important");
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      },
      { property, value },
    );
    return { selector, property, value, previousValue: entry.computed, rect: result };
  }

  async restoreAnnotationStyles(sessionId, selector) {
    const entries = this.#annotationStyles.get(sessionId);
    if (!entries) return;
    for (const [key, entry] of entries) {
      if (selector && selector !== entry.selector) continue;
      entries.delete(key);
      await entry.handle
        .evaluate(
          (element, baseline) => {
            if (baseline.value)
              element.style.setProperty(baseline.property, baseline.value, baseline.priority);
            else element.style.removeProperty(baseline.property);
          },
          { property: entry.property, value: entry.value, priority: entry.priority },
        )
        .catch(noop);
      await entry.handle.dispose().catch(noop);
    }
    if (!entries.size) this.#annotationStyles.delete(sessionId);
  }

  #settingsFor(page) {
    let settings = this.#tabSettings.get(page);
    if (!settings) {
      settings = { viewport: { ...DEFAULT_VIEWPORT }, zoomFactor: 1, colorScheme: "system" };
      this.#tabSettings.set(page, settings);
    }
    return settings;
  }

  browserSettings(tabId) {
    const settings = this.#settingsFor(this.#tabPage(tabId));
    return {
      viewport: { ...settings.viewport },
      zoomFactor: settings.zoomFactor,
      colorScheme: settings.colorScheme,
    };
  }

  /** Applies the same viewport, color scheme and zoom controls as T3's server browser. */
  async adjustBrowser(input) {
    const page = this.#tabPage(input.tabId);
    const settings = this.#settingsFor(page);
    if (input.viewport)
      settings.viewport = {
        width: Math.round(input.viewport.width),
        height: Math.round(input.viewport.height),
      };
    if (input.zoomFactor !== undefined) settings.zoomFactor = input.zoomFactor;
    if (input.colorScheme !== undefined) settings.colorScheme = input.colorScheme;
    if (input.viewport || input.zoomFactor !== undefined) await this.#applyBrowserViewport(page);
    if (input.colorScheme !== undefined)
      await page.emulateMedia({
        colorScheme: input.colorScheme === "system" ? null : input.colorScheme,
      });
    if (input.clear === "cookies") await this.#contextOf(page).clearCookies();
    if (input.clear === "cache")
      await (await this.#control(page)).send("Network.clearBrowserCache");
    return this.browserSettings(input.tabId);
  }

  /** Fits the page to a viewer's pane in "fill" mode, keeping this tab's other settings. */
  async resize(width, height) {
    const page = this.#active;
    if (!page) return;
    const next = {
      width: Math.round(Number(width)),
      height: Math.round(Number(height)),
    };
    if (!(next.width > 0 && next.height > 0)) return;
    const settings = this.#settingsFor(page);
    if (settings.viewport.width === next.width && settings.viewport.height === next.height) return;
    settings.viewport = next;
    await this.#applyBrowserViewport(page);
  }

  async #applyBrowserViewport(page) {
    const { viewport: size, zoomFactor } = this.#settingsFor(page);
    await page.setViewportSize(size);
    const cdp = await this.#control(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: Math.max(1, Math.round(size.width / zoomFactor)),
      height: Math.max(1, Math.round(size.height / zoomFactor)),
      deviceScaleFactor: RENDER_SCALE * zoomFactor,
      mobile: false,
    });
    await this.#syncViewport(page);
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
    const target = options.tabId
      ? this.#usable().find((page) => this.#tabId(page) === options.tabId)
      : this.#active;
    if (!target) throw new Error("The recorded browser tab is no longer open.");
    const params = {
      maxWidth: Math.max(1, Math.round(numberOr(options.maxWidth, DEFAULT_VIEWPORT.width))),
      maxHeight: Math.max(1, Math.round(numberOr(options.maxHeight, DEFAULT_VIEWPORT.height))),
      quality: Math.min(100, Math.max(1, Math.round(numberOr(options.quality, 70)))),
      ...(Number.isFinite(options.ackPaceMs)
        ? { ackPaceMs: Math.max(1000 / 60, Math.min(100, options.ackPaceMs)) }
        : {}),
    };
    // A viewer attaching re-reads the real viewport, so its first frame matches the mapping.
    if (this.#active) void this.#syncViewport(this.#active);
    const stream = new Screencast(
      { context: () => this.#context, lastWheelAt: () => this.#lastWheelAt },
      params,
      onFrame,
    );
    this.#screencasts.add(stream);
    if (options.tabId) this.#pinnedScreencasts.add(stream);
    if (options.showRecordingKeys)
      this.#recordingKeyPages.set(target, (this.#recordingKeyPages.get(target) ?? 0) + 1);
    let releasedKeys = false;
    const releaseKeys = () => {
      if (releasedKeys || !options.showRecordingKeys) return;
      releasedKeys = true;
      const count = this.#recordingKeyPages.get(target) ?? 0;
      if (count <= 1) this.#recordingKeyPages.delete(target);
      else this.#recordingKeyPages.set(target, count - 1);
    };
    try {
      await stream.start(target);
    } catch (cause) {
      releaseKeys();
      this.#screencasts.delete(stream);
      this.#pinnedScreencasts.delete(stream);
      throw cdpUnavailable(cause);
    }
    return async () => {
      releaseKeys();
      this.#screencasts.delete(stream);
      this.#pinnedScreencasts.delete(stream);
      await stream.stop();
    };
  }

  /**
   * Human input for the active page, applied in arrival order. Rejects if CDP fails. A copy or
   * cut key resolves with the text it copied, for the viewer's own clipboard.
   * @param {object} message protocol `mouse`, `wheel`, `key`, `text` or `probe` message
   * @returns {Promise<{ copied?: string, probe?: { x: number, y: number, editable: boolean } } | undefined>}
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
        if (message.action === "down") await this.#recordKey(page, message.key, message.modifiers);
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
          await cdp.send("Input.insertText", {
            text: message.text.slice(0, MAX_INPUT_TEXT_CHARS),
          });
        }
        return;
      case "probe": {
        const x = Number(message.x);
        const y = Number(message.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        // A page dialog blocks script, so a probe that cannot answer is reported as "not editable".
        const { result } = await cdp
          .send("Runtime.evaluate", {
            expression: `(${EDITABLE_AT_POINT_SCRIPT})(${x}, ${y})`,
            returnByValue: true,
          })
          .catch(() => ({ result: undefined }));
        return { probe: { x, y, editable: result?.value === true } };
      }
    }
  }

  /**
   * Releases keys and buttons the viewer left held on the active page, as T3 does on hand-back.
   */
  async releaseInput() {
    if (this.#active) await this.#releaseHeldInput(this.#active);
  }

  async #releaseHeldInput(page) {
    const keys = [...this.#pressedKeys.values()];
    const buttons = [...this.#pressedButtons];
    this.#pressedKeys.clear();
    this.#pressedButtons.clear();
    if (keys.length === 0 && buttons.length === 0) return;
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
  }

  /** Navigates the active page (http and https only). */
  async navigate(url) {
    const target = normalizeBrowserUrl(url);
    const page = this.#page();
    await this.#preparing.get(page);
    // A failed Chromium navigation rejects before its internal error document commits.
    // Starting a retry during that transition lets the old error document cancel the retry.
    await this.#failedTransitions.get(page);
    // A tab still on about:blank is opening its first page; later pages replace a real one.
    const first = !page.url() || page.url() === "about:blank";
    if (!first && this.#openedPage === page) this.#openedPage = null;
    try {
      await this.#go(page.goto(target, { waitUntil: "commit", timeout: DEFAULT_TIMEOUT_MS }));
      if (first) this.#openedPage = page;
      this.#emitNav();
    } catch (error) {
      this.#restoreUrls.set(page, target);
      this.#emitNav();
      throw error;
    }
  }

  /** @param {-1 | 1} delta */
  async history(delta) {
    const page = this.#page();
    const options = { waitUntil: "commit", timeout: DEFAULT_TIMEOUT_MS };
    await this.#go(delta < 0 ? page.goBack(options) : page.goForward(options));
  }

  async reload({ ignoreCache } = {}) {
    const page = this.#page();
    const failedUrl = this.#navigationErrors.get(page)?.url;
    if (failedUrl) return this.navigate(failedUrl);
    if (ignoreCache === true) {
      const cdp = await this.#control(page);
      await cdp.send("Page.reload", { ignoreCache: true });
      return;
    }
    await this.#go(page.reload({ waitUntil: "commit", timeout: DEFAULT_TIMEOUT_MS }));
  }

  async stopLoading() {
    const page = this.#page();
    this.#stopCounts.set(page, (this.#stopCounts.get(page) ?? 0) + 1);
    const cdp = await this.#control(page);
    await cdp.send("Page.stopLoading");
    this.#setLoading(false);
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
        await this.navigate(url);
        await page.waitForLoadState("load", { timeout: 5000 }).catch(noop);
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
        await this.reload();
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
        await this.#recordKey(page, key);
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
      case "type": {
        const text = requireString(input.text, "text");
        if (this.#recordingKeyPages.has(page)) {
          for (const character of text) {
            await this.#recordKey(page, character);
            await page.keyboard.type(character);
          }
        } else await page.keyboard.type(text);
        break;
      }
      case "key":
        for (const chord of xdotoolChords(input.keys)) {
          await this.#recordKey(page, chord);
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

  /** The JavaScript dialog currently blocking the page, if any. */
  pendingDialog() {
    return this.#dialog ? dialogState(this.#dialog.dialog) : null;
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
    const tabId = this.#active ? this.#tabId(this.#active) : null;
    this.#emit("pointer", {
      phase: "move",
      tabId,
      x: point.x,
      y: point.y,
      sequence: ++this.#pointerSequence,
    });
    await sleep(AGENT_CURSOR_MOVE_MS);
    if (phase !== "click") return;
    this.#emit("pointer", {
      phase: "click",
      tabId,
      x: point.x,
      y: point.y,
      sequence: ++this.#pointerSequence,
    });
    await sleep(AGENT_CURSOR_CLICK_LEAD_MS);
  }

  async #recordKey(page, key, modifiers = 0) {
    if (!this.#recordingKeyPages.has(page)) return;
    const sensitive = await withTimeout(page.evaluate(recordingKeysAreSensitive), 300, true);
    const label = sensitive ? null : recordingKeyLabel(key, modifiers);
    this.#emit("recording-key", { tabId: this.#tabId(page), label });
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
    const activeId = this.#active ? this.#tabId(this.#active) : null;
    const downloads = this.#downloads.list().filter((item) => item.tabId === activeId);
    if (downloads.length) {
      lines.push("Downloads:");
      for (const item of downloads) {
        const saved = this.#downloads.get(item.id);
        if (saved)
          lines.push(`- ${JSON.stringify(item.fileName)} (${item.sizeBytes} bytes): ${saved.path}`);
      }
    }
    return lines.join("\n");
  }

  async #settledStatus() {
    await this.#refreshNav();
    return this.#statusText();
  }

  async #go(promise) {
    const page = this.#active;
    const stopCount = page ? (this.#stopCounts.get(page) ?? 0) : 0;
    try {
      return await promise;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (
        page &&
        /ERR_ABORTED|Navigation.*interrupted/i.test(message) &&
        (this.#stopCounts.get(page) ?? 0) > stopCount
      )
        return null;
      if (message.includes("Download is starting")) {
        throw new Error(
          "That address is a file this browser cannot show, so it was downloaded. Call browser_status to find the saved file.",
        );
      }
      const net = /ERR_[A-Z_]+/.exec(message);
      if (net) throw new Error(`Navigation failed: ${net[0]}`);
      throw cause;
    }
  }

  async close() {
    if (this.#closePromise) return this.#closePromise;
    // Publish the promise before emitting "closed": a listener may synchronously call close.
    this.#closePromise = Promise.resolve().then(async () => {
      await Promise.allSettled([...this.#acquiringProfiles.values()]);
      if (this.#ownership)
        await Promise.all([...this.#owned].map((page) => page.close().catch(noop)));
      this.#owned.clear();
      await Promise.all(
        [...this.#contexts.values()].map((entry) =>
          entry.release ? entry.release().catch(noop) : entry.context.close().catch(noop),
        ),
      );
      await this.#downloads.close();
      this.#contexts.clear();
    });
    this.#finish();
    return this.#closePromise;
  }

  #finish() {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#poll);
    for (const entry of this.#contexts.values()) {
      if (entry.onPage) entry.context.off("page", entry.onPage);
      if (entry.onClose) entry.context.off("close", entry.onClose);
    }
    for (const stream of this.#screencasts) void stream.stop();
    for (const session of this.#devtoolsSessions) void session.detach().catch(noop);
    this.#devtoolsSessions.clear();
    this.#screencasts.clear();
    this.#pinnedScreencasts.clear();
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
    return (this.#ownership ? [...this.#owned] : this.#context.pages()).filter(
      (page) => !page.isClosed() && !/^(?:devtools|chrome|chrome-untrusted):/i.test(page.url()),
    );
  }

  #claim(page, profileId = this.#initialProfile) {
    if (this.#ownership) {
      const owner = this.#ownership.owners.get(page);
      if (owner && owner !== this) return false;
      this.#ownership.owners.set(page, this);
      this.#owned.add(page);
    }
    this.#pageProfiles.set(page, profileId);
    this.#watch(page);
    return true;
  }

  async #newPage(profileId = this.#defaultProfile()) {
    const entry = await this.#entryFor(profileId);
    const existing = entry.initialPage;
    entry.initialPage = null;
    if (existing && !existing.isClosed()) return existing;
    const page = await entry.context.newPage();
    if (this.#closed) {
      await page.close().catch(noop);
      throw new Error("The browser closed.");
    }
    this.#claim(page, profileId);
    return page;
  }

  #contextOf(page) {
    return typeof page.context === "function" ? page.context() : this.#context;
  }

  #control(page) {
    let cdp = this.#controls.get(page);
    if (!cdp) {
      cdp = this.#contextOf(page).newCDPSession(page);
      this.#controls.set(page, cdp);
      cdp.catch(() => this.#controls.delete(page));
    }
    return cdp;
  }

  async #captureFavicon(page) {
    const generation = (this.#faviconGenerations.get(page) ?? 0) + 1;
    this.#faviconGenerations.set(page, generation);
    const icon = await captureBrowserFavicon(page);
    if (this.#closed || page.isClosed() || this.#faviconGenerations.get(page) !== generation)
      return;
    if (icon) this.#tabFavicons.set(page, icon);
    else this.#tabFavicons.delete(page);
    this.#emitTabs();
  }

  async #refreshAudio(page) {
    if (this.#audioRefreshes.has(page) || this.#closed || page.isClosed()) return;
    this.#audioRefreshes.add(page);
    const generation = this.#audioGenerations.get(page) ?? 0;
    try {
      const context = this.#contextOf(page);
      const state = browserAudioAvailable(context)
        ? await tabAudioState(context, await this.#control(page))
        : null;
      if (this.#closed || page.isClosed() || (this.#audioGenerations.get(page) ?? 0) !== generation)
        return;
      const previous = this.#audioStates.get(page);
      if (!state) this.#audioStates.delete(page);
      else this.#audioStates.set(page, state);
      if (JSON.stringify(previous ?? null) !== JSON.stringify(state)) this.#emitTabs();
    } catch {
      // A worker may be stopped or unavailable for this Chrome build or profile.
      if ((this.#audioGenerations.get(page) ?? 0) === generation && this.#audioStates.has(page)) {
        this.#audioStates.delete(page);
        this.#emitTabs();
      }
    } finally {
      this.#audioRefreshes.delete(page);
    }
  }

  #watch(page) {
    if (this.#watched.has(page)) return;
    this.#watched.add(page);
    this.#tabId(page);
    page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT_MS);
    page.on("download", (download) => {
      const request = this.#navigationRequests.get(page);
      const isNavigation =
        request?.url() === download.url() &&
        /ERR_ABORTED/i.test(request.failure()?.errorText ?? "");
      let entry;
      if (isNavigation) {
        entry = {
          url: download.url(),
          fileName: String(download.suggestedFilename() || "download")
            .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
            .slice(0, 255),
          downloadId: null,
          status: "saving",
        };
        this.#restoreUrls.set(page, entry.url);
        this.#fileNotShown.set(page, entry);
        if (page === this.#active) this.#emitNav();
      }
      void this.#downloads.save(page, this.#tabId(page), download).then((saved) => {
        if (!entry || this.#closed || this.#fileNotShown.get(page) !== entry) return;
        this.#fileNotShown.set(
          page,
          saved
            ? { ...entry, fileName: saved.fileName, downloadId: saved.id, status: "ready" }
            : { ...entry, status: "failed" },
        );
        if (page === this.#active) this.#emitNav();
      });
    });
    this.#preparing.set(page, this.#prepare(page));
    void this.#refreshAudio(page);
    // Listening intercepts the picker; whoever drives the page answers it (T3's onFileChooser).
    page.on("filechooser", (chooser) => void this.#offerFileChooser(page, chooser));
    const mainNavigation = (request) =>
      request.isNavigationRequest() && request.frame() === page.mainFrame();
    page.on("request", (request) => {
      if (!mainNavigation(request)) return;
      this.#navigationRequests.set(page, request);
      this.#navigationErrors.delete(page);
      this.#fileNotShown.delete(page);
      if (page !== this.#active) return;
      this.#refs = null;
      this.#setLoading(true);
    });
    page.on("requestfailed", (request) => {
      if (!mainNavigation(request) || this.#navigationRequests.get(page) !== request) return;
      const description = request.failure()?.errorText ?? "";
      // Canceled requests include downloads, redirects and user-initiated stops; they are not
      // connection failures and must not replace the page with an unreachable screen.
      if (description && !/ERR_ABORTED/i.test(description)) {
        const url = request.url();
        if (/^https?:\/\//i.test(url)) {
          this.#restoreUrls.set(page, url);
          this.#navigationErrors.set(page, { url, description: description.slice(0, 256) });
          let finish;
          const transition = new Promise((resolve) => {
            const onNavigation = (frame) => {
              if (frame === page.mainFrame()) finish();
            };
            const timer = setTimeout(() => finish(), 1000);
            timer.unref?.();
            finish = () => {
              clearTimeout(timer);
              page.off("framenavigated", onNavigation);
              resolve();
            };
            page.on("framenavigated", onNavigation);
          });
          this.#failedTransitions.set(page, transition);
          void transition.then(() => {
            if (this.#failedTransitions.get(page) === transition)
              this.#failedTransitions.delete(page);
          });
        }
      }
      if (page === this.#active) this.#setLoading(false);
      else this.#emitTabs();
    });
    page.on("load", () => {
      void this.#captureFavicon(page);
      if (page !== this.#active) {
        void page
          .title()
          .then((title) => {
            this.#tabTitles.set(page, title.slice(0, 512));
            this.#emitTabs();
          })
          .catch(noop);
        return;
      }
      this.#setLoading(false);
      void this.#refreshNav();
    });
    // A main-frame navigation makes its page the active one, like T3's most recent navigation.
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      this.#faviconGenerations.set(page, (this.#faviconGenerations.get(page) ?? 0) + 1);
      this.#tabFavicons.delete(page);
      if (/^https?:\/\//i.test(page.url())) this.#restoreUrls.delete(page);
      if (page !== this.#active) {
        this.#emitTabs();
        return;
      }
      if (page.url() !== "about:blank" && this.#selectedBlank === page) this.#selectedBlank = null;
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
    this.#emitTabs();
  }

  async #refreshNav() {
    if (this.#active?.url() === "about:blank" && this.#active !== this.#selectedBlank) {
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
    if (title !== null) {
      this.#title = title.slice(0, 512);
      this.#tabTitles.set(page, this.#title);
    }
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
    this.#context = this.#contextOf(page);
    this.#refs = null;
    this.#title = "";
    this.#loading = false;
    if (previous) void this.#releaseHeldInput(previous);
    this.#emitTabs();
    this.#emitNav();
    for (const stream of this.#screencasts)
      if (!this.#pinnedScreencasts.has(stream)) void stream.retarget(page);
    const settings = this.#settingsFor(page);
    if (
      settings.zoomFactor !== 1 ||
      settings.viewport.width !== DEFAULT_VIEWPORT.width ||
      settings.viewport.height !== DEFAULT_VIEWPORT.height
    ) {
      void this.#applyBrowserViewport(page).catch(noop);
    } else {
      void this.#syncViewport(page);
    }
    if (settings.colorScheme !== "system")
      void page.emulateMedia({ colorScheme: settings.colorScheme }).catch(noop);
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
    this.#pageViewports.set(page, { width: size.width, height: size.height });
    if (page !== this.#active) return;
    if (size.width === this.#viewport.width && size.height === this.#viewport.height) return;
    this.#viewport = { width: size.width, height: size.height };
    this.#emit("viewport", { ...this.viewport(), tabId: this.#tabId(page) });
  }

  async #pageGone(page) {
    this.#owned.delete(page);
    if (this.#openedPage === page) this.#openedPage = null;
    void this.#downloads.closePage(page);
    this.#emitTabs();
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
    const fresh = await this.#newPage(this.#pageProfiles.get(page) ?? this.#defaultProfile()).catch(
      () => null,
    );
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
  if (name === "text" && value.length > MAX_INPUT_TEXT_CHARS) {
    throw new Error(`Text is longer than ${MAX_INPUT_TEXT_CHARS} characters.`);
  }
  return value;
}

const DEFAULT_IDLE_MS = 15 * 60_000;

/** `ADE_BROWSER_IDLE_MS` overrides the idle timeout, for tests. */
function browserIdleMs() {
  const override = Number(process.env.ADE_BROWSER_IDLE_MS);
  return override > 0 ? override : DEFAULT_IDLE_MS;
}

/**
 * One browser session per project, opened lazily on that project's headless Chrome context and
 * reopened after the context closes. A session nobody uses for `idleMs` and nobody watches is
 * closed, so an idle ADE leaves no Chrome running; the next call reopens it.
 * @param {{ contextFor: (projectId: string) => Promise<import("playwright-core").BrowserContext>, idleMs?: number }} options
 */
export function createBrowserHub({
  contextFor,
  acquireContext,
  defaultProfile,
  validProfile,
  idleMs = browserIdleMs(),
  sessionStore,
  shouldPersist = () => true,
}) {
  /** @type {Map<string, Promise<BrowserSession>>} */
  const sessions = new Map();
  /** Sessions that finished opening, for synchronous status checks. */
  const open = new Map();
  /** When each project's session was last asked for (agent action, viewer attach) or watched. */
  const lastUsed = new Map();
  const snapshots = new Map();
  const closing = new Map();
  const ownership = { owners: new WeakMap(), contexts: new WeakSet() };
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let sweeper;

  async function connect(projectId, onClosed) {
    let context;
    let lease;
    try {
      if (acquireContext) {
        lease = await acquireContext(projectId);
        context = lease.context;
      } else context = await contextFor(projectId);
    } catch (cause) {
      throw cdpUnavailable(cause);
    }
    let session;
    try {
      session = await BrowserSession.open({
        context,
        onClosed,
        ...(lease
          ? {
              ownership,
              releaseContext: lease.release,
              profileId: lease.profileId,
              acquireProfile: (profileId) => acquireContext(projectId, profileId),
              defaultProfile: () => defaultProfile?.(projectId) ?? lease.profileId ?? "default",
              validProfile: (profileId) =>
                validProfile?.(projectId, profileId) ??
                profileId === (lease.profileId ?? "default"),
            }
          : {}),
      });
      if (sessionStore && shouldPersist(projectId)) {
        const saved = await sessionStore.read(projectId);
        if (saved) await session.restoreTabs(saved);
        const saveSnapshot = (value) => {
          const previous = snapshots.get(projectId);
          if (previous) clearTimeout(previous.timer);
          const persistent = value.tabs.filter((tab) => tab.profileId !== "incognito");
          const snapshot = {
            activeId: persistent.some((tab) => tab.id === value.activeId)
              ? value.activeId
              : (persistent.at(-1)?.id ?? null),
            tabs: persistent.map(({ id, url, profileId }) => ({
              id,
              url,
              ...(profileId ? { profileId } : {}),
            })),
          };
          const timer = setTimeout(() => {
            snapshots.delete(projectId);
            void sessionStore.write(projectId, snapshot).catch(noop);
          }, 250);
          timer.unref?.();
          snapshots.set(projectId, { timer, snapshot });
        };
        session.on("tabs", saveSnapshot);
        session.on("closed", () => {
          const pending = snapshots.get(projectId);
          if (!pending) return;
          clearTimeout(pending.timer);
          snapshots.delete(projectId);
          // A browser process can disappear without going through hub.close(). Preserve the
          // latest tab state in that case, too, instead of losing the debounced update.
          void sessionStore.write(projectId, pending.snapshot).catch(noop);
        });
        saveSnapshot(session.tabs());
      }
      return session;
    } catch (error) {
      if (session) await session.close();
      else if (lease) await lease.release();
      else await context.close().catch(noop);
      throw error;
    }
  }

  /** Closes sessions that have no viewer and went unused for `idleMs`. */
  function sweep() {
    const time = Date.now();
    for (const [key, session] of open) {
      if (session.viewerCount > 0) lastUsed.set(key, time);
      else if (time - (lastUsed.get(key) ?? 0) > idleMs) void close(key);
    }
  }

  /** One timer, running only while a session exists. */
  function syncSweeper() {
    if (sessions.size === 0) {
      clearInterval(sweeper);
      sweeper = undefined;
    } else if (!sweeper) {
      sweeper = setInterval(sweep, Math.min(60_000, Math.max(10, idleMs / 2)));
      sweeper.unref?.();
    }
  }

  /** Closes the project's session and its context. */
  function close(projectId) {
    const key = String(projectId);
    const existing = closing.get(key);
    if (existing) return existing;
    const work = Promise.resolve().then(async () => {
      const current = sessions.get(key);
      sessions.delete(key);
      open.delete(key);
      lastUsed.delete(key);
      syncSweeper();
      if (!current) return;
      const session = await current.catch(() => null);
      const snapshot = snapshots.get(key);
      if (snapshot) {
        clearTimeout(snapshot.timer);
        snapshots.delete(key);
        await sessionStore?.write(key, snapshot.snapshot).catch(noop);
      }
      await session?.close();
    });
    closing.set(key, work);
    void work
      .finally(() => {
        if (closing.get(key) === work) closing.delete(key);
      })
      .catch(noop);
    return work;
  }

  return {
    /**
     * Returns the project's live session, connecting first if there is none.
     * @returns {Promise<BrowserSession>}
     */
    async get(projectId) {
      const key = String(projectId);
      await closing.get(key)?.catch(noop);
      lastUsed.set(key, Date.now());
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
        if (sessions.get(key) === entry) {
          sessions.delete(key);
          lastUsed.delete(key);
          syncSweeper();
        }
        if (open.get(key)?.closed) open.delete(key);
      });
      sessions.set(key, entry);
      syncSweeper();
      try {
        const session = await entry;
        if (sessions.get(key) === entry && !session.closed) open.set(key, session);
        return session;
      } catch (cause) {
        if (sessions.get(key) === entry) {
          sessions.delete(key);
          syncSweeper();
        }
        throw cause;
      }
    },

    /** The project's open session, without connecting. */
    peek(projectId) {
      const session = open.get(String(projectId));
      return session && !session.closed ? session : null;
    },

    /** Returns an existing session, including one that is still connecting, without opening one. */
    async existing(projectId) {
      const current = sessions.get(String(projectId));
      if (!current) return null;
      try {
        const session = await current;
        return session.closed ? null : session;
      } catch {
        return null;
      }
    },

    close,

    async closeAll() {
      await Promise.all([...sessions.keys()].map((key) => close(key)));
      await sessionStore?.flush();
    },
  };
}
