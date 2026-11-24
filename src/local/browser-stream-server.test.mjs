// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/server/src/preview/ServerBrowserStream.ts
// and the viewer half of apps/server/src/preview/ServerBrowser.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { createControlRegistry } from "./browser-control.mjs";
import { createBrowserStreamServer } from "./browser-stream-server.mjs";

const ORIGIN = "http://localhost:5173";

/** A session that records what the server asks of it. Chromium is never started. */
function fakeSession() {
  const listeners = new Map();
  const calls = [];
  const screencasts = [];
  const heldKeys = new Map();
  const nav = {
    url: "http://127.0.0.1:3000/",
    title: "Demo",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  };
  let viewport = { width: 1280, height: 800 };
  let pendingDialog = null;
  return {
    closed: false,
    calls,
    screencasts,
    nav: () => ({ ...nav }),
    setLoading(value) {
      nav.loading = value;
    },
    tabs: () => ({ activeId: "tab-1", tabs: [{ id: "tab-1", url: nav.url, title: nav.title }] }),
    viewport: () => ({ ...viewport }),
    fileChooser: () => null,
    pendingDialog: () => pendingDialog,
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(cb);
      return () => listeners.get(event).delete(cb);
    },
    emit(event, payload) {
      if (event === "dialog") pendingDialog = payload ?? null;
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
      if (msg.type === "key") {
        const id = msg.code || msg.key;
        if (msg.action === "down") heldKeys.set(id, { key: msg.key, code: msg.code });
        else heldKeys.delete(id);
      }
      // A ctrl+c reports what the page copied, like BrowserSession.input.
      if (msg.type === "key" && msg.action === "down" && msg.key === "c" && msg.modifiers === 2)
        return { copied: "copied text" };
      // Points above 100px accept text, so probe replies are easy to tell apart.
      if (msg.type === "probe") return { probe: { x: msg.x, y: msg.y, editable: msg.y < 100 } };
    },
    releaseInput() {
      for (const { key, code } of heldKeys.values()) {
        calls.push({ name: "input", msg: { type: "key", action: "up", key, code, modifiers: 0 } });
      }
      heldKeys.clear();
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
    async newTab() {
      calls.push({ name: "newTab" });
    },
    async selectTab(id) {
      calls.push({ name: "selectTab", id });
    },
    async closeTab(id) {
      calls.push({ name: "closeTab", id });
    },
    async setTabAudio(id, muted) {
      calls.push({ name: "setTabAudio", id, muted });
    },
    async resize(width, height) {
      calls.push({ name: "resize", width, height });
      viewport = { width, height };
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
    async existing(projectId) {
      if (projectId === "down") {
        throw new Error("The agent computer's browser is not reachable.");
      }
      return sessions.get(projectId) ?? null;
    },
  };
}

function setup(t, { sessions = new Map() } = {}) {
  if (!sessions.has("p1")) sessions.set("p1", fakeSession());
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

const bases = new WeakMap();
/** Serves the stream the way ADE does: upgrades on the HTTP server that serves the UI. */
async function listen(t, server) {
  const http = createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });
  http.on("upgrade", (req, socket, head) => {
    if (server.handleUpgrade(req, socket, head)) return;
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    http.closeAllConnections();
    return new Promise((resolve) => http.close(resolve));
  });
  bases.set(server, `ws://127.0.0.1:${http.address().port}`);
}

function streamUrl(server, project, viewer, extra = {}) {
  const url = new URL(server.url(project), bases.get(server));
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
  await listen(t, server);
  const badToken = new URL(server.url("p1"), bases.get(server));
  badToken.searchParams.set("token", "nope");
  badToken.searchParams.set("viewer", "A");
  const badTokenClient = await open(badToken.toString());
  assert.equal((await closedWith(badTokenClient)).code, 4401);

  const badOrigin = await open(streamUrl(server, "p1", "A"), "http://evil.example");
  assert.equal((await closedWith(badOrigin)).code, 4401);
});

