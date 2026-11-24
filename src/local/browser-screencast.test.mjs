import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Screencast } from "./browser-screencast.mjs";

function setup(t, options = {}) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const session = new EventEmitter();
  const chromiumAcks = [];
  session.send = async (method, params) => {
    if (method === "Page.screencastFrameAck") chromiumAcks.push(params.sessionId);
  };
  session.detach = async () => {};
  const context = () => ({ newCDPSession: async () => session });
  let ackFrame;
  const stream = new Screencast(
    { context, lastWheelAt: () => -Infinity },
    { maxWidth: 1280, maxHeight: 800, quality: 70, ...options },
    (_jpeg, ack) => {
      ackFrame = ack;
    },
  );
  t.after(() => stream.stop());
  return { stream, session, chromiumAcks, ack: () => ackFrame() };
}

test("an interactive viewer frees Chromium's capture slot as soon as it acknowledges delivery", async (t) => {
  const { stream, session, chromiumAcks, ack } = setup(t);
  await stream.start({});
  session.emit("Page.screencastFrame", { sessionId: 3, data: "AA==" });

  t.mock.timers.tick(50);
  assert.deepEqual(chromiumAcks, []);

  ack();
  ack();
  assert.deepEqual(chromiumAcks, [3]);
});

test("a recording viewer keeps its requested capture pacing", async (t) => {
  const { stream, session, chromiumAcks, ack } = setup(t, { ackPaceMs: 33 });
  await stream.start({});
  session.emit("Page.screencastFrame", { sessionId: 3, data: "AA==" });
  ack();

  t.mock.timers.tick(32);
  assert.deepEqual(chromiumAcks, []);
  t.mock.timers.tick(1);
  assert.deepEqual(chromiumAcks, [3]);
});
