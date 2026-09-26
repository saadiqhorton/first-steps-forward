import test from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, retryHint } from "./classify.mjs";

test("quota wording from the provider is classified as provider_quota", () => {
  assert.equal(classifyFailure(["You've hit your usage limit."]), "provider_quota");
  assert.equal(classifyFailure(["rate limit exceeded, retry later"]), "provider_quota");
  assert.equal(classifyFailure(["insufficient credits on account"]), "provider_quota");
});

test("ordinary CLI failures stay classified as process", () => {
  assert.equal(classifyFailure(["error: could not spawn"]), "process");
  assert.equal(classifyFailure([]), "process");
  assert.equal(classifyFailure(undefined), "process");
});

test("quota is detected even when mixed with other output", () => {
  assert.equal(
    classifyFailure(["stream closed", "You've hit your usage limit. Upgrade to Pro."]),
    "provider_quota",
  );
});

test("retryHint extracts the provider's own retry wording", () => {
  assert.equal(
    retryHint(["try again at Sep 26th, 2026 2:31 AM."]),
    "try again at Sep 26th, 2026 2:31 AM",
  );
  assert.equal(retryHint(["no hint here"]), undefined);
});
