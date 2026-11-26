import assert from "node:assert/strict";
import test from "node:test";
import { createDiffInterestController } from "./diffInterest.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Net watch depth from an ordered call log (true = +1, false = −1). */
function netDepth(calls) {
  let depth = 0;
  for (const c of calls) {
    depth += c.diff ? 1 : -1;
    assert.ok(depth >= 0, `refcount went negative at ${JSON.stringify(c)}`);
  }
  return depth;
}

test("unwatch that races ahead of watch does not leave interest true", async () => {
  const calls = [];
  /** @type {ReturnType<typeof deferred>[]} */
  const gates = [];
  const post = async (projectId, diff) => {
    const gate = deferred();
    gates.push({ gate, projectId, diff });
    await gate.promise;
    calls.push({ projectId, diff });
  };

  const ctrl = createDiffInterestController(post);
  // Start watch and let its POST begin (gate held open).
  const stop = ctrl.watch("p1");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(gates.length, 1);
  assert.equal(gates[0].diff, true);

  // Cleanup while watch POST is in flight — release order will be true then false.
  stop();
  gates[0].gate.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(gates.length >= 2);
  assert.equal(gates[1].diff, false);
  gates[1].gate.resolve();
  await ctrl.idle();

  assert.equal(netDepth(calls), 0);
  assert.deepEqual(calls.at(-1), { projectId: "p1", diff: false });
});

test("superseded watch is skipped so cleanup alone cannot be undone by a late true", async () => {
  const calls = [];
  const post = async (projectId, diff) => {
    calls.push({ projectId, diff });
  };

  const ctrl = createDiffInterestController(post);
  const stop = ctrl.watch("p1");
  // Same-turn cleanup before the watch POST runs (Strict Mode / fast churn).
  stop();
  await ctrl.idle();

  assert.equal(netDepth(calls), 0);
  assert.ok(
    !calls.some((c) => c.diff) || calls.at(-1)?.diff === false,
    "must not end with interest true",
  );
});

test("remount after cleanup leaves a single live watch", async () => {
  const calls = [];
  const post = async (projectId, diff) => {
    calls.push({ projectId, diff });
  };

  const ctrl = createDiffInterestController(post);
  const stop1 = ctrl.watch("p1");
  stop1();
  ctrl.watch("p1");
  await ctrl.idle();

  assert.equal(netDepth(calls), 1);
});

test("remount after a completed watch pairs unwatch then watch", async () => {
  const calls = [];
  const post = async (projectId, diff) => {
    calls.push({ projectId, diff });
  };

  const ctrl = createDiffInterestController(post);
  const stop1 = ctrl.watch("p1");
  await ctrl.idle();
  assert.equal(netDepth(calls), 1);

  stop1();
  ctrl.watch("p1");
  await ctrl.idle();

  assert.deepEqual(calls, [
    { projectId: "p1", diff: true },
    { projectId: "p1", diff: false },
    { projectId: "p1", diff: true },
  ]);
  assert.equal(netDepth(calls), 1);
});
