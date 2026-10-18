// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/web/src/components/preview/previewMiniPlayerLayout.test.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
import assert from "node:assert/strict";
import test from "node:test";
import {
  clampMiniPlayerPosition,
  MINI_PLAYER_EDGE_GAP,
  resizeMiniPlayer,
  resolveMiniPlayerFrame,
} from "./miniPlayerLayout.mjs";

const container = { width: 1000, height: 700 };
const source = { width: 1600, height: 1000 };
const gap = MINI_PLAYER_EDGE_GAP;

test("opens at the source aspect ratio inside a 320x320 box in the top-right corner", () => {
  assert.deepEqual(resolveMiniPlayerFrame({ width: null, position: null, source, container }), {
    x: 668,
    y: gap,
    width: 320,
    height: 200,
  });
});

test("floats a tall source at the minimum width instead of the default box", () => {
  assert.deepEqual(
    resolveMiniPlayerFrame({
      width: null,
      position: null,
      source: { width: 390, height: 844 },
      container,
    }),
    { x: 748, y: gap, width: 240, height: 519 },
  );
});

test("derives height from the stored width and keeps a stored position", () => {
  assert.deepEqual(
    resolveMiniPlayerFrame({ width: 480, position: { x: 100, y: 80 }, source, container }),
    { x: 100, y: 80, width: 480, height: 300 },
  );
});

test("clamps a stored width without writing it back", () => {
  const narrow = { width: 400, height: 300 };
  const squeezed = resolveMiniPlayerFrame({
    width: 800,
    position: { x: 100, y: 80 },
    source,
    container: narrow,
  });
  assert.equal(squeezed.width, 376);
  assert.ok(squeezed.x >= gap && squeezed.x + squeezed.width <= narrow.width - gap);
  assert.ok(squeezed.y >= gap && squeezed.y + squeezed.height <= narrow.height - gap);

  const restored = resolveMiniPlayerFrame({
    width: 800,
    position: { x: 100, y: 80 },
    source,
    container,
  });
  assert.equal(restored.width, 800);
  assert.equal(restored.height, 500);
});

test("clamps a dragged position inside the container with the edge gap", () => {
  assert.deepEqual(
    clampMiniPlayerPosition({ x: 900, y: -40 }, container, { width: 360, height: 240 }),
    { x: 628, y: gap },
  );
});

test("honours a minimum x so the player can stay off a sidebar", () => {
  assert.deepEqual(
    clampMiniPlayerPosition({ x: 0, y: 0 }, container, { width: 360, height: 240 }, 200),
    { x: 200, y: gap },
  );
});

test("keeps the aspect ratio when dragging the right edge", () => {
  assert.deepEqual(
    resizeMiniPlayer({
      start: { x: 300, y: 200, width: 320, height: 200 },
      direction: "east",
      delta: { x: 160, y: 0 },
      source,
      container,
    }),
    { x: 300, y: 200, width: 480, height: 300 },
  );
});

test("anchors the right edge when dragging from the west", () => {
  assert.deepEqual(
    resizeMiniPlayer({
      start: { x: 300, y: 200, width: 320, height: 200 },
      direction: "west",
      delta: { x: -160, y: 0 },
      source,
      container,
    }),
    { x: 140, y: 200, width: 480, height: 300 },
  );
});

test("anchors the bottom edge when dragging the north edge up", () => {
  assert.deepEqual(
    resizeMiniPlayer({
      start: { x: 300, y: 200, width: 320, height: 200 },
      direction: "north",
      delta: { x: 0, y: -100 },
      source,
      container,
    }),
    { x: 300, y: 100, width: 480, height: 300 },
  );
});

test("projects corner motion onto the aspect-ratio diagonal", () => {
  assert.deepEqual(
    resizeMiniPlayer({
      start: { x: 300, y: 200, width: 320, height: 200 },
      direction: "southeast",
      delta: { x: 20, y: 100 },
      source,
      container,
    }),
    { x: 300, y: 200, width: 379, height: 237 },
  );
});

test("does not jump when corner motion crosses the dominant axis", () => {
  const widths = [-99, -100, -101].map(
    (y) =>
      resizeMiniPlayer({
        start: { x: 300, y: 200, width: 320, height: 200 },
        direction: "southeast",
        delta: { x: 160, y },
        source,
        container,
      }).width,
  );
  assert.ok(Math.abs(widths[0] - widths[2]) <= 2);
});

test("respects the minimum size", () => {
  assert.deepEqual(
    resizeMiniPlayer({
      start: { x: 300, y: 200, width: 320, height: 200 },
      direction: "southeast",
      delta: { x: -300, y: -300 },
      source,
      container,
    }),
    { x: 300, y: 200, width: 240, height: 150 },
  );
});
