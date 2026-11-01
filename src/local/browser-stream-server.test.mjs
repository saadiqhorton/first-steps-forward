// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/server/src/preview/ServerBrowserStream.ts
// and the viewer half of apps/server/src/preview/ServerBrowser.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createControlRegistry } from "./browser-control.mjs";
import { createBrowserStreamServer } from "./browser-stream-server.mjs";

const ORIGIN = "http://localhost:5173";

/** A session that records what the server asks of it. Chromium is never started. */
function fakeSession() {
  const listeners = new Map();
  const calls = [];
  const screencasts = [];
  const nav = {
    url: "http://127.0.0.1:3000/",
    title: "Demo",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  };
  let viewport = { width: 1280, height: 800 };
  return {
    calls,
    screencasts,
    nav: () => ({ ...nav }),
    viewport: () => ({ ...viewport }),
    fileChooser: () => null,
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(cb);
      return () => listeners.get(event).delete(cb);
    },
    emit(event, payload) {
      for (const cb of listeners.get(event) ?? []) cb(payload);
    },
    async startScreencast(opts, onFrame) {
      const entry = { opts, onFrame, stopped: false };
      screencasts.push(entry);
      return async () => {
        entry.stopped = true;
        calls.push({ name: "stopScreencast" });
      };
    },
    async input(msg) {
      calls.push({ name: "input", msg });
      // A ctrl+c reports what the page copied, like BrowserSession.input.
      if (msg.type === "key" && msg.action === "down" && msg.key === "c" && msg.modifiers === 2)
        return { copied: "copied text" };
    },
    async resize(size) {
      viewport = { ...size };
      calls.push({ name: "resize", size });
    },
    async navigate(url) {
      calls.push({ name: "navigate", url });
    },
    async history(delta) {
      calls.push({ name: "history", delta });
    },
    async reload(opts) {
      calls.push({ name: "reload", opts });
    },
    async dialog(opts) {
      calls.push({ name: "dialog", opts });
    },
    /** Sends a JPEG to the viewer's screencast; returns a counter of Chromium acks. */
    pushFrame(index, jpeg) {
      const acks = { count: 0 };
      screencasts[index].onFrame(jpeg, () => {
        acks.count++;
      });
      return acks;
    },
  };
}

function fakeHub(sessions) {
  return {
    async get(projectId) {
      if (projectId === "down") {
        throw new Error("The agent computer's browser is not reachable.");
      }
      if (!sessions.has(projectId)) sessions.set(projectId, fakeSession());
      return sessions.get(projectId);
    },
  };
}

function setup(t, { sessions = new Map() } = {}) {
  const controls = createControlRegistry();
  const server = createBrowserStreamServer({
    hub: fakeHub(sessions),
    controls,
    originAllowed: (origin) => origin === ORIGIN,
  });
  t.after(() => server.close());
  return { server, controls, sessions };
}

async function until(check, label, timeoutMs = 2000) {
  const started = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function streamUrl(server, project, viewer, extra = {}) {
  const url = new URL(server.url(project));
  url.searchParams.set("viewer", viewer);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, String(value));
  return url.toString();
}

/** Opens a viewer socket and records everything it receives. */
async function open(url, origin = ORIGIN) {
  const ws = new WebSocket(url, { headers: { Origin: origin } });
  const client = { ws, messages: [], frames: [], close: null };
  ws.on("message", (data, isBinary) => {
    if (isBinary) client.frames.push(data);
    else client.messages.push(JSON.parse(data.toString()));
  });
  ws.on("close", (code, reason) => {
    client.close = { code, reason: reason.toString() };
  });
  ws.on("error", () => {});
  // Sends before OPEN throw, so wait for the handshake before returning the client.
  await once(ws, "open");
  client.ofType = (type) => client.messages.filter((message) => message.type === type);
  client.lastControl = () => client.ofType("control").at(-1);
  client.send = (message) =>
    ws.send(typeof message === "string" ? message : JSON.stringify(message));
  return client;
}

/** Waits for a socket to report its close code, failing the test on connection errors only. */
async function closedWith(client) {
  return until(() => client.close, "close");
}

test("rejects a bad token and a disallowed origin with 4401", async (t) => {
  const { server } = setup(t);
  await server.start();
  const badToken = new URL(server.url("p1"));
  badToken.searchParams.set("token", "nope");
  badToken.searchParams.set("viewer", "A");
  const badTokenClient = await open(badToken.toString());
  assert.equal((await closedWith(badTokenClient)).code, 4401);

  const badOrigin = await open(streamUrl(server, "p1", "A"), "http://evil.example");
  assert.equal((await closedWith(badOrigin)).code, 4401);
});

