// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/server/src/preview/ServerBrowserStream.ts
// and the viewer half of apps/server/src/preview/ServerBrowser.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
//
// Serves the agent computer's live browser to viewers over WebSocket. Each viewer
// gets its own screencast from the browser session; frames are binary JPEG and
// are acked to Chromium only after the viewer acks them. Project-level state
// (nav, viewport, pointer, dialog, control) is shared by all viewers of a project.
import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";

const PATH = "/preview-stream";
const DEFAULT_MAX_WIDTH = 1280;
const MAX_WIDTH = 7680;
const DEFAULT_MAX_HEIGHT = 800;
const MAX_HEIGHT = 4320;
const DEFAULT_QUALITY = 70;
const MAX_QUALITY = 100;
const MAX_SOCKET_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_UNACKNOWLEDGED_FRAMES = 64;
// Per-frame overhead T3 adds to the buffer estimate (WebSocket frame header).
const FRAME_OVERHEAD_BYTES = 14;
const MAX_TEXT_CHARS = 10000;
const MIN_RESIZE = 240;
const MAX_RESIZE_WIDTH = 3840;
const MAX_RESIZE_HEIGHT = 2160;
// WebSocket close reasons are limited to 123 bytes.
const MAX_CLOSE_REASON_BYTES = 123;

const CLOSE_RECONNECT = 1012;
const CLOSE_SLOW_VIEWER = 1013;
const CLOSE_INTERNAL = 1011;
const CLOSE_BAD_REQUEST = 4400;
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_HOST_UNAVAILABLE = 4503;

const BUTTONS = ["none", "left", "middle", "right"];

const intParam = (params, name, fallback, max) => {
  const value = Number(params.get(name));
  return Number.isFinite(value) && value > 0 ? Math.min(Math.round(value), max) : fallback;
};

const finiteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const isModifiers = (value) => Number.isInteger(value) && value >= 0 && value <= 15;

function parseMessage(data) {
  try {
    const message = JSON.parse(data.toString());
    return typeof message === "object" && message !== null && !Array.isArray(message)
      ? message
      : null;
  } catch {
    return null;
  }
}

/** Validates a viewer's input message and returns the session input shape, or null. */
function inputFrom(msg) {
  switch (msg.type) {
    case "mouse": {
      if (!["move", "down", "up"].includes(msg.action) || !BUTTONS.includes(msg.button))
        return null;
      const x = finiteNumber(msg.x);
      const y = finiteNumber(msg.y);
      if (x === null || y === null || !isModifiers(msg.modifiers)) return null;
      const buttons = finiteNumber(msg.buttons) ?? 0;
      const clickCount = finiteNumber(msg.clickCount) ?? (msg.action === "move" ? 0 : 1);
      return {
        type: "mouse",
        action: msg.action,
        x,
        y,
        button: msg.button,
        buttons,
        clickCount,
        modifiers: msg.modifiers,
      };
    }
    case "wheel": {
      const x = finiteNumber(msg.x);
      const y = finiteNumber(msg.y);
      const deltaX = finiteNumber(msg.deltaX);
      const deltaY = finiteNumber(msg.deltaY);
      if ([x, y, deltaX, deltaY].includes(null) || !isModifiers(msg.modifiers)) return null;
      return { type: "wheel", x, y, deltaX, deltaY, modifiers: msg.modifiers };
    }
    case "key": {
      if (!["down", "up"].includes(msg.action)) return null;
      if (typeof msg.key !== "string" || msg.key.length === 0) return null;
      if (typeof msg.code !== "string" || !isModifiers(msg.modifiers)) return null;
      if (msg.keyCode !== undefined && finiteNumber(msg.keyCode) === null) return null;
      if (msg.text !== undefined && typeof msg.text !== "string") return null;
      return {
        type: "key",
        action: msg.action,
        key: msg.key,
        code: msg.code,
        modifiers: msg.modifiers,
        ...(msg.keyCode !== undefined ? { keyCode: msg.keyCode } : {}),
        ...(msg.text !== undefined ? { text: msg.text } : {}),
      };
    }
    case "text": {
      if (typeof msg.text !== "string" || msg.text.length === 0) return null;
      if (msg.text.length > MAX_TEXT_CHARS) return null;
      return { type: "text", text: msg.text };
    }
    default:
      return null;
  }
}

