import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { killTree, runCommand, spawnCommand } from "./spawn.mjs";

const isWindows = process.platform === "win32";
const collect = (child) =>
  new Promise((resolve) => {
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (error) => resolve({ code: 127, out, error }));
    child.on("close", (code) => resolve({ code, out }));
  });

test("spawnCommand runs PATH shims (npm-style .cmd on Windows) and keeps arguments literal", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-spawn-"));
  try {
    // A shim that prints each argument on its own line, like npm's .cmd shims
    // forwarding to node. Metacharacters must arrive literally, never run.
    const printer = path.join(dir, "print-args.mjs");
    writeFileSync(printer, "for (const a of process.argv.slice(2)) console.log(a);\n");
    if (isWindows)
      writeFileSync(path.join(dir, "ade-shim.cmd"), `@"${process.execPath}" "${printer}" %*\r\n`);
    else {
      writeFileSync(
        path.join(dir, "ade-shim"),
        `#!/bin/sh\nexec "${process.execPath}" "${printer}" "$@"\n`,
      );
      chmodSync(path.join(dir, "ade-shim"), 0o755);
    }
    const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` };
    const tricky = ["run", "dev", "--port", "5173", "a b", "x&echo INJECTED", "100%", 'q"uote'];
    const result = await collect(
      spawnCommand("ade-shim", tricky, { env, stdio: ["ignore", "pipe", "pipe"] }),
    );
    assert.equal(result.code, 0, result.error?.message);
    assert.deepEqual(result.out.split(/\r?\n/).filter(Boolean), tricky);
    assert.ok(!/^INJECTED$/m.test(result.out), "metacharacters must not run commands");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("spawnCommand reports a missing command as ENOENT", async () => {
  const result = await collect(
    spawnCommand("ade-definitely-not-installed", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  assert.notEqual(result.code, 0);
  if (result.error) assert.equal(result.error.code, "ENOENT");
});

test("killTree uses taskkill /T /F on Windows and reports failure", () => {
  const calls = [];
  const ok = killTree(4321, {
    platform: "win32",
    run: (bin, args) => (calls.push([bin, ...args]), { status: 0 }),
  });
  assert.equal(ok, true);
  assert.deepEqual(calls, [["taskkill", "/pid", "4321", "/T", "/F"]]);
  assert.equal(killTree(4321, { platform: "win32", run: () => ({ status: 128 }) }), false);
});

test(
  "killTree stops the grandchild a shell launched (no orphaned dev server)",
  { skip: !isWindows && "Windows-only: POSIX stops the process group instead" },
  async () => {
    // The real shape: a .cmd shim (like npm.cmd) runs under cmd.exe and
    // starts node — the long-lived "dev server" is a grandchild of ours.
    const dir = mkdtempSync(path.join(os.tmpdir(), "ade-killtree-"));
    const server = path.join(dir, "server.mjs");
    writeFileSync(server, "console.log(process.pid);\nsetInterval(() => {}, 1000);\n");
    writeFileSync(path.join(dir, "fake-dev.cmd"), `@"${process.execPath}" "${server}"\r\n`);
    const env = { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` };
    const child = spawnCommand("fake-dev", [], { env, stdio: ["ignore", "pipe", "pipe"] });
    try {
      const grandchild = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("server never printed its pid")), 10000);
        child.stdout.once("data", (d) => (clearTimeout(timer), resolve(Number(String(d).trim()))));
      });
      assert.ok(grandchild > 0 && grandchild !== child.pid);
      assert.equal(killTree(child.pid), true);
      await new Promise((r) => setTimeout(r, 500));
      assert.throws(() => process.kill(grandchild, 0), "grandchild must be gone");
    } finally {
      killTree(child.pid);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

// Regression: a Customize ADE "Tests" check hung for 38 minutes because the
// timeout killed only `npm`, while the test runner it started kept the output
// pipes open, so the command never ended.
test(
  "runCommand with killGroup ends a timed-out command whose children hold the pipes",
  { skip: isWindows && "process groups are POSIX; Windows uses taskkill /T" },
  async () => {
    const script =
      "const { spawn } = require('node:child_process');" +
      "const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });" +
      "console.log('grandchild ' + c.pid);" +
      "setInterval(() => {}, 1000);";
    const started = Date.now();
    const result = await runCommand(process.execPath, ["-e", script], {
      timeout: 500,
      killGroup: true,
      killGraceMs: 500,
    });
    assert.equal(result.timedOut, true);
    assert.ok(Date.now() - started < 5000, "resolved promptly after the timeout");
    const pid = Number(/grandchild (\d+)/.exec(result.stdout)?.[1]);
    assert.ok(pid > 0, "the grandchild started");
    await new Promise((r) => setTimeout(r, 200));
    assert.throws(() => process.kill(pid, 0), "the grandchild was stopped with the group");
  },
);