test("listens on loopback only", async (t) => {
  const { server } = setup(t);
  await server.start();
  assert.equal(server.address().address, "127.0.0.1");
});

test("passes the upgrade request to the origin check", async (t) => {
  const seen = [];
  const server = createBrowserStreamServer({
    hub: fakeHub(new Map()),
    controls: createControlRegistry(),
    originAllowed: (origin, req) => {
      seen.push(req.socket.remoteAddress);
      return false;
    },
  });
  t.after(() => server.close());
  await server.start();
  const client = await open(streamUrl(server, "p1", "A"));
  assert.equal((await closedWith(client)).code, 4401);
  assert.match(seen[0], /127\.0\.0\.1$/);
});

test("closes with 4503 and a JSON reason when the browser is unavailable", async (t) => {
  const { server } = setup(t);
  await server.start();
  const client = await open(streamUrl(server, "down", "A"));
  const close = await closedWith(client);
  assert.equal(close.code, 4503);
  assert.deepEqual(JSON.parse(close.reason), {
    message: "The agent computer's browser is not reachable.",
  });
});

test("on connect sends viewport, control and nav, and starts a clamped screencast", async (t) => {
  const sessions = new Map();
  const { server } = setup(t, { sessions });
  await server.start();
  const client = await open(
    streamUrl(server, "p1", "A", { maxWidth: 99999, maxHeight: 500, quality: 40 }),
  );
  await until(() => client.ofType("nav").length === 1, "nav");
  assert.deepEqual(client.ofType("viewport"), [{ type: "viewport", width: 1280, height: 800 }]);
  assert.deepEqual(client.lastControl(), {
    type: "control",
    canOperate: true,
    controller: "agent",
    generation: 0,
    dialog: null,
    fileChooser: null,
  });
  assert.deepEqual(client.ofType("nav")[0], {
    type: "nav",
    url: "http://127.0.0.1:3000/",
    title: "Demo",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  });
  const session = sessions.get("p1");
  assert.deepEqual(session.screencasts[0].opts, { maxWidth: 7680, maxHeight: 500, quality: 40 });
  client.ws.close();
});

test("forwards JPEG frames and acks Chromium only after the viewer acks", async (t) => {
  const sessions = new Map();
  const { server } = setup(t, { sessions });
  await server.start();
  const client = await open(streamUrl(server, "p1", "A"));
  await until(() => sessions.get("p1")?.screencasts.length === 1, "screencast");
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const acks = sessions.get("p1").pushFrame(0, jpeg);

  await until(() => client.frames.length === 1, "binary frame");
  assert.deepEqual(client.frames[0], jpeg);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(acks.count, 0, "Chromium is not acked before the viewer acks");

  client.send({ type: "ack" });
  await until(() => acks.count === 1, "chromium ack");
  client.ws.close();
});

test("gates input to the owner and broadcasts control to the second viewer", async (t) => {
  const sessions = new Map();
  const { server } = setup(t, { sessions });
  await server.start();
  const a = await open(streamUrl(server, "p1", "A"));
  const b = await open(streamUrl(server, "p1", "B"));
  await until(() => sessions.get("p1")?.screencasts.length === 2, "two screencasts");
  const session = sessions.get("p1");

  // Not the owner: input and navigation are ignored. The resize that follows
  // is always allowed, so waiting for it proves the earlier messages were handled.
  a.send({
    type: "mouse",
    action: "down",
    x: 10,
    y: 10,
    button: "left",
    buttons: 1,
    clickCount: 1,
    modifiers: 0,
  });
  a.send({ type: "navigate", url: "https://example.com" });
  a.send({ type: "resize", width: 1000, height: 700 });
  await until(() => session.calls.some((call) => call.name === "resize"), "resize");
  assert.equal(
    session.calls.filter((call) => call.name === "input" || call.name === "navigate").length,
    0,
  );

  a.send({ type: "takeControl" });
  await until(() => a.lastControl()?.controller === "you", "you controller");
  await until(() => b.lastControl()?.controller === "another-viewer", "another-viewer");
  assert.equal(b.lastControl().generation, 1);

  // Owner: input is forwarded.
  a.send({ type: "mouse", action: "move", x: 5, y: 6, button: "none", buttons: 0, modifiers: 0 });
  await until(() => session.calls.some((call) => call.name === "input"), "forwarded input");
  assert.deepEqual(session.calls.find((call) => call.name === "input").msg, {
    type: "mouse",
    action: "move",
    x: 5,
    y: 6,
    button: "none",
    buttons: 0,
    clickCount: 0,
    modifiers: 0,
  });

  // Non-owner input from the second viewer is still refused.
  b.send({ type: "text", text: "hello" });
  b.send({ type: "resize", width: 800, height: 600 });
  await until(
    () => session.calls.filter((call) => call.name === "resize").length === 2,
    "second resize",
  );
  assert.equal(session.calls.filter((call) => call.name === "input").length, 1);
  a.ws.close();
  b.ws.close();
});

