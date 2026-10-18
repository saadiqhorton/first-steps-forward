// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/web/src/components/preview/previewMiniPlayerLayout.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
//
// Geometry for the floating browser preview. ADE has no composer or details card, so the
// T3 obstacle avoidance is left out; everything else follows the T3 numbers.

export const MINI_PLAYER_EDGE_GAP = 12;
export const MINI_PLAYER_CORNER_RADIUS = 12;
// Above the pane content and below dialogs.
export const MINI_PLAYER_Z_INDEX = 48;
const DEFAULT_BOX = { width: 320, height: 320 };
const MIN_SIZE = { width: 240, height: 150 };

/**
 * Width at which a new player opens: as large as fits a 320x320 box at the source aspect ratio.
 * @param {{ width: number, height: number }} source
 */
function defaultWidth(source) {
  return Math.min(DEFAULT_BOX.width, (DEFAULT_BOX.height * source.width) / source.height);
}

/**
 * Round a desired width to a size that keeps the source aspect ratio, inside the minimum and
 * the maximum box.
 * @param {number} desiredWidth
 * @param {{ width: number, height: number }} source
 * @param {{ width: number, height: number }} max
 * @returns {{ width: number, height: number }}
 */
function fitWidth(desiredWidth, source, max) {
  const aspectRatio = source.width / source.height;
  const width = Math.min(
    Math.max(desiredWidth, MIN_SIZE.width, MIN_SIZE.height * aspectRatio),
    Math.max(1, max.width),
    Math.max(1, max.height * aspectRatio),
  );
  return { width: Math.round(width), height: Math.round(width / aspectRatio) };
}

/**
 * Keep a player fully inside the container, with the edge gap on every side. The minimum x
 * lets callers keep the player off a sidebar.
 * @param {{ x: number, y: number }} position
 * @param {{ width: number, height: number }} container
 * @param {{ width: number, height: number }} player
 * @param {number} [minimumX]
 * @returns {{ x: number, y: number }}
 */
export function clampMiniPlayerPosition(
  position,
  container,
  player,
  minimumX = MINI_PLAYER_EDGE_GAP,
) {
  const gap = MINI_PLAYER_EDGE_GAP;
  return {
    x: Math.min(
      Math.max(position.x, minimumX, gap),
      Math.max(gap, container.width - player.width - gap),
    ),
    y: Math.min(Math.max(position.y, gap), Math.max(gap, container.height - player.height - gap)),
  };
}

/**
 * Resolve the rendered frame for a player. The stored width is never written back here: a
 * temporarily narrow container shrinks the frame, and the user's chosen width comes back when
 * the container grows again.
 * @param {{
 *   width: number | null,
 *   position: { x: number, y: number } | null,
 *   source: { width: number, height: number },
 *   container: { width: number, height: number },
 * }} input
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function resolveMiniPlayerFrame({ width, position, source, container }) {
  const gap = MINI_PLAYER_EDGE_GAP;
  const size = fitWidth(width ?? defaultWidth(source), source, {
    width: container.width - gap * 2,
    height: container.height - gap * 2,
  });
  const anchored = position ?? {
    x: container.width - gap - size.width,
    y: gap,
  };
  return { ...clampMiniPlayerPosition(anchored, container, size), ...size };
}

/**
 * @typedef {"north" | "south" | "east" | "west" | "northeast" | "northwest" | "southeast" | "southwest"} MiniPlayerResizeDirection
 */

/**
 * Resize a player from one edge or corner. Edges opposite the drag stay anchored. A corner
 * drag projects onto the aspect-ratio diagonal, so the frame keeps its shape.
 * @param {{
 *   start: { x: number, y: number, width: number, height: number },
 *   direction: MiniPlayerResizeDirection,
 *   delta: { x: number, y: number },
 *   source: { width: number, height: number },
 *   container: { width: number, height: number },
 * }} input
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function resizeMiniPlayer({ start, direction, delta, source, container }) {
  const gap = MINI_PLAYER_EDGE_GAP;
  const east = direction.includes("east");
  const west = direction.includes("west");
  const north = direction.includes("north");
  const south = direction.includes("south");
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const max = {
    width: west ? right - gap : east ? container.width - gap - start.x : container.width - gap * 2,
    height: north
      ? bottom - gap
      : south
        ? container.height - gap - start.y
        : container.height - gap * 2,
  };
  const desiredWidth = start.width + (east ? delta.x : west ? -delta.x : 0);
  const desiredHeight = start.height + (south ? delta.y : north ? -delta.y : 0);
  const horizontal = east || west;
  const vertical = north || south;
  const aspectRatio = source.width / source.height;
  // Project corner motion onto the aspect-ratio diagonal. Switching between dominant axes
  // would otherwise jump when one axis grows while the other shrinks.
  const desired =
    horizontal && vertical
      ? (desiredWidth + desiredHeight / aspectRatio) / (1 + 1 / aspectRatio ** 2)
      : horizontal
        ? desiredWidth
        : desiredHeight * aspectRatio;
  const size = fitWidth(desired, source, max);
  const position = clampMiniPlayerPosition(
    { x: west ? right - size.width : start.x, y: north ? bottom - size.height : start.y },
    container,
    size,
  );
  return { ...position, ...size };
}
