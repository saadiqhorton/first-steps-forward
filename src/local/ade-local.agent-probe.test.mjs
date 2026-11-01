// Agent probing through ADE's API: the bootstrap poll must not re-probe the CLIs every few
// seconds, while explicit refreshes still do. Stand-ins for the CLIs and npm on PATH log every
// invocation, so the tests count the processes a probe really spawns.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const skip = process.platform === "win32" ? "the fake CLIs are POSIX shell shims" : false;
const home = mkdtempSync(path.join(os.tmpdir(), "ade-probe-"));
process.once("exit", () => rmSync(home, { recursive: true, force: true }));
mkdirSync(path.join(home, ".ade"), { mode: 0o700 });
const binDir = path.join(home, "bin");
mkdirSync(binDir);
const calls = path.join(home, "calls.log");
writeFileSync(calls, "");
for (const name of ["claude", "codex", "opencode", "pi", "npm"]) {
  const reply =
    name === "npm"
      ? 'case "$1" in root) echo "$HOME/npm-root";; *) echo 9.9.9;; esac'
      : "echo 1.0.0";
  writeFileSync(path.join(binDir, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${reply}\n`);
  chmodSync(path.join(binDir, name), 0o755);
}
const seconds = (n) => n * 1000;
// A cache older than the probe interval, so the first bootstrap is allowed to probe.
const cachedAgents = ["claude", "codex", "opencode", "pi"].map((id) => ({
  id,
  name: id,
  short: id,
  tools: "x",
  authMethod: "x",
  authNote: "x",
  installHint: "x",
  installed: true,
  version: "1.0.0",
  signedIn: true,
  carriesConversation: true,
  installMethod: "other",
  harness: { install: "x", update: "x" },
}));
writeFileSync(
  path.join(home, ".ade", "agents-status.json"),
  JSON.stringify({ fetchedAt: Date.now() - seconds(120), agents: cachedAgents }),
);
writeFileSync(
  path.join(home, ".ade", "workspace.json"),
  JSON.stringify({ projects: [], sessions: [], processes: [] }),
);
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

const { handle, start } = await import("./ade-local.mjs");
const { callApi } = await import("./api-request.test-helper.mjs");
await start();
const call = async (urlPath) => {
  const res = await callApi(handle, {
    url: `http://127.0.0.1:3000${urlPath}`,
    remoteAddress: "::ffff:127.0.0.1",
  });
  return { status: res.status, json: await res.json() };
};
const invocations = () => readFileSync(calls, "utf8").split("\n").filter(Boolean);
const versionProbes = () => invocations().filter((line) => line.endsWith(" --version")).length;
const npmRootCalls = () => invocations().filter((line) => line === "npm root -g").length;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, what, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${what}`);
}
/** Lets a probe that was wrongly started show itself. */
const settle = () => sleep(400);

test("a bootstrap probes once, a second within 60 s spawns nothing", { skip }, async () => {
  assert.equal((await call("/api/bootstrap")).status, 200);
  await waitFor(() => versionProbes() === 4, "the first probe's four --version calls");
  await settle();
  assert.equal(versionProbes(), 4);

  assert.equal((await call("/api/bootstrap")).status, 200);
  await settle();
  assert.equal(versionProbes(), 4, "no second probe inside the interval");
});

test("/api/agents still forces a probe inside the interval", { skip }, async () => {
  const before = versionProbes();
  const res = await call("/api/agents");
  assert.equal(res.status, 200);
  assert.equal(versionProbes(), before + 4);
});

test("npm root -g is looked up once for all probes", { skip }, () => {
  assert.equal(npmRootCalls(), 1);
});

test("the bootstrap poll probes again once the interval has passed", { skip }, async (t) => {
  const before = versionProbes();
  const real = Date.now();
  t.mock.method(Date, "now", () => real + seconds(61));
  await call("/api/bootstrap");
  await waitFor(() => versionProbes() === before + 4, "the probe after the interval");
  // Let that probe finish its auth checks and cache write before the next test reads the cache.
  await settle();
});

test("a restart inside the interval trusts the cached fetchedAt", { skip }, async () => {
  // The cache the first test started from was 120 s old, so it probed; a fresh one must not.
  // A new module instance reads the file at its first bootstrap, so re-import it with a query.
  writeFileSync(
    path.join(home, ".ade", "agents-status.json"),
    JSON.stringify({ fetchedAt: Date.now(), agents: cachedAgents }),
  );
  const fresh = await import("./ade-local.mjs?restart");
  await fresh.start();
  const before = versionProbes();
  const res = await callApi(fresh.handle, {
    url: "http://127.0.0.1:3000/api/bootstrap",
    remoteAddress: "::ffff:127.0.0.1",
  });
  assert.equal(res.status, 200);
  await settle();
  assert.equal(versionProbes(), before);
});
