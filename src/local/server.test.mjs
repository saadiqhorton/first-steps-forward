import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

// A throwaway HOME before ade-local is imported, so start() loads only this workspace.
const home = mkdtempSync(path.join(os.tmpdir(), "ade-server-"));
process.once("exit", () => rmSync(home, { recursive: true, force: true }));
process.env.HOME = home;
process.env.USERPROFILE = home;
const staticDir = path.join(home, "client");
mkdirSync(path.join(staticDir, "assets"), { recursive: true });
writeFileSync(path.join(staticDir, "_shell.html"), "<!DOCTYPE html><title>shell</title>");
writeFileSync(path.join(staticDir, "assets", "app-Ab12Cd.js"), "console.log(1);");
writeFileSync(path.join(staticDir, "robots.txt"), "User-agent: *");
// A file next to (not inside) the static dir that traversal must never reach.
writeFileSync(path.join(home, "secret.txt"), "secret");

const { startAdeServer } = await import("./server.mjs");
const { computerContext } = await import("./ade-local.mjs");
const server = await startAdeServer({ host: "127.0.0.1", port: 0, staticDir });
const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
const origin = `http://127.0.0.1:${port}`;
test.after(() => {
  server.closeAllConnections();
  server.close();
});

/** A raw request: unlike fetch, keeps the path exactly as written (like curl --path-as-is). */
function raw(pathname, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, method, headers },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("client routes get the SPA shell, revalidated on every load", async () => {
  for (const route of ["/", "/p/anything/conversations", "/agents?tab=1"]) {
    const res = await raw(route);
    assert.equal(res.status, 200, route);
    assert.match(res.headers["content-type"], /^text\/html/);
    assert.equal(res.headers["cache-control"], "no-cache");
    assert.equal(res.body, "<!DOCTYPE html><title>shell</title>");
  }
});

test("hashed assets are immutable; other files revalidate; missing files are 404", async () => {
  const asset = await raw("/assets/app-Ab12Cd.js");
  assert.equal(asset.status, 200);
  assert.match(asset.headers["content-type"], /^text\/javascript/);
  assert.equal(asset.headers["cache-control"], "public, max-age=31536000, immutable");
  assert.equal(asset.body, "console.log(1);");
  const again = await raw("/assets/app-Ab12Cd.js", {
    headers: { "if-none-match": asset.headers.etag },
  });
  assert.equal(again.status, 304);
  const robots = await raw("/robots.txt");
  assert.equal(robots.status, 200);
  assert.equal(robots.headers["cache-control"], "no-cache");
  assert.equal((await raw("/assets/missing-Zz99.js")).status, 404);
  assert.equal((await raw("/assets/app-Ab12Cd.js", { method: "POST" })).status, 405);
});

test("no request path escapes the static directory", async () => {
  for (const attempt of [
    "/../secret.txt",
    "/../../../../etc/passwd",
    "/%2e%2e/secret.txt",
    "/..%2fsecret.txt",
    "/assets/..%2f..%2fsecret.txt",
    "//etc/passwd",
    "/%00",
  ]) {
    const res = await raw(attempt);
    assert.notEqual(res.body, "secret", attempt);
    assert.doesNotMatch(res.body, /root:/, attempt);
  }
  assert.equal((await raw("/..%2fsecret.txt")).status, 404);
});

test("/api goes to the local API on the same port", async () => {
  const res = await fetch(`${origin}/api/bootstrap`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/json/);
  const body = await res.json();
  assert.ok(Array.isArray(body.projects) && Array.isArray(body.sessions));
  const missing = await fetch(`${origin}/api/no-such-route`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("content-type"), /application\/json/);
});

test("an oversized body is refused with 413 over a real socket", async () => {
  const res = await fetch(`${origin}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: "x".repeat(2_000_000) }),
  });
  assert.equal(res.status, 413);
});

test("agents get the address the server actually listens on", () => {
  const context = computerContext({ id: "p", name: "p", path: home });
  assert.equal(context.env.ADE_API, origin);
});

test("/preview-stream upgrades reach the stream; other upgrades are refused", async () => {
  // A wrong token proves the stream server itself answered (its 4401 close).
  const stream = new WebSocket(`ws://127.0.0.1:${port}/preview-stream?token=nope&viewer=A`, {
    headers: { Origin: origin },
  });
  const [code] = await once(stream, "close");
  assert.equal(code, 4401);
  // The API's Host guard applies to the upgrade too.
  const rebound = new WebSocket(`ws://127.0.0.1:${port}/preview-stream`, {
    headers: { Host: "evil.example" },
  });
  const [forbidden] = await once(rebound, "error");
  assert.match(forbidden.message, /403/);
  const other = new WebSocket(`ws://127.0.0.1:${port}/other`);
  const [notFound] = await once(other, "error");
  assert.match(notFound.message, /404/);
});
