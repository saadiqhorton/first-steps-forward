import assert from "node:assert/strict";
import test from "node:test";
import { noVncPassword, noVncWebSocketUrl } from "./noVncConnection.mjs";

test("uses the viewer host and port for the WebSocket without leaking its password", () => {
  const viewer = "http://127.0.0.1:38297/vnc.html?password=secret&view_only=1";
  assert.equal(noVncWebSocketUrl(viewer), "ws://127.0.0.1:38297/websockify");
  assert.equal(noVncPassword(viewer), "secret");
});

test("uses secure WebSockets for secure viewer origins", () => {
  assert.equal(
    noVncWebSocketUrl("https://vnc.example.test:444/viewer?password=pw"),
    "wss://vnc.example.test:444/websockify",
  );
});