test("issues an origin-relative /preview-stream URL and leaves other upgrades alone", async (t) => {
  const { server } = setup(t);
  const url = new URL(server.url("p 1"), "http://ade.test");
  assert.equal(url.origin, "http://ade.test");
  assert.equal(url.pathname, "/preview-stream");
  assert.equal(url.searchParams.get("project"), "p 1");
  assert.match(url.searchParams.get("token"), /^[0-9a-f]{48}$/);
  await listen(t, server);
  const other = new WebSocket(`${bases.get(server)}/other`, { headers: { Origin: ORIGIN } });
  const [error] = await once(other, "error");
  assert.match(error.message, /404/);
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
  await listen(t, server);
  const client = await open(streamUrl(server, "p1", "A"));
  assert.equal((await closedWith(client)).code, 4401);
  assert.match(seen[0], /127\.0\.0\.1$/);
});

test("closes with 4503 and a JSON reason when the browser is unavailable", async (t) => {
  const { server } = setup(t);
  await listen(t, server);
  const client = await open(streamUrl(server, "down", "A"));
  const close = await closedWith(client);
  assert.equal(close.code, 4503);
  assert.deepEqual(JSON.parse(close.reason), {
    message: "The agent computer's browser is not reachable.",
  });
});

test("does not create a browser when a viewer attaches without an existing session", async (t) => {
  const { server, sessions } = setup(t, { sessions: new Map() });
  sessions.delete("p1");
  await listen(t, server);
  const client = await open(streamUrl(server, "p1", "A"));
  assert.equal((await closedWith(client)).code, 4503);
  assert.equal(sessions.has("p1"), false);
});

test("sends a dialog already open when the viewer attaches", async (t) => {
  const session = fakeSession();
  session.emit("dialog", { type: "confirm", message: "Continue?", defaultValue: "" });
  const sessions = new Map([["p1", session]]);
  const { server } = setup(t, { sessions });
  await listen(t, server);
  const client = await open(streamUrl(server, "p1", "A"));
  await until(() => client.lastControl()?.dialog?.message === "Continue?", "initial dialog");
  client.ws.close();
});

test("sends a file chooser already open when the viewer attaches", async (t) => {
  const session = fakeSession();
  session.fileChooser = () => ({ id: "picker-1", multiple: true, accept: ".png" });
  const sessions = new Map([["p1", session]]);
  const { server } = setup(t, { sessions });
  await listen(t, server);
  const client = await open(streamUrl(server, "p1", "A"));
  await until(() => client.lastControl()?.fileChooser?.id === "picker-1", "initial file chooser");
  assert.deepEqual(client.lastControl().fileChooser, {
    id: "picker-1",
    multiple: true,
    accept: ".png",
  });
  client.ws.close();
});

test("on connect sends viewport, control and nav, and starts a clamped screencast", async (t) => {
  const sessions = new Map();
  const { server } = setup(t, { sessions });
  await listen(t, server);
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
    error: null,
    fileNotShown: null,
    opened: false,
  });
  const session = sessions.get("p1");
  assert.deepEqual(session.screencasts[0].opts, { maxWidth: 7680, maxHeight: 500, quality: 40 });
  client.ws.close();
});

test("forwards JPEG frames and acks Chromium only after the viewer acks", async (t) => {
  const sessions = new Map();
  const { server } = setup(t, { sessions });
  await listen(t, server);
  const client = await open(streamUrl(server, "p1", "A"));
  await until(() => sessions.get("p1")?.screencasts.length === 1, "screencast");
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const acks = sessions.get("p1").pushFrame(0, jpeg);

  await until(() => client.frames.length === 1, "binary frame");
  assert.deepEqual(client.frames[0], jpeg);
  assert.equal(acks.count, 0, "Chromium is not acked before the viewer acks");

  client.send({ type: "ack" });
  await until(() => acks.count === 1, "chromium ack");
  client.ws.close();
});

