// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/server/src/preview/SessionControl.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BrowserClosedError,
  createControlRegistry,
  HumanControlError,
} from "./browser-control.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

test("agent work runs while nobody has control", async () => {
  const control = createControlRegistry().for("p1");
  assert.deepEqual(control.state(), { owner: null, generation: 0 });
  assert.equal(await control.agent(async () => "ok"), "ok");
});

test("agent work is rejected with human_control while a human owns control", async () => {
  const control = createControlRegistry().for("p1");
  control.take("A");
  await assert.rejects(
    control.agent(async () => "never"),
    (error) => {
      assert.ok(error instanceof HumanControlError);
      assert.equal(error.code, "human_control");
      assert.match(error.message, /Wait for them to hand control back/);
      return true;
    },
  );
});

test("human work runs only for the owner and is ignored for anyone else", async () => {
  const control = createControlRegistry().for("p1");
  let calls = 0;
  const run = async () => {
    calls++;
    return "did";
  };
  assert.equal(await control.human("A", run), undefined);
  control.take("A");
  assert.equal(await control.human("B", run), undefined);
  assert.equal(await control.human("A", run), "did");
  assert.equal(calls, 1);
});

test("take by another viewer throws while a viewer owns control", () => {
  const control = createControlRegistry().for("p1");
  control.take("A");
  assert.throws(() => control.take("B"), HumanControlError);
  assert.equal(control.state().owner, "A");
});

test("release by a non-owner is a no-op", () => {
  const control = createControlRegistry().for("p1");
  control.take("A");
  const before = control.state();
  assert.deepEqual(control.release("B"), before);
  assert.equal(control.state().owner, "A");
});

test("generation increments on every ownership change", () => {
  const control = createControlRegistry().for("p1");
  assert.equal(control.take("A").generation, 1);
  assert.equal(control.take("A").generation, 1, "re-taking as owner changes nothing");
  assert.equal(control.release("A").generation, 2);
  assert.deepEqual(control.state(), { owner: null, generation: 2 });
});

test("subscribe fires on take and release and stops after unsubscribe", () => {
  const control = createControlRegistry().for("p1");
  const seen = [];
  const off = control.subscribe((state) => seen.push(state));
  control.take("A");
  control.release("A");
  off();
  control.take("B");
  assert.deepEqual(seen, [
    { owner: "A", generation: 1 },
    { owner: null, generation: 2 },
  ]);
});

test("human work waits for in-flight agent work to drain before running", async () => {
  const control = createControlRegistry().for("p1");
  const log = [];
  const started = deferred();
  const finish = deferred();
  const agentWork = control.agent(async () => {
    started.resolve();
    await finish.promise;
    log.push("agent");
  });
  await started.promise;
  control.take("A");
  finish.resolve();
  await control.human("A", async () => log.push("human"));
  await agentWork;
  assert.deepEqual(log, ["agent", "human"]);
});

test("agent work queued behind a running action is rejected once a take changes the epoch", async () => {
  const control = createControlRegistry().for("p1");
  const log = [];
  const started = deferred();
  const finish = deferred();
  const first = control.agent(async () => {
    started.resolve();
    await finish.promise;
    log.push("first");
  });
  await started.promise;
  const second = control
    .agent(async () => log.push("second"))
    .then(
      () => "ran",
      (error) => error,
    );
  control.take("A");
  finish.resolve();
  await first;
  assert.ok((await second) instanceof HumanControlError);
  assert.deepEqual(log, ["first"]);
});

test("release runs afterDrain once work queued before the release has drained", async () => {
  const control = createControlRegistry().for("p1");
  const log = [];
  control.take("A");
  await control.human("A", async () => log.push("input"));
  control.release("A", async () => log.push("afterDrain"));
  await control.agent(async () => log.push("agent"));
  assert.deepEqual(log, ["input", "afterDrain", "agent"]);
});

test("registry returns one control per project and delete releases the owner", async () => {
  const registry = createControlRegistry();
  const first = registry.for("p1");
  assert.equal(registry.for("p1"), first);
  assert.notEqual(registry.for("p2"), first);
  first.take("A");
  await registry.delete("p1");
  assert.equal(first.state().owner, null);
  await assert.rejects(
    first.agent(async () => "never"),
    (error) => {
      assert.ok(error instanceof BrowserClosedError);
      assert.equal(error.code, "browser_closed");
      assert.notEqual(error.code, "human_control");
      return true;
    },
  );
  assert.notEqual(registry.for("p1"), first, "a deleted project gets a fresh control");
});
