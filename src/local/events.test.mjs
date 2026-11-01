import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createEventHub } from "./events.mjs";

class Response extends EventEmitter {
  chunks = [];
  headers = null;
  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  }
  flushHeaders() {}
  write(chunk) {
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.writableEnded = true;
    this.emit("close");
  }
  get body() {
    return this.chunks.join("");
  }
}

test("SSE sends ready and coalesced invalidations, and disconnect removes the client", async () => {
  const hub = createEventHub({ coalesceMs: 5, heartbeatMs: 1000 });
  const req = new EventEmitter();
  const res = new Response();
  hub.connect(req, res, "project-1");
  assert.match(res.headers["content-type"], /text\/event-stream/);
  assert.equal(hub.clientCount(), 1);
  hub.emit("bootstrap");
  hub.emit("bootstrap");
  hub.emit("computer:project-1");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(res.body, /event: ready/);
  assert.equal((res.body.match(/event: bootstrap/g) ?? []).length, 1);
  assert.match(res.body, /event: computer\ndata: \{"scope":"computer:project-1","version":1\}/);
  res.emit("close");
  assert.equal(hub.clientCount(), 0);
  hub.close();
});
