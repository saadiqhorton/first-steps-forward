// "Try it": run the change's built ADE on a free loopback port with a
// throwaway HOME, so the user can use it before keeping it. Test data only:
// the preview never sees the user's ~/.ade.
import { existsSync, promises as fs, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { allocatePort as defaultAllocate } from "../ports.mjs";
import { processRunsIn, spawnCommand, stopProcess } from "../spawn.mjs";
import { CustomizeError, findChange, viewOf } from "./changes.mjs";

const PREVIEWABLE = ["ready", "failed", "needs-you"];
const ACTIVE = ["starting", "running"];
const OUTPUT_LINES = 200;
const SHOWN_LINES = 40;

const tail = (lines, n = SHOWN_LINES) => lines.slice(-n).join("\n").trim();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The environment the preview runs with: no ADE_* settings of this ADE, a throwaway HOME. */
export function previewEnv(home, base = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(base))
    if (!key.startsWith("ADE_") && key !== "PORT" && value !== undefined) env[key] = value;
  return { ...env, HOME: home, USERPROFILE: home };
}

/** One GET; resolves true when the server answered at all (any status below 500). */
function answers(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

/** Linux can confirm the pid still runs ADE's launcher, not some recycled process. */
function runsLauncher(pid) {
  if (process.platform !== "linux") return true;
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("ade.mjs");
  } catch {
    return false;
  }
}

/**
 * Previews of in-progress changes. At most one runs at a time.
 * @param {any} ctx the customize context (paths, git, run, data, changed, deps)
 * @param {{ timeout?: number, allocatePort?: typeof defaultAllocate, spawn?: typeof spawnCommand, node?: string }} [options]
 */
