import test from "node:test";
import assert from "node:assert/strict";
import { createSaveQueue } from "./save-queue.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a burst of saves costs two writes, never two at once, and each waits for its own data", async () => {
  let value = 0;
  let active = 0;
  const written = [];
  const queue = createSaveQueue(async () => {
    assert.equal(++active, 1, "writes overlapped");
    const seen = value;
    await wait(10);
    written.push(seen);
    active--;
  });
  const all = [];
  for (let i = 1; i <= 50; i++) {
    value = i;
    all.push(queue.save());
  }
  await Promise.all(all);
  assert.deepEqual(written, [50, 50].slice(0, written.length));
  assert.ok(written.length <= 2);
  assert.equal(written.at(-1), 50);
});

test("a save asked for mid-write is not satisfied by the write already under way", async () => {
  let value = "old";
  const written = [];
  const queue = createSaveQueue(async () => {
    const seen = value;
    await wait(10);
    written.push(seen);
  });
  const first = queue.save();
  await wait(2);
  value = "new";
  await queue.save();
  await first;
  assert.deepEqual(written, ["old", "new"]);
});

test("a failed write rejects its own callers and the next save still runs", async () => {
  let fail = true;
  let writes = 0;
  const queue = createSaveQueue(async () => {
    writes++;
    if (fail) throw new Error("busy");
  });
  await assert.rejects(queue.save(), /busy/);
  fail = false;
  await queue.save();
  assert.equal(writes, 2);
});

test("a background save that fails is reported, never an unhandled rejection", async () => {
  const errors = [];
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  const queue = createSaveQueue(() => Promise.reject(new Error("busy")), {
    delayMs: 1,
    onError: (error) => errors.push(error.message),
  });
  queue.saveSoon();
  queue.saveSoon();
  await wait(20);
  process.off("unhandledRejection", onUnhandled);
  assert.deepEqual(errors, ["busy"]);
  assert.deepEqual(unhandled, []);
});

test("flush writes what a delayed save is holding", async () => {
  let writes = 0;
  const queue = createSaveQueue(async () => void writes++, { delayMs: 60_000 });
  queue.saveSoon();
  await queue.flush();
  assert.equal(writes, 1);
});
