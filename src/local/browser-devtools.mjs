// Serves a local build of Chromium DevTools and bridges it to a single Playwright page.
import "@chrome-devtools/devtools-app/package.json" with { type: "json" };
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { browserScope } from "./browser-scope.mjs";
import { AUDIO_EXTENSION_ID } from "./browser-audio.mjs";

export const DEVTOOLS_SOCKET_PATH = "/devtools-cdp";
const frontendRoot = path.dirname(
  fileURLToPath(import.meta.resolve("@chrome-devtools/devtools-app/package.json")),
);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".avif": "image/avif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

export function createBrowserDevtools({ hub, originAllowed }) {
  const token = randomBytes(32).toString("hex");
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
  const validToken = (value) => {
    const actual = Buffer.from(value ?? "");
    const expected = Buffer.from(token);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  wss.on("connection", (ws, req) => {
    const params = new URL(req.url ?? "/", "http://localhost").searchParams;
    if (!validToken(params.get("token")) || !originAllowed(req.headers.origin ?? "", req)) {
      ws.close(1008, "Unauthorized");
      return;
    }
    const projectId = params.get("project") ?? "";
    const sessionId = params.get("session");
    const tabId = params.get("tab") ?? undefined;
    if (!projectId || (tabId && !/^tab-\d+$/.test(tabId))) {
      ws.close(1008, "Invalid browser tab");
      return;
    }
    let active = null;
    let closed = false;
    // Playwright exposes the page's CDP session, while DevTools expects flattened child sessions.
    // Keep the target tree so messages can be relayed through more than one nested target.
    const parents = new Map();
    const blockedSessions = new Set();
    const requests = new Map();
    const wrappers = new Map();
    const failed = new Set();
    let wrapperId = 0;
    const requestKey = (sessionId, id) => `${sessionId ?? ""}\0${id}`;
    const forgetRequest = (request) => {
      requests.delete(requestKey(request.sessionId, request.id));
      for (const id of request.wrappers) wrappers.delete(id);
    };
    const forgetTarget = (sessionId) => {
      const pending = [sessionId];
      const visited = new Set();
      while (pending.length) {
        const current = pending.pop();
        if (visited.has(current)) continue;
        visited.add(current);
        for (const [child, parent] of parents) if (parent === current) pending.push(child);
        parents.delete(current);
        blockedSessions.delete(current);
      }
      for (const request of requests.values()) {
        if (!visited.has(request.sessionId)) continue;
        request.failed = true;
        failed.add(requestKey(request.sessionId, request.id));
        forgetRequest(request);
        ws.send(
          JSON.stringify({
            id: request.id,
            sessionId: request.sessionId,
            error: { code: -32000, message: "The target closed." },
          }),
        );
      }
      while (failed.size > 1024) failed.delete(failed.values().next().value);
    };
    const sendEvent = (event) => {
      let message = event;
      let sessionId = null;
      while (message?.method === "Target.receivedMessageFromTarget") {
        const child = message.params?.sessionId;
        if (typeof child !== "string" || typeof message.params?.message !== "string") return;
        if (!parents.has(child)) parents.set(child, sessionId);
        if (blockedSessions.has(child)) return;
        sessionId = child;
        try {
          message = JSON.parse(message.params.message);
        } catch {
          return;
        }
      }
      if (!message || typeof message !== "object") return;
      if (
        message.method === "Target.attachedToTarget" &&
        typeof message.params?.sessionId === "string" &&
        message.params?.targetInfo?.url?.startsWith(`chrome-extension://${AUDIO_EXTENSION_ID}/`)
      ) {
        const child = message.params.sessionId;
        blockedSessions.add(child);
        // Detach this auto-attached target so it cannot remain paused by DevTools.
        void (async () => {
          if (!active) return;
          if (!sessionId) {
            await active.session.send("Target.detachFromTarget", { sessionId: child });
            return;
          }
          let parent = sessionId;
          let payload = {
            id: --wrapperId,
            method: "Target.detachFromTarget",
            params: { sessionId: child },
          };
          const visited = new Set();
          while (parents.get(parent)) {
            if (visited.has(parent)) return;
            visited.add(parent);
            payload = {
              id: --wrapperId,
              method: "Target.sendMessageToTarget",
              params: { sessionId: parent, message: JSON.stringify(payload) },
            };
            parent = parents.get(parent);
          }
          await active.session.send("Target.sendMessageToTarget", {
            sessionId: parent,
            message: JSON.stringify(payload),
          });
        })().catch(() => {});
        return;
      }
      if (
        message.method === "Target.attachedToTarget" &&
        typeof message.params?.sessionId === "string"
      )
        parents.set(message.params.sessionId, sessionId);
      if (
        message.method === "Target.detachedFromTarget" &&
        typeof message.params?.sessionId === "string"
      )
        forgetTarget(message.params.sessionId);
      if (typeof message.id === "number" && message.id < 0) {
        const request = wrappers.get(message.id);
        wrappers.delete(message.id);
        if (request && message.error && !request.failed) {
          request.failed = true;
          const key = requestKey(request.sessionId, request.id);
          failed.add(key);
          if (failed.size > 1024) failed.delete(failed.values().next().value);
          forgetRequest(request);
          ws.send(
            JSON.stringify({ id: request.id, sessionId: request.sessionId, error: message.error }),
          );
        }
        return;
      }
      if (typeof message.id === "number") {
        const key = requestKey(sessionId, message.id);
        if (failed.delete(key)) return;
        const request = requests.get(key);
        if (request) {
          if (
            request.method === "Target.attachToTarget" &&
            typeof message.result?.sessionId === "string"
          )
            parents.set(message.result.sessionId, sessionId);
          forgetRequest(request);
        }
      }
      ws.send(JSON.stringify({ ...message, ...(sessionId ? { sessionId } : {}) }));
    };
    const ready = (async () => {
      const browser = await hub.existing(browserScope(projectId, sessionId));
      if (!browser) throw new Error("The browser is not running.");
      const attached = await browser.openDevtools(tabId);
      if (closed) {
        await attached.close();
        return null;
      }
      active = attached;
      attached.session.on("event", (event) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        sendEvent(event);
      });
      attached.session.once("close", () => {
        if (ws.readyState === WebSocket.OPEN) ws.close(1001, "Browser closed");
      });
      return attached.session;
    })();
    ready.catch(() => {
      if (ws.readyState === WebSocket.OPEN) ws.close(1011, "Could not attach DevTools");
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      closed = true;
      void active?.close();
    });
    ws.on("message", (data) => {
      void (async () => {
        let request;
        try {
          request = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (
          !request ||
          !Number.isSafeInteger(request.id) ||
          request.id < 0 ||
          typeof request.method !== "string"
        )
          return;
        try {
          const cdp = await ready;
          if (!cdp) return;
          // Only our relay may construct nested protocol envelopes. Otherwise a frontend
          // could bypass target checks or attach to the browser-level CDP endpoint.
          if (
            [
              "Target.sendMessageToTarget",
              "Target.attachToBrowserTarget",
              "Target.exposeDevToolsProtocol",
            ].includes(request.method)
          )
            throw new Error("That DevTools command is unavailable.");
          if (
            request.sessionId &&
            (!parents.has(request.sessionId) || blockedSessions.has(request.sessionId))
          )
            throw new Error("That DevTools target is unavailable.");
          if (request.method === "Target.attachToTarget") {
            const targetId = request.params?.targetId;
            if (typeof targetId !== "string") throw new Error("A target is required.");
            const info = await cdp.send("Target.getTargetInfo", { targetId });
            if (
              !info?.targetInfo?.url ||
              info.targetInfo.url.startsWith(`chrome-extension://${AUDIO_EXTENSION_ID}/`)
            )
              throw new Error("That DevTools target is unavailable.");
          }
          // Playwright exposes one CDP session rather than raw flattened messages. Relay child
          // target traffic through Chromium's nested transport and present the flat form DevTools
          // expects to the frontend.
          const params =
            request.method === "Target.setAutoAttach" || request.method === "Target.attachToTarget"
              ? { ...(request.params ?? {}), flatten: false }
              : (request.params ?? {});
          if (request.sessionId) {
            const state = {
              id: request.id,
              sessionId: request.sessionId,
              method: request.method,
              wrappers: new Set(),
              failed: false,
            };
            requests.set(requestKey(state.sessionId, state.id), state);
            let sessionId = request.sessionId;
            let message = { id: request.id, method: request.method, params };
            const visited = new Set();
            try {
              while (parents.get(sessionId)) {
                if (visited.has(sessionId)) throw new Error("Invalid DevTools target hierarchy.");
                visited.add(sessionId);
                const id = --wrapperId;
                state.wrappers.add(id);
                wrappers.set(id, state);
                message = {
                  id,
                  method: "Target.sendMessageToTarget",
                  params: { sessionId, message: JSON.stringify(message) },
                };
                sessionId = parents.get(sessionId);
              }
              await cdp.send("Target.sendMessageToTarget", {
                sessionId,
                message: JSON.stringify(message),
              });
            } catch (error) {
              forgetRequest(state);
              if (state.failed) return;
              throw error;
            }
            return;
          }
          const result = await cdp.send(request.method, params);
          if (request.method === "Target.attachToTarget" && typeof result?.sessionId === "string")
            parents.set(result.sessionId, null);
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ id: request.id, result: result ?? {} }));
        } catch (error) {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(
              JSON.stringify({
                id: request.id,
                ...(request.sessionId ? { sessionId: request.sessionId } : {}),
                error: { code: -32000, message: error?.message ?? String(error) },
              }),
            );
        }
      })();
    });
  });
  return {
    path(projectId, sessionId, tabId) {
      const params = new URLSearchParams({ project: projectId, token });
      if (sessionId) params.set("session", sessionId);
      if (tabId) params.set("tab", tabId);
      return `${DEVTOOLS_SOCKET_PATH}?${params}`;
    },
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      return true;
    },
    async serve(req, res, parts) {
      if (req.method !== "GET" || parts[0] !== "devtools") return false;
      const relative = parts.slice(1);
      if (
        !relative.length ||
        relative.some(
          (part) => part === "." || part === ".." || part.includes("/") || part.includes("\\"),
        )
      ) {
        res.writeHead(404);
        res.end();
        return true;
      }
      const filename = path.join(frontendRoot, ...relative);
      let stat;
      try {
        stat = await fs.stat(filename);
      } catch {
        res.writeHead(404);
        res.end();
        return true;
      }
      if (!stat.isFile()) {
        res.writeHead(404);
        res.end();
        return true;
      }
      res.writeHead(200, {
        "content-type": mime[path.extname(filename)] ?? "application/octet-stream",
        "content-length": stat.size,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      });
      createReadStream(filename)
        .on("error", () => res.destroy())
        .pipe(res);
      return true;
    },
    async close() {
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => wss.close(resolve));
    },
  };
}
