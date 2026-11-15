import test from "node:test";
import assert from "node:assert/strict";
import { composerTrigger, replaceComposerTrigger } from "./composerSuggestions.mjs";

test("finds slash commands and project references at the caret", () => {
  assert.deepEqual(composerTrigger("Please /review", 14), {
    kind: "command",
    query: "review",
    start: 7,
    end: 14,
  });
  assert.deepEqual(composerTrigger("Look at @src/app", 16), {
    kind: "reference",
    query: "src/app",
    start: 8,
    end: 16,
  });
  assert.equal(composerTrigger("name@example.com", 16), null);
  assert.equal(composerTrigger("https://example.com", 19), null);
  assert.equal(composerTrigger("a/b", 3), null);
});

test("replaces the active token without losing surrounding draft text", () => {
  const draft = "Check @some and continue";
  const trigger = composerTrigger(draft, 11);
  assert.deepEqual(replaceComposerTrigger(draft, trigger, '"some folder/"'), {
    text: 'Check "some folder/" and continue',
    caret: 20,
  });
  assert.deepEqual(
    replaceComposerTrigger("/review", composerTrigger("/review", 7), "Review the code."),
    {
      text: "Review the code. ",
      caret: 17,
    },
  );
});
