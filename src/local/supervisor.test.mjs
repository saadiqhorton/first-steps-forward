// The `ade` supervisor with fixture builds: each kept version's bin/ade.mjs is
// a tiny HTTP server that starts a grandchild (to prove the whole process
// group stops) and asks for a restart over IPC on GET /restart.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Never the real home.
const home = mkdtempSync(path.join(os.tmpdir(), "ade-supervisor-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.once("exit", () => rmSync(home, { recursive: true, force: true }));

const skip = process.platform === "win32" ? "process groups are POSIX" : false;
const { superviseAde, keptTarget } = await import("./supervisor.mjs");
const { ephemeralPort } = await import("./ports.mjs");

const SERVER = `import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const who = path.basename(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
http
  .createServer((req, res) => {
    if (req.url === "/restart") process.send?.({ type: "ade:restart" });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      who, pid: process.pid, grandchild: sleeper.pid,
      running: process.env.ADE_RUNNING_SHA, supervised: process.env.ADE_SUPERVISED,
      quiet: process.env.ADE_LAUNCH_QUIET ?? null, stockRoot: process.env.ADE_STOCK_ROOT ?? null, args: process.argv.slice(2),
    }));
  })
  .listen(port, "127.0.0.1", () => console.log("ADE is running: " + who));
`;
const BROKEN = `console.error("TypeError: broken by this change");\nprocess.exit(1);\n`;

const SHA1 = "1".repeat(40);
const SHA2 = "2".repeat(40);
const SHA3 = "3".repeat(40);

function fixture() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ade-supervisor-data-"));
  const self = path.join(dataDir, "self");
  const build = (name, code = SERVER) => {
    const dir = path.join(self, "builds", name);
    mkdirSync(path.join(dir, "bin"), { recursive: true });
    mkdirSync(path.join(dir, ".output", "public"), { recursive: true });
    writeFileSync(path.join(dir, "bin", "ade.mjs"), code);
    return dir;
  };
  const stockRoot = path.join(dataDir, "stock");
  mkdirSync(path.join(stockRoot, "bin"), { recursive: true });
  writeFileSync(path.join(stockRoot, "bin", "ade.mjs"), SERVER);
  mkdirSync(self, { recursive: true });
  const current = (value) => writeFileSync(path.join(self, "current.json"), JSON.stringify(value));
  const readJson = (name) => JSON.parse(readFileSync(path.join(self, name), "utf8"));
  return { dataDir, build, current, readJson, stockBin: path.join(stockRoot, "bin", "ade.mjs") };
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function waitFor(check, what, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const ask = (port, url = "/api/bootstrap") =>
  fetch(`http://127.0.0.1:${port}${url}`)
    .then((res) => res.json())
    .catch(() => null);
const quiet = { log: () => {}, out: { write() {} }, err: { write() {} }, signals: false };
const started = [];
test.after(async () => {
  for (const sup of started) await sup.stop();
});

test("keptTarget: no current.json or an unusable build means stock in one process", async () => {
  const f = fixture();
  assert.equal(await keptTarget(f.dataDir), null);
  f.current({ sha: SHA1, version: "1", previous: null });
  assert.equal(await keptTarget(f.dataDir), null, "the build folder is missing");
  f.build(SHA1);
  assert.equal(await keptTarget(f.dataDir), SHA1);
  f.current({ sha: null, version: "", previous: { sha: SHA1 } });
  assert.equal(await keptTarget(f.dataDir), null);
});

test(
  "runs the kept build as a child, restarts on the new version over IPC, same port",
  { skip },
  async () => {
    const f = fixture();
    f.build(SHA1);
    f.build(SHA2);
    f.current({ sha: SHA1, version: "1", previous: { sha: null } });
    const port = await ephemeralPort();
    const logs = [];
    let ready = null;
    const sup = superviseAde({
      ...quiet,
      log: (line) => logs.push(line),
      dataDir: f.dataDir,
      stockBin: f.stockBin,
      port,
      timeout: 8000,
      onReady: (url) => (ready = url),
    });
    started.push(sup);
    const first = await waitFor(() => ask(port), "the kept build");
    assert.equal(first.who, SHA1);
    assert.equal(first.running, SHA1);
    assert.equal(first.supervised, "1");
    assert.equal(
      first.stockRoot,
      path.dirname(path.dirname(f.stockBin)),
      "a kept build learns which ADE it is updated to",
    );
    assert.equal(first.quiet, null, "the first start prints ADE's links");
    assert.deepEqual(first.args, ["--port", String(port)]);
    await waitFor(() => ready, "onReady");
    assert.equal(ready, `http://127.0.0.1:${port}`);

    f.current({ sha: SHA2, version: "1", previous: { sha: SHA1 } });
    await ask(port, "/restart");
    const second = await waitFor(async () => {
      const now = await ask(port);
      return now?.who === SHA2 ? now : null;
    }, "the restarted build");
    assert.equal(second.quiet, "1", "a restart does not print the links again");
    await waitFor(() => !alive(first.pid) && !alive(first.grandchild), "the old group to stop");
    await waitFor(() => logs.includes("ADE restarted."), "the restart line");

    await sup.stop();
    await waitFor(() => !alive(second.pid) && !alive(second.grandchild), "the group to stop");
    assert.equal(await sup.done, 0);
  },
);

test(
  "a version that does not start rolls back to the previous one and records why",
  { skip },
  async () => {
    const f = fixture();
    f.build(SHA1);
    f.build(SHA3, BROKEN);
    mkdirSync(path.join(f.dataDir, "self"), { recursive: true });
    writeFileSync(
      path.join(f.dataDir, "self", "state.json"),
      JSON.stringify({ version: 1, setup: { status: "ready" }, switch: { status: "restarting" } }),
    );
    f.current({ sha: SHA3, version: "1", previous: { sha: SHA1 } });
    const port = await ephemeralPort();
    const logs = [];
    const sup = superviseAde({
      ...quiet,
      log: (line) => logs.push(line),
      dataDir: f.dataDir,
      stockBin: f.stockBin,
      port,
      timeout: 5000,
    });
    started.push(sup);
    const back = await waitFor(() => ask(port), "the previous version");
    assert.equal(back.who, SHA1);
    assert.equal(f.readJson("current.json").sha, SHA1);
    const saved = f.readJson("state.json").switch;
    assert.equal(saved.status, "failed");
    assert.equal(saved.rolledBack, true);
    assert.equal(saved.target, SHA3);
    assert.match(saved.error, /TypeError: broken by this change/);
    assert.equal(f.readJson("state.json").setup.status, "ready", "the rest of state is kept");
    assert.ok(logs.some((line) => line.startsWith("Your version didn't start, so ADE went back.")));
    await sup.stop();
  },
);

test("with no previous version a failed start falls back to stock", { skip }, async () => {
  const f = fixture();
  f.build(SHA3, BROKEN);
  f.current({ sha: SHA3, version: "1", previous: { sha: null } });
  const port = await ephemeralPort();
  const sup = superviseAde({
    ...quiet,
    dataDir: f.dataDir,
    stockBin: f.stockBin,
    port,
    timeout: 5000,
  });
  started.push(sup);
  const back = await waitFor(() => ask(port), "stock");
  assert.equal(back.who, "stock");
  assert.equal(back.running, "");
  assert.equal(f.readJson("current.json").sha, null);
  await sup.stop();
});

test(
  "the real `ade` supervises a kept build and a signal stops its whole group",
  { skip },
  async () => {
    const userHome = mkdtempSync(path.join(os.tmpdir(), "ade-supervisor-user-"));
    const f = { dataDir: path.join(userHome, ".ade") };
    const build = path.join(f.dataDir, "self", "builds", SHA1);
    mkdirSync(path.join(build, "bin"), { recursive: true });
    mkdirSync(path.join(build, ".output", "public"), { recursive: true });
    writeFileSync(path.join(build, "bin", "ade.mjs"), SERVER);
    writeFileSync(
      path.join(f.dataDir, "self", "current.json"),
      JSON.stringify({ sha: SHA1, version: "1", previous: null }),
    );
    const port = await ephemeralPort();
    const bin = fileURLToPath(new URL("../../bin/ade.mjs", import.meta.url));
    let output = "";
    const ade = spawn(process.execPath, [bin, "--port", String(port)], {
      env: { ...process.env, HOME: userHome, USERPROFILE: userHome },
      stdio: ["ignore", "pipe", "pipe"],
    });
    ade.stdout.on("data", (chunk) => (output += chunk));
    ade.stderr.on("data", (chunk) => (output += chunk));
    const exited = new Promise((resolve) => ade.once("exit", (code) => resolve(code)));
    try {
      const child = await waitFor(() => ask(port), `the kept build (${output})`);
      assert.equal(child.who, SHA1);
      assert.notEqual(child.pid, ade.pid, "the server is a child, not the supervisor");
      await waitFor(() => output.includes(`ADE is running: ${SHA1}`), "the child's lines");
      ade.kill("SIGTERM");
      assert.equal(await exited, 0);
      await waitFor(
        () => !alive(child.pid) && !alive(child.grandchild),
        "the child's process group to stop",
      );
    } finally {
      ade.kill("SIGKILL");
      rmSync(userHome, { recursive: true, force: true });
    }
  },
);

test(
  "a supervised server whose supervisor is killed outright takes its group down",
  { skip },
  async () => {
    const userHome = mkdtempSync(path.join(os.tmpdir(), "ade-supervisor-orphan-"));
    const port = await ephemeralPort();
    const bin = fileURLToPath(new URL("../../bin/ade.mjs", import.meta.url));
    // A stand-in parent: spawn the real bin as a supervised child with IPC, then die.
    const parent = spawn(
      process.execPath,
      [
        "-e",
        `const { spawn } = require("node:child_process");
         const c = spawn(process.execPath, [${JSON.stringify(bin)}, "--port", "${port}"], {
           env: { ...process.env, ADE_SUPERVISED: "1" }, stdio: ["ignore", "ignore", "ignore", "ipc"], detached: true });
         console.log(c.pid);
         setInterval(() => {}, 1000);`,
      ],
      {
        env: { ...process.env, HOME: userHome, USERPROFILE: userHome },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    let pid = "";
    parent.stdout.on("data", (chunk) => (pid += chunk));
    try {
      const childPid = Number(await waitFor(() => pid.trim(), "the child pid"));
      await waitFor(
        () =>
          fetch(`http://127.0.0.1:${port}/api/bootstrap`).then(
            () => true,
            () => false,
          ),
        "the supervised server",
        30000,
      );
      parent.kill("SIGKILL");
      await waitFor(() => !alive(childPid), "the orphaned server to stop", 15000);
    } finally {
      parent.kill("SIGKILL");
      rmSync(userHome, { recursive: true, force: true });
    }
  },
);

test(
  "`ade --stock` runs stock ADE in one process and says the kept changes are off",
  { skip },
  async () => {
    const userHome = mkdtempSync(path.join(os.tmpdir(), "ade-supervisor-stock-"));
    const build = path.join(userHome, ".ade", "self", "builds", SHA1);
    mkdirSync(path.join(build, "bin"), { recursive: true });
    mkdirSync(path.join(build, ".output", "public"), { recursive: true });
    writeFileSync(path.join(build, "bin", "ade.mjs"), SERVER);
    writeFileSync(
      path.join(userHome, ".ade", "self", "current.json"),
      JSON.stringify({ sha: SHA1, version: "1", previous: null }),
    );
    const port = await ephemeralPort();
    const bin = fileURLToPath(new URL("../../bin/ade.mjs", import.meta.url));
    const ade = spawn(process.execPath, [bin, "--stock", "--port", String(port)], {
      env: { ...process.env, HOME: userHome, USERPROFILE: userHome },
      stdio: ["ignore", "ignore", "ignore"],
    });
    try {
      const status = await waitFor(
        () => ask(port, "/api/customize").then((json) => (json?.current ? json : null)),
        "stock ADE",
        30000,
      );
      assert.deepEqual(status.current, { stock: true, sha: null, withoutChanges: true });
      assert.equal(status.switch.launcher, false, "--stock never restarts into the kept version");
      assert.equal(status.switch.command, `ade --port ${port}`);
      assert.equal((await ask(port)).who, undefined, "the kept build is not running");
    } finally {
      ade.kill("SIGTERM");
      await new Promise((resolve) => ade.once("exit", resolve));
      rmSync(userHome, { recursive: true, force: true });
    }
  },
);
