// The `ade` supervisor: when the user kept changes (self/current.json names a
// kept build), `ade` stays a thin parent and runs that build's server as a
// child in its own process group. The child asks to be restarted over IPC
// ("Restart ADE"); the parent stops the whole group, starts the version
// current.json names on the same port, and goes back to the previous version
// when it does not answer /api/bootstrap in time. Stock ADE without kept
// changes never gets here: it runs in one process (docs/adr/0002).
import http from "node:http";
import path from "node:path";
import { buildDir, readCurrent, usableBuild, writeCurrent } from "./customize/builds.mjs";
import { selfPaths } from "./customize/paths.mjs";
import { createStore } from "./customize/store.mjs";
import { RESTART_MESSAGE } from "./launcher.mjs";
import { spawnCommand, stopProcess } from "./spawn.mjs";

/** A child that exits with this code asks to be restarted (old builds without IPC). */
export const RESTART_EXIT_CODE = 75;
const OUTPUT_LINES = 40;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The kept version `ade` should run, or null for stock ADE in one process.
 * @param {string} dataDir
 * @returns {Promise<string|null>}
 */
export async function keptTarget(dataDir) {
  const paths = selfPaths(dataDir);
  const current = await readCurrent(paths);
  return current?.sha && usableBuild(paths, current.sha) ? current.sha : null;
}

