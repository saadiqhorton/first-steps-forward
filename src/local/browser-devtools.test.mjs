import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { createBrowserDevtools } from "./browser-devtools.mjs";
import { AUDIO_EXTENSION_ID } from "./browser-audio.mjs";

test("DevTools relay blocks the private audio worker and raw protocol tunnels", async (t) => {
  const calls = [];
  const cdp = Object.assign(new EventEmitter(), {
    async send(method, params) {
      calls.push({ method, params });
      if (method === "Target.getTargetInfo")
        return {
          targetInfo: {
            url:
              params.targetId === "private"
                ? `chrome-extension://${AUDIO_EXTENSION_ID}/worker.js`
                : "https://example.com/worker.js",
          },
        };
      if (method === "Target.attachToTarget") return { sessionId: "safe-session" };
      return {};
    },
  });
  const devtools = createBrowserDevtools({
    hub: {
      existing: async () => ({
        openDevtools: async () => ({ session: cdp, close: async () => {} }),
      }),
    },
    originAllowed: () => true,
  });
  const server = createServer();
  server.on("upgrade", (req, socket, head) => devtools.handleUpgrade(req, socket, head));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}${devtools.path("project")}`);
  t.after(async () => {
    ws.terminate();
    await devtools.close();
    await new Promise((resolve) => server.close(resolve));
  });
  await once(ws, "open");
  const messages = [];
  ws.on("message", (message) => messages.push(JSON.parse(message.toString())));
  const ask = async (request) => {
    ws.send(JSON.stringify(request));
    const deadline = Date.now() + 2000;
    while (!messages.some((message) => message.id === request.id) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    return messages.find((message) => message.id === request.id);
  };
  assert.match(
    (await ask({ id: 1, method: "Target.attachToTarget", params: { targetId: "private" } })).error
      .message,
    /unavailable/,
  );
  assert.match(
    (await ask({ id: 2, method: "Target.sendMessageToTarget", params: {} })).error.message,
    /unavailable/,
  );
  assert.match(
    (await ask({ id: 3, method: "Target.attachToBrowserTarget" })).error.message,
    /unavailable/,
  );
  assert.deepEqual(
    (await ask({ id: 4, method: "Target.attachToTarget", params: { targetId: "public" } })).result,
    { sessionId: "safe-session" },
  );
  assert.equal(calls.filter((call) => call.method === "Target.attachToTarget").length, 1);
  cdp.emit("event", {
    method: "Target.attachedToTarget",
    params: {
      sessionId: "private-session",
      targetInfo: { url: `chrome-extension://${AUDIO_EXTENSION_ID}/worker.js` },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    messages.some((message) => message.params?.sessionId === "private-session"),
    false,
  );
  assert.ok(
    calls.some(
      (call) =>
        call.method === "Target.detachFromTarget" && call.params.sessionId === "private-session",
    ),
  );
  assert.match(
    (
      await ask({
        id: 5,
        sessionId: "private-session",
        method: "Runtime.evaluate",
        params: { expression: "chrome.tabs.query({})" },
      })
    ).error.message,
    /unavailable/,
  );
});
