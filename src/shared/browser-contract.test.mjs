import test from "node:test";
import assert from "node:assert/strict";
import { clampViewport } from "./browser-contract.mjs";

test("clampViewport keeps sizes inside 240..3840 x 240..2160 and rounds", () => {
  assert.deepEqual(clampViewport({ width: 100, height: 99 }), { width: 240, height: 240 });
  assert.deepEqual(clampViewport({ width: 5000, height: 3000 }), { width: 3840, height: 2160 });
  assert.deepEqual(clampViewport({ width: 1023.6, height: 767.2 }), { width: 1024, height: 767 });
  assert.throws(() => clampViewport({ width: Number.NaN, height: 800 }), TypeError);
});
