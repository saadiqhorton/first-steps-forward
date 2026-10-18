// Adapted from T3 Code (https://github.com/pingdotgg/t3code): see the matching .mjs file for the source paths.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
export type MiniPlayerResizeDirection =
  "north" | "south" | "east" | "west" | "northeast" | "northwest" | "southeast" | "southwest";

export interface MiniPlayerSize {
  readonly width: number;
  readonly height: number;
}

export interface MiniPlayerPosition {
  readonly x: number;
  readonly y: number;
}

export interface MiniPlayerFrame extends MiniPlayerPosition, MiniPlayerSize {}

export const MINI_PLAYER_EDGE_GAP: number;
export const MINI_PLAYER_CORNER_RADIUS: number;
export const MINI_PLAYER_Z_INDEX: number;

export function clampMiniPlayerPosition(
  position: MiniPlayerPosition,
  container: MiniPlayerSize,
  player: MiniPlayerSize,
  minimumX?: number,
): MiniPlayerPosition;

export function resolveMiniPlayerFrame(input: {
  readonly width: number | null;
  readonly position: MiniPlayerPosition | null;
  readonly source: MiniPlayerSize;
  readonly container: MiniPlayerSize;
}): MiniPlayerFrame;

export function resizeMiniPlayer(input: {
  readonly start: MiniPlayerFrame;
  readonly direction: MiniPlayerResizeDirection;
  readonly delta: MiniPlayerPosition;
  readonly source: MiniPlayerSize;
  readonly container: MiniPlayerSize;
}): MiniPlayerFrame;
