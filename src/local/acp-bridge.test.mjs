import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { acpBridge, bridgeDir } from "./acp-bridge.mjs";
import { claude } from "./adapters/claude.agent.mjs";

const spec = claude.bridge;
const entryIn = (dir) => path.join(dir, "node_modules", spec.pkg, spec.entry);

/** npm stand-in: "installs" the bridge into --prefix after a short delay. */
function fakeNpm({ code = 0, stderr = "" } = {}) {
  const calls = [];
  const run = async (bin, args) => {
    calls.push([bin, ...args]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (code === 0) {
      const prefix = args[args.indexOf("--prefix") + 1];
      mkdirSync(path.dirname(entryIn(prefix)), { recursive: true });
      writeFileSync(entryIn(prefix), "// bridge\n");
    }
    return { code, stdout: "", stderr };
  };
  return { run, calls };
}

const withDataDir = async (fn) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ade-acp-bridge-"));
  try {
    await fn(dataDir);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
};

test("a bridge already on PATH is used as is", async () => {
  await withDataDir(async (dataDir) => {
    const npm = fakeNpm();
    const launch = await acpBridge(spec, {
      dataDir,
      which: async (bin) => (bin === "claude-agent-acp" ? "/usr/local/bin/claude-agent-acp" : null),
      run: npm.run,
      onInstall: () => assert.fail("nothing to install"),
    });
    assert.deepEqual(launch, ["/usr/local/bin/claude-agent-acp", []]);
    assert.equal(npm.calls.length, 0);
  });
});

test("otherwise ADE installs the pinned bridge once, without its bundled binary", async () => {
  await withDataDir(async (dataDir) => {
    const npm = fakeNpm();
    let notices = 0;
    const deps = { dataDir, which: async () => null, run: npm.run, onInstall: () => notices++ };
    // Two turns starting together share one install.
    const [first, second] = await Promise.all([acpBridge(spec, deps), acpBridge(spec, deps)]);
    const entry = entryIn(bridgeDir(dataDir, spec));
    assert.deepEqual(first, [process.execPath, [entry]]);
    assert.deepEqual(second, first);
    assert.equal(npm.calls.length, 1);
    assert.equal(notices, 2);
    const [bin, ...args] = npm.calls[0];
    assert.equal(bin, "npm");
    assert.ok(args.includes("--omit=optional"));
    assert.equal(args.at(-1), "@agentclientprotocol/claude-agent-acp@0.99.0");
    // Installed beside the final directory, then moved into place.
    assert.notEqual(args[args.indexOf("--prefix") + 1], bridgeDir(dataDir, spec));
    assert.deepEqual(readdirSync(path.join(dataDir, "acp")), ["claude-agent-acp-0.99.0"]);

    // Later turns reuse it.
    assert.deepEqual(await acpBridge(spec, deps), first);
    assert.equal(npm.calls.length, 1);
    assert.equal(notices, 2);
  });
});

test("a failed install leaves nothing behind and the next turn retries", async () => {
  await withDataDir(async (dataDir) => {
    const failing = fakeNpm({ code: 1, stderr: "npm error\nnpm error network ETIMEDOUT" });
    await assert.rejects(
      acpBridge(spec, { dataDir, which: async () => null, run: failing.run }),
      /could not install @agentclientprotocol\/claude-agent-acp@0\.99\.0 with npm \(exit 1: npm error network ETIMEDOUT\)/,
    );
    assert.deepEqual(readdirSync(path.join(dataDir, "acp")), []);

    const working = fakeNpm();
    const launch = await acpBridge(spec, { dataDir, which: async () => null, run: working.run });
    assert.ok(existsSync(launch[1][0]));
    assert.equal(working.calls.length, 1);
  });
});
