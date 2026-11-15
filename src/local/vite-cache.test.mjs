import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveConfig } from "vite";

test("development servers on separate ports use separate dependency caches", async () => {
  const configFile = path.resolve("vite.config.ts");
  const first = await resolveConfig(
    { configFile, server: { port: 3100 }, logLevel: "silent" },
    "serve",
  );
  const second = await resolveConfig(
    { configFile, server: { port: 3212 }, logLevel: "silent" },
    "serve",
  );
  assert.notEqual(first.cacheDir, second.cacheDir);
  assert.equal(path.basename(first.cacheDir), "ade-3100");
  assert.equal(path.basename(second.cacheDir), "ade-3212");
  assert.ok(first.server.watch.ignored.includes("**/.output/**"));
  assert.ok(first.server.watch.ignored.includes("**/.pack/**"));
});
