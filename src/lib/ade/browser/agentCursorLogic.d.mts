// Adapted from T3 Code (https://github.com/pingdotgg/t3code): see the matching .mjs file for the source paths.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
export type BrowserCursorController = "human" | "agent" | "none";

export const AGENT_CURSOR_ACTIVE_MS: number;

export function agentBrowserCursorOpacity(
  active: boolean,
  controller: BrowserCursorController,
): number;
