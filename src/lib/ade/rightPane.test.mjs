import test from "node:test";
import assert from "node:assert/strict";
import { LUNA_HIDDEN_RIGHT_TABS, isAssistantPath, isRightTabVisible } from "./rightPane.mjs";

const ALL_TABS = ["activity", "diff", "computer", "terminal", "processes"];

test("isAssistantPath: only Luna's chat routes count", () => {
  assert.equal(isAssistantPath("/workspace/assistant"), true);
  assert.equal(isAssistantPath("/workspace/assistant/thread-1"), true);
  // Other workspace pages own the whole window, so they never render the pane.
  assert.equal(isAssistantPath("/workspace"), false);
  assert.equal(isAssistantPath("/workspace/inbox"), false);
  assert.equal(isAssistantPath("/workspace/assistant-report"), false);
  assert.equal(isAssistantPath("/p/spec-flow/conversations/s1"), false);
});

test("Luna hides Diff and Terminal, and only those", () => {
  const lunaTabs = ALL_TABS.filter((tab) => isRightTabVisible("/workspace/assistant/t1", tab));
  assert.deepEqual(lunaTabs, ["activity", "computer", "processes"]);
  assert.deepEqual([...LUNA_HIDDEN_RIGHT_TABS].sort(), ["diff", "terminal"]);
});

test("project conversations keep every right-pane tab", () => {
  for (const pathname of ["/p/spec-flow/conversations", "/p/spec-flow/conversations/s1"]) {
    assert.deepEqual(
      ALL_TABS.filter((tab) => isRightTabVisible(pathname, tab)),
      ALL_TABS,
    );
  }
});
