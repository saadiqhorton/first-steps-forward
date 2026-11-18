import test from "node:test";
import assert from "node:assert/strict";
import { grok, grokAuthenticated, parseGrokModels } from "./grok.adapter.mjs";

test("Grok launches its own ACP agent and uses xAI's npm package", () => {
  assert.deepEqual(grok.command(), ["grok", ["agent", "stdio"]]);
  assert.deepEqual(grok.harness.install, ["npm", ["install", "-g", "@xai-official/grok"]]);
  assert.deepEqual(grok.harness.update, ["npm", ["install", "-g", "@xai-official/grok@latest"]]);
  assert.deepEqual(grok.acpAuth().meta, { headless: true });
});

test("Grok auth requires a positive CLI status, not just a successful model list", async () => {
  const sample =
    "You are not authenticated.\n\nDefault model: grok-4.6\n\nAvailable models:\n  * grok-4.6 (default)\n  - grok-4.5\n";
  const seen = [];
  const result = await grok.detectAuth(async (...args) => {
    seen.push(args);
    return { code: 0, stdout: sample };
  });
  assert.deepEqual(result, { signedIn: false });
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0].slice(0, 2), ["grok", ["models"]]);
  assert.deepEqual(parseGrokModels(sample), [{ id: "grok-4.6" }, { id: "grok-4.5" }]);
  assert.equal(parseGrokModels("not a catalog"), null);
  assert.equal(grokAuthenticated("You are using XAI_API_KEY."), true);
  assert.equal(grokAuthenticated("You are logged in with grok.com."), true);
  assert.equal(grokAuthenticated("Model 'custom' is using its own API key."), true);
  assert.equal(grokAuthenticated("You are authenticated via deployment key."), true);
  assert.equal(grokAuthenticated("You are not authenticated."), false);
});

test("Grok rechecks a stale sign-in banner after the CLI refreshes its token", async () => {
  let calls = 0;
  const result = await grok.detectAuth(async () => ({
    code: 0,
    stdout: ++calls === 1 ? "You are not authenticated." : "You are logged in with grok.com.",
  }));
  assert.deepEqual(result, { signedIn: true, account: "Grok account" });
  assert.equal(calls, 2);
});
