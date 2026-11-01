import assert from "node:assert/strict";
import test from "node:test";
import { resolveBindHost } from "./bind-host.mjs";

test("binds loopback unless ADE_HOST is set", () => {
  assert.equal(resolveBindHost({}), "127.0.0.1");
  assert.equal(resolveBindHost({ ADE_HOST: "  " }), "127.0.0.1");
  assert.equal(resolveBindHost({ ADE_HOST: "localhost" }), "localhost");
});

test("a non-loopback ADE_HOST requires a non-empty ADE_TOKEN", () => {
  for (const ADE_HOST of ["0.0.0.0", "192.168.1.50", "::"]) {
    assert.throws(() => resolveBindHost({ ADE_HOST }), /without an access token/);
    assert.throws(() => resolveBindHost({ ADE_HOST, ADE_TOKEN: "  " }), /without an access token/);
    assert.equal(resolveBindHost({ ADE_HOST, ADE_TOKEN: "secret" }), ADE_HOST);
  }
});
