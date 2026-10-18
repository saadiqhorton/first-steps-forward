// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/web/src/components/preview/agentBrowserCursorLogic.test.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_CURSOR_ACTIVE_MS, agentBrowserCursorOpacity } from "./agentCursorLogic.mjs";

test("keeps active movement fully visible", () => {
  assert.equal(agentBrowserCursorOpacity(true, "agent"), 1);
  assert.equal(agentBrowserCursorOpacity(true, "human"), 1);
});

test("settles to a visible idle state", () => {
  assert.equal(agentBrowserCursorOpacity(false, "none"), 0.35);
  assert.equal(agentBrowserCursorOpacity(false, "agent"), 0.35);
});

test("dims further while the human controls the page", () => {
  assert.equal(agentBrowserCursorOpacity(false, "human"), 0.18);
});

test("stays active for 700 ms after an event", () => {
  assert.equal(AGENT_CURSOR_ACTIVE_MS, 700);
});
