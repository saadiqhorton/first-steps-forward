import test from "node:test";
import assert from "node:assert/strict";
import { extractFailures } from "./checks.mjs";

test("spec failure excerpts include assertion diffs from failed tests only", () => {
  const output = [
    "✔ passing test (1ms)",
    "✖ failing tests:",
    "test at example.test.mjs:1:1",
    "✖ preserves the newline (2ms)",
    "  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
    "  + actual - expected",
    "  + 'hello'",
    "  - 'hello\\n'",
    "      at TestContext.<anonymous> (example.test.mjs:2:1)",
    "test at example.test.mjs:4:1",
    "✖ another failure (1ms)",
    "  Error: boom",
  ].join("\n");
  assert.deepEqual(extractFailures("test", output), [
    "preserves the newline: AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
    "+ actual - expected",
    "+ 'hello'",
    "- 'hello\\n'",
    "another failure: Error: boom",
  ]);
});

test("TAP failure excerpts include diagnostics without passing test output", () => {
  const output = [
    "not ok 1 - preserves the newline",
    "  ---",
    "  expected: 'hello\\n'",
    "  actual: 'hello'",
    "  ...",
    "ok 2 - passing test",
    "  expected: should not appear",
    "# pass 1",
  ].join("\n");
  assert.deepEqual(extractFailures("test", output), [
    "preserves the newline",
    "expected: 'hello\\n'",
    "actual: 'hello'",
  ]);
});
