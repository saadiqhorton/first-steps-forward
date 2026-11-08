import test from "node:test";
import assert from "node:assert/strict";
import { browserPageKey, shouldRevealBrowser } from "./reveal.mjs";

const base = {
  opened: true,
  url: "http://localhost:5173/",
  visible: false,
  place: "dock",
  revealed: false,
};

test("the first page the agent opens floats when the docked browser is off screen", () => {
  assert.equal(shouldRevealBrowser(base), true);
  assert.equal(shouldRevealBrowser({ ...base, place: "hidden" }), true);
});

test("a visible, floating or already-surfaced page is not revealed again", () => {
  assert.equal(shouldRevealBrowser({ ...base, visible: true }), false);
  assert.equal(shouldRevealBrowser({ ...base, place: "float" }), false);
  assert.equal(shouldRevealBrowser({ ...base, revealed: true }), false);
});

test("only real first pages of a tab trigger a reveal", () => {
  assert.equal(shouldRevealBrowser({ ...base, opened: false }), false);
  assert.equal(shouldRevealBrowser({ ...base, url: "about:blank" }), false);
  assert.equal(shouldRevealBrowser({ ...base, url: "" }), false);
  assert.equal(shouldRevealBrowser({ ...base, url: "file:///tmp/a.html" }), false);
});

test("a page key is scoped by conversation, tab and address", () => {
  assert.equal(browserPageKey("p", "s", "tab-1", "http://a.test/"), "p:s:tab-1:http://a.test/");
  assert.notEqual(
    browserPageKey("p", "s", "tab-1", "http://a.test/"),
    browserPageKey("p", "s", "tab-2", "http://a.test/"),
  );
});