test("reload still reaches the browser while navigation is marked as loading", async (t) => {
  const sessions = new Map();
  const { server, controls } = setup(t, { sessions });
  await listen(t, server);
  const client = await open(streamUrl(server, "p1", "A"));
  await until(() => sessions.get("p1")?.screencasts.length === 1, "screencast");
  const session = sessions.get("p1");
  session.setLoading(true);
  controls.for("p1").take("A");

  client.send({ type: "reload" });
  await until(() => session.calls.some((call) => call.name === "reload"), "reload");
  assert.deepEqual(
    session.calls.find((call) => call.name === "reload"),
    {
      name: "reload",
      opts: { ignoreCache: false },
    },
  );
  client.ws.close();
});

test("gates input to the owner and broadcasts control to the second viewer", async (t) => {
  const sessions = new Map();
  const { server, controls } = setup(t, { sessions });
  await listen(t, server);
  const a = await open(streamUrl(server, "p1", "A"));
  const b = await open(streamUrl(server, "p1", "B"));
  await until(() => sessions.get("p1")?.screencasts.length === 2, "two screencasts");
  const session = sessions.get("p1");

  // A's input and navigation are refused while B owns control. B's navigation
  // is the observable barrier proving the earlier messages have been handled.
  const control = controls.for("p1");
  control.take("B");
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
  a.send({ type: "navigate", url: "https://example.com/unauthorized" });
  b.send({ type: "navigate", url: "https://example.com/authorized" });
  await until(() => session.calls.some((call) => call.name === "navigate"), "owner navigation");
  assert.equal(
    session.calls.filter((call) => call.name === "input" || call.name === "navigate").length,
    1,
  );
  assert.equal(
    session.calls.find((call) => call.name === "navigate").url,
    "https://example.com/authorized",
  );

  control.release("B");
  control.take("A");
  await until(() => a.lastControl()?.controller === "you", "you controller");
  await until(() => b.lastControl()?.controller === "another-viewer", "another-viewer");
  assert.equal(b.lastControl().generation, 3);

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
  b.ws.close();
  await closedWith(b);
  assert.equal(session.calls.filter((call) => call.name === "input").length, 1);
  a.ws.close();
});

