import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { formatCheck, nodeSupported, runDoctor } from "./doctor.mjs";

test("Node support check follows the package engine floor", () => {
  assert.equal(nodeSupported("22.0.0"), true);
  assert.equal(nodeSupported("21.9.9"), false);
  assert.match(formatCheck({ level: "fail", label: "node", detail: "too old" }), /^FAIL  node:/);
});

test("doctor reports core checks without writing the ADE data directory", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "ade-doctor-test-"));
  const dataDir = path.join(temp, ".ade");
  try {
    const checks = await runDoctor({
      dataDir,
      platform: "plan9",
      nodeVersion: "22.0.0",
      run: async (command) => ({
        code: command === "git" ? 0 : 1,
        stdout: command === "git" ? "git version 2.0.0\n" : "",
        stderr: "",
      }),
      loadTerminalModule: async () => ({}),
    });
    assert.equal(checks.find((item) => item.label === "node").level, "ok");
    assert.equal(checks.find((item) => item.label === "git").level, "ok");
    assert.equal(checks.find((item) => item.label === "terminal").level, "ok");
    assert.equal(checks.find((item) => item.label === "browser").level, "warn");
    assert.equal(checks.find((item) => item.label === "data dir").level, "ok");
    await assert.rejects(import("node:fs/promises").then(({ access }) => access(dataDir)));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("doctor explains missing optional terminal support", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "ade-doctor-terminal-test-"));
  try {
    const checks = await runDoctor({
      dataDir: temp,
      platform: "plan9",
      run: async () => ({ code: 1, stdout: "", stderr: "" }),
      loadTerminalModule: async () => {
        throw new Error("native module missing");
      },
    });
    const terminal = checks.find((item) => item.label === "terminal");
    assert.equal(terminal.level, "warn");
    assert.match(terminal.detail, /native module missing/);
    assert.equal(checks.find((item) => item.label === "git").level, "fail");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
