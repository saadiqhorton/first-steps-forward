import assert from "node:assert/strict";
import test from "node:test";
import { streamWanted } from "./streamWanted.mjs";

test("a docked canvas that is not visible does not want the stream", () => {
  assert.equal(
    streamWanted({
      projectId: "p1",
      resting: false,
      place: "dock",
      canvas: {},
      visible: false,
      recording: false,
    }),
    false,
  );
});

test("float and recording still want the stream when docked canvas is hidden", () => {
  assert.equal(
    streamWanted({
      projectId: "p1",
      resting: false,
      place: "float",
      canvas: null,
      visible: false,
      recording: false,
    }),
    true,
  );
  assert.equal(
    streamWanted({
      projectId: "p1",
      resting: false,
      place: "dock",
      canvas: null,
      visible: false,
      recording: true,
    }),
    true,
  );
});

test("a visible docked canvas wants the stream", () => {
  assert.equal(
    streamWanted({
      projectId: "p1",
      resting: false,
      place: "dock",
      canvas: {},
      visible: true,
      recording: false,
    }),
    true,
  );
});

test("resting or missing project does not want the stream", () => {
  assert.equal(
    streamWanted({
      projectId: null,
      resting: false,
      place: "float",
      canvas: null,
      visible: true,
      recording: false,
    }),
    false,
  );
  assert.equal(
    streamWanted({
      projectId: "p1",
      resting: true,
      place: "float",
      canvas: {},
      visible: true,
      recording: true,
    }),
    false,
  );
});