const controllerFor = (state, viewerId) =>
  state.owner === viewerId ? "you" : state.owner !== null ? "another-viewer" : "agent";

const navMessage = (nav) => ({
  type: "nav",
  url: nav.url,
  title: nav.title,
  loading: nav.loading,
  canGoBack: nav.canGoBack,
  canGoForward: nav.canGoForward,
});

const safeCall = (fn) => {
  try {
    fn();
  } catch {
    // An ack for a session that has already gone away has nothing left to release.
  }
};

/** Keeps a WebSocket close reason within the 123-byte limit. */
function hostReason(message) {
  let text = String(message);
  while (Buffer.byteLength(JSON.stringify({ message: text })) > MAX_CLOSE_REASON_BYTES) {
    text = text.slice(0, -1);
  }
  return JSON.stringify({ message: text });
}

/**
 * @param {{
 *   hub: { get(projectId: string): Promise<any> },
 *   controls: { for(projectId: string): any },
 *   originAllowed: (origin: string) => boolean,
 * }} options
 */
export function createBrowserStreamServer({ hub, controls, originAllowed }) {
  const token = randomBytes(24).toString("hex");
  const rooms = new Map();
  const server = http.createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ noServer: true });
  let started = null;
  let port = 0;

  const tokenMatches = (given) => {
    if (typeof given !== "string") return false;
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  const send = (rec, message) => {
    if (rec.ws.readyState === WebSocket.OPEN) rec.ws.send(JSON.stringify(message));
  };
  const sendError = (rec, error) =>
    send(rec, { type: "error", message: String(error?.message ?? error) });
  const sendControl = (rec, room, state = room.control.state()) =>
    send(rec, {
      type: "control",
      canOperate: true,
      controller: controllerFor(state, rec.viewerId),
      generation: state.generation,
      dialog: room.dialog,
    });
  const broadcast = (room, message) => {
    for (const rec of room.viewers) send(rec, message);
  };
  const broadcastControl = (room, state) => {
    for (const rec of room.viewers) sendControl(rec, room, state);
  };
  const guarded = (rec, promise) => promise.catch((error) => sendError(rec, error));

  /** Releases keys and buttons a viewer left down, so the page never keeps them pressed. */
  async function releaseHeld(room, viewerId) {
    const held = room.held.get(viewerId);
    if (!held) return;
    room.held.delete(viewerId);
    for (const { key, code } of held.keys.values()) {
      await room.session.input({ type: "key", action: "up", key, code, modifiers: 0 });
    }
    for (const button of held.buttons.keys()) {
      const { x, y } = held.buttons.get(button);
      await room.session.input({
        type: "mouse",
        action: "up",
        x,
        y,
        button,
        buttons: 0,
        clickCount: 1,
        modifiers: 0,
      });
    }
  }

  function trackHeld(room, viewerId, input) {
    if (input.type === "key") {
      let held = room.held.get(viewerId);
      if (!held) room.held.set(viewerId, (held = { keys: new Map(), buttons: new Map() }));
      const id = input.code || input.key;
      if (input.action === "down") held.keys.set(id, { key: input.key, code: input.code });
      else held.keys.delete(id);
    } else if (input.type === "mouse" && input.button !== "none") {
      let held = room.held.get(viewerId);
      if (!held) room.held.set(viewerId, (held = { keys: new Map(), buttons: new Map() }));
      if (input.action === "down") held.buttons.set(input.button, { x: input.x, y: input.y });
      else if (input.action === "up") held.buttons.delete(input.button);
    }
  }

  function teardown(room) {
    if (room.closed) return;
    room.closed = true;
    if (rooms.get(room.projectId) === room) rooms.delete(room.projectId);
    for (const off of room.unsubs.splice(0)) safeCall(off);
  }

  function teardownIfEmpty(room) {
    if (room.viewers.size === 0) teardown(room);
  }

  /** Shared state for one project, alive while at least one viewer is attached. */
  function roomFor(projectId) {
    let room = rooms.get(projectId);
    if (room) return room;
    room = {
      projectId,
      session: null,
      control: controls.for(projectId),
      viewers: new Set(),
      dialog: null,
      held: new Map(),
      unsubs: [],
      closed: false,
      ready: null,
    };
    rooms.set(projectId, room);
    room.ready = hub.get(projectId).then(
      (session) => {
        if (room.closed) return;
        room.session = session;
        room.unsubs.push(
          session.on("nav", (nav) => broadcast(room, navMessage(nav))),
          session.on("viewport", (size) =>
            broadcast(room, { type: "viewport", width: size.width, height: size.height }),
          ),
          session.on("pointer", (p) =>
            broadcast(room, {
              type: "pointer",
              phase: p.phase,
              x: p.x,
              y: p.y,
              sequence: p.sequence,
            }),
          ),
          session.on("dialog", (dialog) => {
            room.dialog = dialog ?? null;
            broadcastControl(room);
          }),
          session.on("closed", () => {
            // The browser is gone. Drop this room now so reconnecting viewers get a
            // fresh session, then close the current viewers so they reconnect.
            teardown(room);
            for (const rec of [...room.viewers]) rec.ws.close(CLOSE_RECONNECT, "browser closed");
          }),
          room.control.subscribe((state) => broadcastControl(room, state)),
        );
      },
      (error) => {
        teardown(room);
        throw error;
      },
    );
    room.ready.catch(() => {});
    return room;
  }

  /** Drops a viewer: stops its screencast, flushes its acks and releases control if owned. */
  function detach(rec) {
    if (rec.closed) return;
    rec.closed = true;
    for (const ack of rec.unacked.splice(0)) safeCall(ack);
    const stop = rec.stop;
    rec.stop = null;
    if (stop)
      Promise.resolve()
        .then(() => stop())
        .catch(() => {});
    const room = rec.room;
    if (!room) return;
    room.viewers.delete(rec);
    // Control belongs to the viewer id, not one socket. Release only when the
    // owner's last socket closes, so a reconnecting tab keeps control.
    const ownerStillOpen = [...room.viewers].some((other) => other.viewerId === rec.viewerId);
    if (!ownerStillOpen && room.control.state().owner === rec.viewerId) {
      room.control.release(rec.viewerId, () => releaseHeld(room, rec.viewerId));
    }
    teardownIfEmpty(room);
  }

  function onFrame(rec, jpeg, ack) {
    if (rec.closed || rec.ws.readyState !== WebSocket.OPEN) {
      safeCall(ack);
      return;
    }
    // A slow viewer is dropped, but every frame still acks Chromium.
    if (
      rec.unacked.length >= MAX_UNACKNOWLEDGED_FRAMES ||
      rec.ws.bufferedAmount + jpeg.length + FRAME_OVERHEAD_BYTES > MAX_SOCKET_BUFFER_BYTES
    ) {
      safeCall(ack);
      detach(rec);
      rec.ws.close(CLOSE_SLOW_VIEWER, "slow viewer");
      return;
    }
    rec.unacked.push(ack);
    rec.ws.send(jpeg, { binary: true });
  }

  async function attach(rec, req) {
    const { ws } = rec;
    const params = new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
    const origin = req.headers.origin ?? "";
    if (!tokenMatches(params.get("token")) || !originAllowed(origin)) {
      ws.close(CLOSE_UNAUTHORIZED, "unauthorized");
      return false;
    }
    const projectId = params.get("project") ?? "";
    const viewerId = params.get("viewer") ?? "";
    if (!projectId || !viewerId) {
      ws.close(CLOSE_BAD_REQUEST, "project and viewer are required");
      return false;
    }
    rec.viewerId = viewerId;
    rec.maxWidth = intParam(params, "maxWidth", DEFAULT_MAX_WIDTH, MAX_WIDTH);
    rec.maxHeight = intParam(params, "maxHeight", DEFAULT_MAX_HEIGHT, MAX_HEIGHT);
    rec.quality = intParam(params, "quality", DEFAULT_QUALITY, MAX_QUALITY);

    const room = roomFor(projectId);
    try {
      await room.ready;
    } catch (error) {
      if (!rec.closed) ws.close(CLOSE_HOST_UNAVAILABLE, hostReason(error?.message ?? error));
      teardownIfEmpty(room);
      return false;
    }
    if (rec.closed || room.closed) {
      if (!rec.closed) ws.close(CLOSE_RECONNECT, "browser closed");
      teardownIfEmpty(room);
      return false;
    }
    rec.room = room;
    room.viewers.add(rec);
    const size = room.session.viewport();
    send(rec, { type: "viewport", width: size.width, height: size.height });
    sendControl(rec, room);
    send(rec, navMessage(room.session.nav()));
    try {
      const stop = await room.session.startScreencast(
        { maxWidth: rec.maxWidth, maxHeight: rec.maxHeight, quality: rec.quality },
        (jpeg, ack) => onFrame(rec, jpeg, ack),
      );
      if (rec.closed)
        Promise.resolve()
          .then(() => stop())
          .catch(() => {});
      else rec.stop = stop;
    } catch (error) {
      sendError(rec, error);
      ws.close(CLOSE_INTERNAL, "screencast failed");
      return false;
    }
    return true;
  }

  async function handleMessage(rec, data) {
    const msg = parseMessage(data);
    const room = rec.room;
    if (!msg || !room || rec.closed) return;
    const { control, session } = room;
    switch (msg.type) {
      case "ack": {
        const ack = rec.unacked.shift();
        if (ack) safeCall(ack);
        return;
      }
      case "takeControl":
        try {
          control.take(rec.viewerId);
        } catch (error) {
          sendError(rec, error);
        }
        return;
      case "releaseControl":
        control.release(rec.viewerId, () => releaseHeld(room, rec.viewerId));
        return;
      case "resize": {
        const width = finiteNumber(msg.width);
        const height = finiteNumber(msg.height);
        if (width === null || height === null) return;
        const size = {
          width: Math.min(Math.max(Math.round(width), MIN_RESIZE), MAX_RESIZE_WIDTH),
          height: Math.min(Math.max(Math.round(height), MIN_RESIZE), MAX_RESIZE_HEIGHT),
        };
        await guarded(
          rec,
          Promise.resolve().then(() => session.resize(size)),
        );
        return;
      }
      case "navigate":
        if (typeof msg.url !== "string" || msg.url.length === 0) return;
        await guarded(
          rec,
          control.human(rec.viewerId, () => session.navigate(msg.url)),
        );
        return;
      case "history":
        if (msg.delta !== -1 && msg.delta !== 1) return;
        await guarded(
          rec,
          control.human(rec.viewerId, () => session.history(msg.delta)),
        );
        return;
      case "reload":
        if (msg.ignoreCache !== undefined && typeof msg.ignoreCache !== "boolean") return;
        await guarded(
          rec,
          control.human(rec.viewerId, () =>
            session.reload({ ignoreCache: msg.ignoreCache === true }),
          ),
        );
        return;
      case "dialog":
        if (typeof msg.accept !== "boolean") return;
        if (msg.promptText !== undefined && typeof msg.promptText !== "string") return;
        await guarded(
          rec,
          control.human(rec.viewerId, () =>
            session.dialog({
              accept: msg.accept,
              ...(msg.promptText !== undefined ? { promptText: msg.promptText } : {}),
            }),
          ),
        );
        return;
      default: {
        const input = inputFrom(msg);
        if (!input) return;
        await guarded(
          rec,
          control.human(rec.viewerId, async () => {
            await session.input(input);
            trackHeld(room, rec.viewerId, input);
          }),
        );
      }
    }
  }

  wss.on("connection", (ws, req) => {
    // Errors end the socket through its close event, so there is nothing else to do here.
    ws.on("error", () => {});
    const rec = { ws, viewerId: null, room: null, unacked: [], stop: null, closed: false };
    ws.on("close", () => detach(rec));
    const attached = attach(rec, req).catch(() => false);
    ws.on("message", (data) => {
      attached.then((ok) => {
        if (ok) return handleMessage(rec, data);
      });
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname !== PATH) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  return {
    /** Starts listening on 127.0.0.1 on a random port. Idempotent. */
    start() {
      if (!started) {
        started = new Promise((resolve, reject) => {
          const onError = (error) => reject(error);
          server.once("error", onError);
          server.listen(0, "127.0.0.1", () => {
            server.off("error", onError);
            port = server.address().port;
            resolve({ port });
          });
        }).catch((error) => {
          started = null;
          throw error;
        });
      }
      return started;
    },
    /** @returns {string} stream URL for `projectId`, without the per-viewer query params. */
    url(projectId) {
      if (!port) throw new Error("The browser stream server is not running.");
      const url = new URL(`ws://127.0.0.1:${port}${PATH}`);
      url.searchParams.set("project", projectId);
      url.searchParams.set("token", token);
      return url.toString();
    },
    async close() {
      if (!started) return;
      const pending = started;
      started = null;
      await pending.catch(() => {});
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(() => resolve()));
      server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
