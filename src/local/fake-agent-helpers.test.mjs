import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

const helper = new URL("./cli-fake-agent.test-helper.mjs", import.meta.url).pathname;

test("a gated fake CLI exits once the test runner that spawned it is gone", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-gate-test-"));
  try {
    // The parent stands in for a test runner: it starts the CLI detached, the
    // way session-turns does, and stays up until told to exit. The gate file is
    // never created, so only the orphan check can end the CLI.
    const script = `
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, [${JSON.stringify(helper)}, "codex"], {
        detached: true,
        stdio: ["ignore", "inherit", "ignore"],
        env: { ...process.env, FAKE_CLI_SCENARIO: "gate", FAKE_CLI_GATE: ${JSON.stringify(path.join(dir, "gate"))} },
      });
      child.unref();
      process.stdin.once("data", () => process.exit(0));
    `;
    const parent = spawn(process.execPath, ["-e", script], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    // The CLI writes to the same pipe, so its first line means it has started.
    const started = new Promise((resolve) => parent.stdout.once("data", resolve));
    // stdout closes only when the detached CLI, the last holder of the pipe, exits.
    const closed = new Promise((resolve) => parent.stdout.on("close", resolve));
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("the gated CLI outlived its runner")), 10_000).unref(),
    );
    await started;
    parent.stdin.end("stop\n");
    await once(parent, "exit");
    await Promise.race([closed, timeout]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
