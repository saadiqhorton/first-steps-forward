import assert from "node:assert/strict";
import test from "node:test";
import { selectionMode, threadSelection } from "./workspaceChatSelection.mjs";

test("a thread saved as Work opens as Work, not Chat", () => {
  const work = { agentId: "pi", model: "luna", effort: "high", permission: "build" };
  assert.deepEqual(threadSelection(work), {
    agentId: "pi",
    model: "luna",
    effort: "high",
    speed: "",
    permission: "build",
  });
  assert.equal(selectionMode(threadSelection(work)), "work");
});

test("a thread saved as Plan opens as Chat", () => {
  const chat = { agentId: "codex", permission: "plan" };
  assert.equal(threadSelection(chat).permission, "plan");
  assert.equal(selectionMode(threadSelection(chat)), "chat");
});

test("a thread with no saved permission reads as Chat", () => {
  assert.deepEqual(threadSelection({}), {
    agentId: "",
    model: "",
    effort: "",
    speed: "",
    permission: "plan",
  });
  assert.equal(selectionMode({}), "chat");
  assert.equal(selectionMode({ permission: "acceptEdits" }), "work");
});
