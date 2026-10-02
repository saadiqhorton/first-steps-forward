import assert from "node:assert/strict";
import test from "node:test";
import { migrateDefaultLayout } from "./migrateDefaultLayout.mjs";

const previous = { "shell-main": 74, "shell-right": 26 };
const next = { "shell-main": 56, "shell-right": 44 };

test("migrates the exact untouched previous shell default", () => {
  assert.equal(
    migrateDefaultLayout(JSON.stringify(previous), previous, next),
    JSON.stringify(next),
  );
});

test("preserves a user-adjusted layout", () => {
  const customized = JSON.stringify({ "shell-main": 65, "shell-right": 35 });
  assert.equal(migrateDefaultLayout(customized, previous, next), customized);
});

test("preserves collapsed, partial, and malformed stored layouts", () => {
  for (const stored of ['{"shell-main":100,"shell-right":0}', '{"shell-main":74}', "{"]) {
    assert.equal(migrateDefaultLayout(stored, previous, next), stored);
  }
});

test("leaves an absent stored layout absent", () => {
  assert.equal(migrateDefaultLayout(null, previous, next), null);
});
