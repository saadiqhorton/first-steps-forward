// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/web/src/components/preview/agentBrowserCursorLogic.ts
// (and the 700 ms active window from apps/web/src/components/preview/AgentBrowserCursor.tsx).
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.

/** How long the agent cursor stays fully visible after its last pointer event. */
export const AGENT_CURSOR_ACTIVE_MS = 700;

/**
 * Opacity of the agent cursor overlay. Active movement is fully visible. At rest it settles
 * to a faint mark, dimmer while a person is driving the page.
 * @param {boolean} active
 * @param {"human" | "agent" | "none"} controller
 * @returns {number}
 */
export function agentBrowserCursorOpacity(active, controller) {
  if (active) return 1;
  return controller === "human" ? 0.18 : 0.35;
}
