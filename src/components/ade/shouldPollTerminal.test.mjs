import assert from "node:assert/strict";
import test from "node:test";
import { shouldPollTerminal } from "./shouldPollTerminal.mjs";

test("hidden pane does not poll", () => {
  assert.equal(shouldPollTerminal({ visible: false, status: "connected" }), false);
});

test("visible connected pane polls", () => {
  assert.equal(shouldPollTerminal({ visible: true, status: "connected" }), true);
});

test("exited or error pane does not poll even when visible", () => {
  assert.equal(shouldPollTerminal({ visible: true, status: "exited" }), false);
  assert.equal(shouldPollTerminal({ visible: true, status: "error" }), false);
});
