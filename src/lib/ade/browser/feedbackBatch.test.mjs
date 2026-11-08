import test from "node:test";
import assert from "node:assert/strict";
import { feedbackBatchSize } from "./feedbackBatch.mjs";

const limits = { files: 8, fileBytes: 10, turnBytes: 20, recordingBytes: 1000 };
const image = (size) => ({ size, recording: false });
const video = (size) => ({ size, recording: true });
const recording = (file) => file.recording;

test("capture drafts are drained in complete batches that fit", () => {
  const drafts = [
    { files: [video(500), image(3), image(3), image(3), image(3), image(3)] },
    { files: [video(500), image(3), image(3), image(3), image(3), image(3)] },
  ];
  assert.equal(feedbackBatchSize(drafts, 0, 0, limits, recording), 1);
  assert.equal(feedbackBatchSize(drafts.slice(1), 6, 15, limits, recording), 0);
  assert.equal(feedbackBatchSize(drafts.slice(1), 0, 0, limits, recording), 1);
});

test("the batch respects file and turn limits without counting video bytes toward image totals", () => {
  assert.equal(
    feedbackBatchSize([{ files: [video(900), image(10)] }], 0, 10, limits, recording),
    1,
  );
  assert.equal(feedbackBatchSize([{ files: [image(10)] }], 0, 11, limits, recording), 0);
  assert.equal(feedbackBatchSize([{ files: [video(1001)] }], 0, 0, limits, recording), 0);
  assert.equal(feedbackBatchSize([{ files: [image(11)] }], 0, 0, limits, recording), 0);
});