test("a touch probe answers only the viewer that asked, and only with control", async (t) => {
  const sessions = new Map();
  const { server, controls } = setup(t, { sessions });
  await listen(t, server);
  const a = await open(streamUrl(server, "p1", "A"));
  const b = await open(streamUrl(server, "p1", "B"));
  await until(() => a.ofType("tabs").length === 1 && b.ofType("tabs").length === 1, "tab state");

  // No control yet: the probe is dropped for everyone.
  a.send({ type: "probe", x: 10, y: 20 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(a.ofType("probe").length, 0);

  controls.for("p1").take("A");
  await until(() => a.lastControl()?.controller === "you", "you controller");
  a.send({ type: "probe", x: 10, y: 20 });
  a.send({ type: "probe", x: "bad", y: 20 });
  const answer = await until(() => a.ofType("probe")[0], "probe answer");
  assert.deepEqual(answer, { type: "probe", x: 10, y: 20, editable: true });
  assert.equal(a.ofType("probe").length, 1);
  assert.equal(b.ofType("probe").length, 0);
  assert.deepEqual(
    sessions
      .get("p1")
      .calls.filter((call) => call.name === "input")
      .map((call) => call.msg),
    [{ type: "probe", x: 10, y: 20 }],
  );
  a.ws.close();
  b.ws.close();
});

test("a viewer can fit the page to its pane within the viewport limits", async (t) => {
  const sessions = new Map();
  const { server, controls } = setup(t, { sessions });
  await listen(t, server);
  const a = await open(streamUrl(server, "p1", "A"));
  await until(() => a.ofType("tabs").length === 1, "tab state");
  controls.for("p1").take("A");
  await until(() => a.lastControl()?.controller === "you", "you controller");
  a.send({ type: "resize", width: 700.6, height: 500.4 });
  a.send({ type: "resize", width: 50, height: 500 });
  a.send({ type: "resize", width: 10_000, height: 500 });
  await until(() => sessions.get("p1").calls.some((call) => call.name === "resize"), "resize");
  assert.deepEqual(
    sessions.get("p1").calls.filter((call) => call.name === "resize"),
    [{ name: "resize", width: 701, height: 500 }],
  );
  a.ws.close();
});

test("tab controls are sent only for the viewer holding browser control", async (t) => {
  const sessions = new Map();
  const { server, controls } = setup(t, { sessions });
  await listen(t, server);
  const a = await open(streamUrl(server, "p1", "A"));
  const b = await open(streamUrl(server, "p1", "B"));
  await until(() => a.ofType("tabs").length === 1 && b.ofType("tabs").length === 1, "tab state");
  controls.for("p1").take("A");
  b.send({ type: "tab", action: "new" });
  b.send({ type: "tab-audio", id: "tab-1", muted: true });
  a.send({ type: "tab", action: "select", id: "tab-1" });
  a.send({ type: "tab-audio", id: "tab-1", muted: true });
  await until(
    () => sessions.get("p1").calls.some((call) => call.name === "selectTab"),
    "selected tab",
  );
  assert.equal(
    sessions.get("p1").calls.some((call) => call.name === "newTab"),
    false,
  );
  await until(
    () => sessions.get("p1").calls.some((call) => call.name === "setTabAudio"),
    "muted tab",
  );
  assert.deepEqual(
    sessions.get("p1").calls.filter((call) => call.name === "setTabAudio"),
    [{ name: "setTabAudio", id: "tab-1", muted: true }],
  );
  a.send({ type: "tab", action: "new" });
  await until(() => sessions.get("p1").calls.some((call) => call.name === "newTab"), "new tab");
  a.ws.close();
  b.ws.close();
});

test("a recording viewer can request a stream pinned to a tab", async (t) => {
  const sessions = new Map();
  const { server } = setup(t, { sessions });
  await listen(t, server);
  const client = await open(streamUrl(server, "p1", "recorder", { tab: "tab-1" }));
  await until(() => sessions.get("p1")?.screencasts.length === 1, "pinned stream");
  assert.equal(sessions.get("p1").screencasts[0].opts.tabId, "tab-1");
  client.ws.close();
});

test("a copy key sends the copied text to that viewer only, and file pickers ride on control", async (t) => {
  const sessions = new Map();
  const { server, controls } = setup(t, { sessions });
  await listen(t, server);
  const a = await open(streamUrl(server, "p1", "A"));
  const b = await open(streamUrl(server, "p1", "B"));
  await until(() => sessions.get("p1")?.screencasts.length === 2, "two screencasts");
  const session = sessions.get("p1");
  controls.for("p1").take("A");
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
  const { server, controls } = setup(t, { sessions });
  await listen(t, server);
  const a = await open(streamUrl(server, "p1", "A"));
  await until(() => sessions.get("p1")?.screencasts.length === 1, "screencast");
  controls.for("p1").take("A");
  await until(() => a.lastControl()?.controller === "you", "you controller");
  a.send("not json");
  a.send({ type: "mouse", action: "down", x: 1, y: 1, button: "left", modifiers: 99 });
  a.send({ type: "text", text: "x".repeat(10001) });
  a.send({ type: "history", delta: 5 });
  a.send({ type: "mouse", action: "move", x: 5, y: 6, button: "none", buttons: 0, modifiers: 0 });
  await until(() => sessions.get("p1").calls.some((call) => call.name === "input"), "valid input");
  assert.equal(sessions.get("p1").calls.length, 1);
  assert.equal(sessions.get("p1").calls[0].msg.x, 5);
  a.ws.close();
});

test("releases control when the owner's last socket closes, and releases held keys", async (t) => {
  const sessions = new Map();
  const { server, controls } = setup(t, { sessions });
  await listen(t, server);
  const a = await open(streamUrl(server, "p1", "A"));
  const b = await open(streamUrl(server, "p1", "B"));
  await until(() => sessions.get("p1")?.screencasts.length === 2, "two screencasts");
  const session = sessions.get("p1");

  controls.for("p1").take("A");
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
  await listen(t, server);
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

test("wheel bursts preserve scroll distance and click order behind a busy browser", async (t) => {
  const { server, controls, sessions } = setup(t);
  await listen(t, server);
  const client = await open(streamUrl(server, "p1", "A"));
  const session = sessions.get("p1");
  await until(() => session.screencasts.length === 1, "screencast");
  controls.for("p1").take("A");
  let resume;
  const busy = new Promise((resolve) => {
    resume = resolve;
  });
  const input = session.input.bind(session);
  session.input = async (message) => {
    await input(message);
    await busy;
  };
  const wheel = { type: "wheel", x: 10, y: 10, modifiers: 0, deltaX: 0, deltaY: 4 };
  client.send(wheel);
  await until(() => session.calls.length, "first wheel in flight");
  for (let i = 0; i < 20; i++) client.send(wheel);
  client.send({ ...wheel, deltaY: -4 });
  client.send({ type: "mouse", action: "down", x: 10, y: 10, modifiers: 0, button: "left" });
  client.send(wheel);
  for (const x of [31, 41, 51]) {
    client.send({ type: "mouse", action: "move", x, y: 4, modifiers: 0, button: "none" });
  }
  client.send({ ...wheel, x: 30 });
  client.send({ ...wheel, x: 31 });
  client.send({ ...wheel, x: 31, modifiers: 2 });
  client.send({ type: "key", action: "down", code: "KeyA", key: "a", modifiers: 0 });
  client.send({ ...wheel, x: 31, modifiers: 2 });
  for (const x of [60, 61])
    client.send({
      type: "mouse",
      action: "move",
      x,
      y: 4,
      modifiers: 0,
      button: "left",
      buttons: 1,
    });
  const ack = session.pushFrame(0, Buffer.from([0]));
  client.send({ type: "ack" });
  try {
    await until(() => ack.count, "all input has reached the socket");
  } finally {
    resume();
  }
  await until(() => session.calls.length >= 13, "queued events");
  assert.deepEqual(
    session.calls.map(({ msg }) => msg.deltaY ?? (msg.action === "move" ? msg.x : msg.action)),
    [4, 80, -4, "down", 4, 51, 4, 4, 4, "down", 4, 60, 61],
  );
  client.ws.close();
});

test("a wheel waiting under an old control grant cannot absorb a new owner's input", async (t) => {
  const { server, controls, sessions } = setup(t);
  await listen(t, server);
  const client = await open(streamUrl(server, "p1", "A"));
  const session = sessions.get("p1");
  await until(() => session.screencasts.length === 1, "screencast");
  const control = controls.for("p1");
  control.take("A");
  let resume;
  const busy = new Promise((resolve) => {
    resume = resolve;
  });
  const barrier = control.system(() => busy);
  const wheel = { type: "wheel", x: 0, y: 0, modifiers: 0, deltaX: 0, deltaY: 4 };
  try {
    client.send(wheel);
    const ack = session.pushFrame(0, Buffer.from([0]));
    client.send({ type: "ack" });
    await until(() => ack.count, "first wheel queued");
    control.release("A");
    control.take("A");
    client.send({ ...wheel, deltaY: 8 });
    const secondAck = session.pushFrame(0, Buffer.from([0]));
    client.send({ type: "ack" });
    await until(() => secondAck.count, "second wheel queued");
  } finally {
    resume();
  }
  await barrier;
  await until(() => session.calls.length, "new grant delivers the wheel");
  assert.deepEqual(
    session.calls.map(({ msg }) => msg.deltaY),
    [8],
  );
  client.ws.close();
});
