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

test("a burst of log lines is one update, and other news is not held back for it", async () => {
  const hub = createEventHub({ coalesceMs: 5, logsMs: 60, heartbeatMs: 1000 });
  const res = new Response();
  hub.connect(new EventEmitter(), res);
  const sent = (event) => (res.body.match(new RegExp(`event: ${event}`, "g")) ?? []).length;
  for (let i = 0; i < 10; i++) {
    hub.emit("logs:s");
    hub.emit("session:s");
    await new Promise((resolve) => setTimeout(resolve, 3));
  }
  assert.equal(sent("logs"), 0);
  assert.ok(sent("session") >= 1);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(sent("logs"), 1);
  hub.close();
});

test("diff interest is refcounted per project", () => {
  const hub = createEventHub();
  hub.watchDiff("p1");
  hub.watchDiff("p1");
  assert.deepEqual(hub.diffProjects(), ["p1"]);
  hub.unwatchDiff("p1");
  assert.deepEqual(hub.diffProjects(), ["p1"]);
  hub.unwatchDiff("p1");
  assert.deepEqual(hub.diffProjects(), []);
});