test("a copy key sends the copied text to that viewer only, and file pickers ride on control", async (t) => {
  const sessions = new Map();
  const { server } = setup(t, { sessions });
  await server.start();
  const a = await open(streamUrl(server, "p1", "A"));
  const b = await open(streamUrl(server, "p1", "B"));
  await until(() => sessions.get("p1")?.screencasts.length === 2, "two screencasts");
  const session = sessions.get("p1");
  a.send({ type: "takeControl" });
  await until(() => a.lastControl()?.controller === "you", "you controller");
  a.send({ type: "key", action: "down", key: "c", code: "KeyC", modifiers: 2 });
  await until(() => a.ofType("clipboard").length === 1, "clipboard");
  assert.deepEqual(a.ofType("clipboard")[0], { type: "clipboard", text: "copied text" });
  assert.equal(b.ofType("clipboard").length, 0);

  session.emit("fileChooser", { id: "1", multiple: false, accept: "image/*" });
  await until(() => b.lastControl()?.fileChooser?.id === "1", "file chooser on control");
  assert.deepEqual(a.lastControl().fileChooser, { id: "1", multiple: false, accept: "image/*" });
  session.emit("fileChooser", null);
  await until(() => a.lastControl()?.fileChooser === null, "file chooser closed");
  a.ws.close();
  b.ws.close();
});

test("ignores malformed and oversized messages", async (t) => {
  const sessions = new Map();
  const { server } = setup(t, { sessions });
  await server.start();
  const a = await open(streamUrl(server, "p1", "A"));
  await until(() => sessions.get("p1")?.screencasts.length === 1, "screencast");
  a.send({ type: "takeControl" });
  await until(() => a.lastControl()?.controller === "you", "you controller");
  a.send("not json");
  a.send({ type: "mouse", action: "down", x: 1, y: 1, button: "left", modifiers: 99 });
  a.send({ type: "text", text: "x".repeat(10001) });
  a.send({ type: "history", delta: 5 });
  a.send({ type: "resize", width: 1000, height: 700 });
  await until(() => sessions.get("p1").calls.some((call) => call.name === "resize"), "resize");
  assert.equal(sessions.get("p1").calls.filter((call) => call.name !== "resize").length, 0);
  a.ws.close();
});

test("releases control when the owner's last socket closes, and releases held keys", async (t) => {
  const sessions = new Map();
  const { server, controls } = setup(t, { sessions });
  await server.start();
  const a = await open(streamUrl(server, "p1", "A"));
  const b = await open(streamUrl(server, "p1", "B"));
  await until(() => sessions.get("p1")?.screencasts.length === 2, "two screencasts");
  const session = sessions.get("p1");

  a.send({ type: "takeControl" });
  await until(() => b.lastControl()?.controller === "another-viewer", "another-viewer");
  a.send({ type: "key", action: "down", key: "Shift", code: "ShiftLeft", modifiers: 8 });
  await until(() => session.calls.some((call) => call.name === "input"), "key down");

  a.ws.close();
  await closedWith(a);
  await until(() => controls.for("p1").state().owner === null, "owner released");
  await until(() => b.lastControl()?.controller === "agent", "agent controller");
  assert.equal(b.lastControl().generation, 2);
  await until(
    () =>
      session.calls.some(
        (call) =>
          call.name === "input" && call.msg.action === "up" && call.msg.code === "ShiftLeft",
      ),
    "held key released",
  );
  b.ws.close();
});

test("a slow viewer is dropped with 1013 after 64 unacked frames, and every frame is acked", async (t) => {
  const sessions = new Map();
  const { server } = setup(t, { sessions });
  await server.start();
  const client = await open(streamUrl(server, "p1", "A"));
  await until(() => sessions.get("p1")?.screencasts.length === 1, "screencast");
  const session = sessions.get("p1");
  const acks = [];
  for (let i = 0; i < 65; i++) acks.push(session.pushFrame(0, Buffer.from([i])));

  const close = await closedWith(client);
  assert.equal(close.code, 1013);
  assert.equal(client.frames.length, 64);
  assert.equal(acks[64].count, 1, "the dropped frame is still acked");
  await until(() => session.screencasts[0].stopped, "screencast stopped");
});