/** One GET; true when the server answered at all (any status below 500). */
function answers(url, token) {
  return new Promise((resolve) => {
    const req = http.get(
      url,
      { timeout: 2000, headers: token ? { authorization: `Bearer ${token}` } : {} },
      (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) < 500);
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Run ADE under the supervisor until it stops.
 * @param {{
 *   dataDir: string,
 *   stockBin: string,
 *   port: number,
 *   host?: string,
 *   remote?: boolean,
 *   env?: NodeJS.ProcessEnv,
 *   log?: (line: string) => void,
 *   out?: { write: (chunk: any) => any },
 *   err?: { write: (chunk: any) => any },
 *   spawn?: typeof spawnCommand,
 *   node?: string,
 *   timeout?: number,
 *   signals?: boolean,
 *   onReady?: (url: string) => void,
 *   announced?: boolean,
 * }} options
 *   `stockBin` is this ADE's own bin/ade.mjs (run for stock). `signals: false`
 *   leaves process signals alone (tests). `onReady` runs once, on the first start.
 *   `announced`: ADE's links were printed already (a hand-off), so children start quiet.
 * @returns {{ done: Promise<number>, stop: (signal?: NodeJS.Signals) => Promise<void>, pid: () => number | undefined }}
 */
export function superviseAde({
  dataDir,
  stockBin,
  port,
  host,
  remote = false,
  env = process.env,
  log = console.log,
  out = process.stdout,
  err = process.stderr,
  spawn = spawnCommand,
  node = process.execPath,
  timeout = 30_000,
  signals = true,
  onReady,
  announced = false,
}) {
  const paths = selfPaths(dataDir);
  const args = ["--port", String(port), ...(remote ? ["--remote"] : host ? ["--host", host] : [])];
  const probeHost = remote || !host || host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const url = `http://${probeHost.includes(":") ? `[${probeHost}]` : probeHost}:${port}`;
  /** @type {{ child: import("node:child_process").ChildProcess, closed: Promise<{ code: number|null, signal: string|null }> } | null} */
  let running = null;
  let stopping = false;
  let restarting = Promise.resolve();
  let finish = (code) => {};
  const done = new Promise((resolve) => (finish = resolve));

  function launch(target, { quiet }) {
    const bin = target ? path.join(buildDir(paths, target), "bin", "ade.mjs") : stockBin;
    const output = [];
    const child = spawn(node, [bin, ...args], {
      cwd: path.dirname(path.dirname(bin)),
      env: {
        ...env,
        ADE_SUPERVISED: "1",
        ADE_RUNNING_SHA: target ?? "",
        ...(quiet ? { ADE_LAUNCH_QUIET: "1" } : {}),
      },
      stdio: ["inherit", "pipe", "pipe", "ipc"],
      // Its own process group, so stopping it stops everything it started.
      detached: process.platform !== "win32",
      shell: false,
    });
    const keep = (stream) => (chunk) => {
      stream.write(chunk);
      output.push(...chunk.toString().split(/\r?\n/).filter(Boolean));
      if (output.length > OUTPUT_LINES) output.splice(0, output.length - OUTPUT_LINES);
    };
    child.stdout?.on("data", keep(out));
    child.stderr?.on("data", keep(err));
    const closed = new Promise((resolve) => {
      child.once("error", (error) => {
        output.push(error.message);
        resolve({ code: null, signal: null });
      });
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    child.on("message", (message) => {
      if (message?.type === RESTART_MESSAGE.type && running?.child === child) void restart();
    });
    return { child, closed, output };
  }

  async function stopChild(entry, signal = "SIGTERM") {
    if (!entry) return;
    const { child, closed } = entry;
    stopProcess(child);
    if (signal !== "SIGTERM" && child.pid && process.platform !== "win32")
      try {
        process.kill(-child.pid, signal);
      } catch {}
    const exited = await Promise.race([closed.then(() => true), delay(10_000)]);
    if (!exited && child.pid && process.platform !== "win32")
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    // Anything left in the group (a preview, a dev command) goes too.
    if (child.pid && process.platform !== "win32" && alive(-child.pid))
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    await closed;
  }

  /** Start `target`; resolves once it answers, or with why it did not. */
  async function tryStart(target, quiet) {
    const entry = launch(target, { quiet });
    let exited = null;
    void entry.closed.then((result) => (exited = result));
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline && !exited) {
      if (await answers(`${url}/api/bootstrap`, env.ADE_TOKEN)) {
        if (exited) break;
        return { ok: true, entry };
      }
      await delay(200);
    }
    await stopChild(entry);
    const said = entry.output.slice(-6).join("\n").trim();
    const reason = exited
      ? said || `It stopped with exit code ${exited.code ?? exited.signal}.`
      : `It did not answer within ${Math.round(timeout / 1000)} seconds.${said ? `\n${said}` : ""}`;
    return { ok: false, reason };
  }

  /** Back to the previous version: current.json and the saved switch say so. */
  async function rollback(failed, reason) {
    const current = await readCurrent(paths);
    const previous = current?.previous?.sha ?? null;
    const back = previous && usableBuild(paths, previous) ? previous : null;
    await writeCurrent(paths, { sha: back, version: current?.version ?? "", previous: null });
    const store = createStore(paths.state);
    const state = await store.load();
    state.switch = {
      status: "failed",
      step: "start",
      rolledBack: true,
      target: failed,
      error: reason,
    };
    await store.save(state).catch(() => {});
    log(`Your version didn't start, so ADE went back. Reason: ${reason.split("\n")[0]}`);
    return back;
  }

  /** Start the version current.json names; roll back on failure. */
  async function bringUp() {
    let target = await keptTarget(dataDir);
    for (;;) {
      const result = await tryStart(target, announced);
      if (result.ok) return result.entry;
      if (target === null) return null;
      target = await rollback(target, result.reason);
      // Whatever version comes back prints its own links if none did yet.
    }
  }

  function watch(entry) {
    running = entry;
    void entry.closed.then(({ code, signal }) => {
      if (running !== entry || stopping) return;
      if (code === RESTART_EXIT_CODE) return void restart();
      running = null;
      log(`ADE stopped (${code ?? signal}).`);
      finish(code ?? 1);
    });
  }

  function restart() {
    restarting = restarting.then(async () => {
      if (stopping) return;
      const old = running;
      running = null;
      await stopChild(old);
      const entry = await bringUp();
      if (!entry) {
        log("ADE could not start. Run `ade --stock` to start it without your changes.");
        return finish(1);
      }
      watch(entry);
      log("ADE restarted.");
    });
    return restarting;
  }

  async function stop(signal = "SIGTERM") {
    if (stopping) return done.then(() => {});
    stopping = true;
    await restarting.catch(() => {});
    await stopChild(running, signal);
    running = null;
    finish(signal === "SIGINT" ? 130 : 0);
  }

  if (signals) {
    for (const signal of /** @type {NodeJS.Signals[]} */ (["SIGINT", "SIGTERM", "SIGHUP"]))
      process.on(signal, () => void stop(signal));
    process.once("exit", () => {
      const pid = running?.child.pid;
      if (pid && process.platform !== "win32")
        try {
          process.kill(-pid, "SIGKILL");
        } catch {}
    });
  }

  restarting = (async () => {
    const entry = await bringUp();
    if (!entry) {
      log("ADE could not start. Run `ade --stock` to start it without your changes.");
      return finish(1);
    }
    announced = true;
    watch(entry);
    onReady?.(url);
  })();

  return { done, stop, pid: () => running?.child.pid };
}
