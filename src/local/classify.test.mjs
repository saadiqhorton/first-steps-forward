import test from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, modelSuggestion, retryHint } from "./classify.mjs";

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

test("model rejections are classified as model_not_found", () => {
  assert.equal(classifyFailure(['error: unknown model "gpt-99-turbo"']), "model_not_found");
  assert.equal(classifyFailure(["Model not found: opencode-go/nonexistent"]), "model_not_found");
  assert.equal(
    classifyFailure(['{"name":"ModelNotFoundError","data":{"message":"..."}}']),
    "model_not_found",
  );
  assert.equal(
    classifyFailure(["the requested model is not available on your account"]),
    "model_not_found",
  );
  assert.equal(classifyFailure(['No models matching "claude-x"']), "model_not_found");
  // OpenCode's uncaught provider rejection prints a bare error class name.
  assert.equal(
    classifyFailure(["ProviderModelNotFoundError: ProviderModelNotFoundError"]),
    "model_not_found",
  );
  assert.equal(
    classifyFailure(["model gpt-6-astra is not on your plan, upgrade to continue"]),
    "model_not_found",
  );
  assert.equal(
    classifyFailure(["invalid model 'gpt-5.9': not a supported model"]),
    "model_not_found",
  );
});

test("provider and auth failures get their own recoverable kinds", () => {
  assert.equal(classifyFailure(["No providers are available"]), "provider_unavailable");
  assert.equal(
    classifyFailure(["No models are available for provider: github-copilot"]),
    "provider_unavailable",
  );
  assert.equal(classifyFailure(["Failed to initialize provider"]), "provider_unavailable");
  assert.equal(classifyFailure(['{"name":"ProviderAuthError"}']), "auth_expired");
  assert.equal(classifyFailure(["Unauthorized: request was blocked"]), "auth_expired");
  assert.equal(classifyFailure(["API error 401: unauthorized"]), "auth_expired");
});

test("context overflow is its own recoverable kind", () => {
  assert.equal(classifyFailure(["error: context_length_exceeded"]), "context_overflow");
  assert.equal(classifyFailure(["Input exceeds context window of this model"]), "context_overflow");
});

test("opencode's quota error names stay provider_quota", () => {
  assert.equal(classifyFailure(['{"error":{"code":"insufficient_quota"}}']), "provider_quota");
  assert.equal(classifyFailure(["FreeUsageLimitError: free tier exhausted"]), "provider_quota");
  assert.equal(classifyFailure(["GoUsageLimitError: limit reached"]), "provider_quota");
});

test("quota wording still wins over model wording when both appear", () => {
  assert.equal(
    classifyFailure(["Model not found: gpt-99", "you have hit your usage limit"]),
    "provider_quota",
  );
});

test("modelSuggestion extracts the provider's own did-you-mean line verbatim", () => {
  assert.equal(
    modelSuggestion([
      "Model not found: opencode-go/gpt-5.6-lun",
      "Did you mean: opencode-go/gpt-5.6-luna, opencode-go/gpt-6-luna?",
    ]),
    "Did you mean: opencode-go/gpt-5.6-luna, opencode-go/gpt-6-luna?",
  );
  assert.equal(modelSuggestion(["no suggestion here"]), undefined);
});

test("retryHint extracts the provider's own retry wording", () => {
  assert.equal(
    retryHint(["try again at Sep 26th, 2026 2:31 AM."]),
    "try again at Sep 26th, 2026 2:31 AM",
  );
  assert.equal(retryHint(["no hint here"]), undefined);
});