export function createPreviews(
  ctx,
  {
    timeout = 30_000,
    allocatePort = defaultAllocate,
    spawn = spawnCommand,
    node = process.execPath,
  } = {},
) {
  /** changeId → { child, closed: Promise<void> } */
  const children = new Map();
  /** changeId → start generation; a stop or a newer start makes an older start give up. */
  const generations = new Map();
  /** changeId → the start in flight (tests and shutdown wait on it). */
  const tasks = new Map();
  let generation = 0;

  const homeOf = (change) => path.join(ctx.paths.homes, `preview-${change.id}`);
  const set = (change, preview) => {
    change.preview = preview;
    change.updatedAt = new Date(ctx.now()).toISOString();
    ctx.changed();
  };
  const isLive = (change, gen) =>
    generations.get(change.id) === gen && change.preview?.status === "starting";

  async function sourceDir() {
    try {
      return await fs.realpath(ctx.paths.source);
    } catch {
      return ctx.paths.source;
    }
  }

  async function killRecorded(change) {
    const pid = change.previewProcess?.pid;
    if (pid && runsLauncher(pid) && (await processRunsIn(pid, await sourceDir()))) stopProcess(pid);
  }

  /** Stop the change's preview (a no-op when none runs). */
  async function stop(changeId) {
    const change = ctx.data.changes.find((item) => item.id === changeId);
    generations.set(changeId, ++generation);
    const running = children.get(changeId);
    if (running) {
      children.delete(changeId);
      stopProcess(running.child);
      const done = await Promise.race([running.closed.then(() => true), delay(5000)]);
      if (!done && running.child.pid && process.platform !== "win32") {
        try {
          process.kill(-running.child.pid, "SIGKILL");
        } catch {}
      }
    } else if (change) await killRecorded(change);
    if (!change) return;
    const was = change.preview?.status;
    delete change.previewProcess;
    if (was && was !== "stopped") set(change, { status: "stopped" });
    await fs.rm(homeOf(change), { recursive: true, force: true }).catch(() => {});
  }

  async function launch(change, gen) {
    const source = ctx.paths.source;
    const branch = `change/${change.id}`;
    const head = await ctx.git(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (head.stdout.trim() !== branch)
      throw new Error("Your copy is not on this change right now, so it cannot be tried.");
    const sha = await ctx.git.must(["rev-parse", "HEAD"]);
    const dirty = (await ctx.git(["status", "--porcelain"])).stdout.trim() !== "";
    const built =
      change.build?.sha === sha && !dirty && existsSync(path.join(source, ".output", "public"));
    if (!built) {
      set(change, { status: "starting", step: "build" });
      const buildHome = path.join(ctx.paths.homes, `check-${change.id}`);
      await fs.mkdir(buildHome, { recursive: true, mode: 0o700 });
      const result = await ctx.run("npm", ["run", "build"], {
        cwd: source,
        env: { HOME: buildHome, USERPROFILE: buildHome, CI: "1" },
        timeout: ctx.checkTimeout,
      });
      if (!isLive(change, gen)) return;
      if (result.code !== 0 || result.timedOut) {
        delete change.build;
        return set(change, {
          status: "failed",
          step: "build",
          error: result.timedOut
            ? "Building this version took too long."
            : "Building this version failed.",
          output: tail(`${result.stdout}\n${result.stderr}`.split(/\r?\n/)),
        });
      }
      change.build = dirty ? undefined : { sha };
    }
    set(change, { status: "starting", step: "start", ...(built ? {} : { rebuilt: true }) });

    const port = await allocatePort();
    const home = homeOf(change);
    await fs.rm(home, { recursive: true, force: true });
    await fs.mkdir(home, { recursive: true, mode: 0o700 });
    if (!isLive(change, gen)) return;
    const output = [];
    const child = spawn(node, [path.join(source, "bin", "ade.mjs"), "--port", String(port)], {
      cwd: source,
      env: previewEnv(home),
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: process.platform !== "win32",
    });
    let exited = null;
    const closed = new Promise((resolve) => {
      child.on("error", (error) => {
        output.push(error.message);
        exited ??= { code: null };
        resolve(undefined);
      });
      child.on("close", (code, signal) => {
        exited ??= { code, signal };
        resolve(undefined);
      });
    });
    const line = (data) => {
      output.push(...data.toString().split(/\r?\n/).filter(Boolean));
      if (output.length > OUTPUT_LINES) output.splice(0, output.length - OUTPUT_LINES);
    };
    child.stdout?.on("data", line);
    child.stderr?.on("data", line);
    children.set(change.id, { child, closed });
    change.previewProcess = { pid: child.pid, port };
    ctx.changed();

    void closed.then(() => {
      if (children.get(change.id)?.child === child) children.delete(change.id);
      // A stop, a timeout or a newer start owns the record now.
      if (generations.get(change.id) !== gen) return;
      const wasRunning = change.preview?.status === "running";
      if (!wasRunning && change.preview?.status !== "starting") return;
      generations.set(change.id, ++generation);
      delete change.previewProcess;
      set(change, {
        status: "failed",
        ...(wasRunning ? {} : { step: "start" }),
        error: wasRunning
          ? "Your version of ADE stopped on its own."
          : "Your version of ADE stopped before it was ready.",
        output: tail(output),
      });
    });

    const url = `http://127.0.0.1:${port}/`;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (exited || !isLive(change, gen)) return;
      if (await answers(`${url}api/bootstrap`)) {
        if (!isLive(change, gen) || exited) return;
        return set(change, { status: "running", url, port, ...(built ? {} : { rebuilt: true }) });
      }
      await delay(200);
    }
    if (!isLive(change, gen)) return;
    generations.set(change.id, ++generation);
    children.delete(change.id);
    stopProcess(child);
    delete change.previewProcess;
    set(change, {
      status: "failed",
      step: "start",
      error: `Your version of ADE did not answer within ${Math.round(timeout / 1000)} seconds.`,
      output: tail(output),
    });
  }

  return {
    /** Start (or keep) the change's preview; the result is the change as it stands now. */
    async start(changeId) {
      const change = findChange(ctx, changeId);
      if (ctx.data.setup.status !== "ready")
        throw new CustomizeError(409, "Set up customization first.");
      const live = viewOf(ctx, change);
      if (!PREVIEWABLE.includes(live.status) || change.commit)
        throw new CustomizeError(
          409,
          live.status === "kept" || live.status === "removed"
            ? "A kept change is already part of your version."
            : "Wait for the agent and the checks to finish first.",
        );
      if (ACTIVE.includes(change.preview?.status)) return viewOf(ctx, change);
      for (const other of ctx.data.changes)
        if (other.id !== change.id && ACTIVE.includes(other.preview?.status)) await stop(other.id);
      const gen = ++generation;
      generations.set(change.id, gen);
      change.triedAt ??= new Date(ctx.now()).toISOString();
      set(change, { status: "starting" });
      const task = launch(change, gen)
        .catch((error) => {
          if (!isLive(change, gen)) return;
          const running = children.get(change.id);
          if (running) stopProcess(running.child);
          children.delete(change.id);
          delete change.previewProcess;
          set(change, { status: "failed", error: error?.message ?? String(error) });
        })
        .finally(() => {
          if (tasks.get(change.id) === task) tasks.delete(change.id);
        });
      tasks.set(change.id, task);
      return viewOf(ctx, change);
    },

    stop,

    /** Stop every preview (before git work that changes the copy). */
    async stopAll() {
      const ids = new Set([
        ...children.keys(),
        ...ctx.data.changes
          .filter((change) => ACTIVE.includes(change.preview?.status) || change.previewProcess)
          .map((change) => change.id),
      ]);
      for (const id of ids) await stop(id);
    },

    /** ADE is shutting down: signal every preview now (synchronous; safe in an exit handler). */
    shutdown() {
      for (const [id, { child }] of children) {
        generations.set(id, ++generation);
        stopProcess(child);
        const change = ctx.data.changes.find((item) => item.id === id);
        if (change) {
          delete change.previewProcess;
          change.preview = { status: "stopped" };
        }
      }
      children.clear();
    },

    /** ADE started: previews from before are gone; stop any leftover of ours, never anyone else's. */
    async reset() {
      for (const change of ctx.data.changes) {
        if (!change.preview || (!ACTIVE.includes(change.preview.status) && !change.previewProcess))
          continue;
        await killRecorded(change);
        delete change.previewProcess;
        change.preview = { status: "stopped" };
      }
    },

    /** Wait for starts in flight (tests). */
    async settled() {
      await Promise.all(tasks.values());
    },
  };
}
