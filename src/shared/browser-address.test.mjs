import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBrowserUrl,
  resolveAddressBarInput,
  resolveSearchUrlTemplate,
  isValidSearchUrlTemplate,
} from "./browser-address.mjs";

test("normalizeBrowserUrl adds https to bare hosts and http to loopback", () => {
  assert.equal(normalizeBrowserUrl("example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(normalizeBrowserUrl("  localhost:5173  "), "http://localhost:5173/");
  assert.equal(normalizeBrowserUrl("127.0.0.1:8080/x"), "http://127.0.0.1:8080/x");
  assert.equal(normalizeBrowserUrl("http://example.com"), "http://example.com/");
});

test("normalizeBrowserUrl refuses empty input and non-web schemes", () => {
  assert.throws(() => normalizeBrowserUrl("   "), /Enter a URL/);
  assert.throws(() => normalizeBrowserUrl("file:///etc/passwd"), /Only http and https/);
  assert.throws(
    () => normalizeBrowserUrl("javascript:alert(1)"),
    /Only http and https|not a valid/,
  );
});

test("normalizeBrowserUrl rejects bad input with code invalid_url", () => {
  for (const input of ["", "   ", "file:///etc/passwd", "http://exa mple.com"]) {
    assert.throws(
      () => normalizeBrowserUrl(input),
      (error) => error.code === "invalid_url",
      `input ${JSON.stringify(input)}`,
    );
  }
});

test("the address bar searches text and keeps typed addresses and unsupported schemes distinct", () => {
  assert.equal(
    resolveAddressBarInput("how to center a div"),
    "https://duckduckgo.com/?q=how%20to%20center%20a%20div",
  );
  assert.equal(resolveAddressBarInput("weather"), "https://duckduckgo.com/?q=weather");
  assert.equal(resolveAddressBarInput("example.com/a"), "example.com/a");
  assert.equal(resolveAddressBarInput("localhost:5173"), "localhost:5173");
  assert.equal(
    normalizeBrowserUrl(resolveAddressBarInput("localhost:3000/?next=https://example.com")),
    "http://localhost:3000/?next=https://example.com",
  );
  assert.throws(() => normalizeBrowserUrl(resolveAddressBarInput("ftp:21")), /Only http and https/);
});

test("search engines and custom templates keep queries out of URL authorities", () => {
  assert.equal(
    resolveAddressBarInput("hello there", resolveSearchUrlTemplate("google")),
    "https://www.google.com/search?q=hello%20there",
  );
  assert.equal(isValidSearchUrlTemplate("https://%s.example.com/"), false);
  assert.equal(isValidSearchUrlTemplate("https://search.example/?q=%s"), true);
  assert.equal(resolveSearchUrlTemplate("custom", "javascript:%s"), "https://duckduckgo.com/?q=%s");
});
