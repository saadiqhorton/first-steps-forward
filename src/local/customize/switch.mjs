// Switching ADE to the user's version: after Keep or Remove, prepare a kept
// build of `mine`; on "Restart ADE", wait until no agent in the workspace is
// working, back up workspace.json, then ask the launcher to restart on it.
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { CustomizeError } from "./changes.mjs";
import { prepareBuild, pruneBuilds, readCurrent, setCurrent, usableBuild } from "./builds.mjs";

export const BACKUPS_KEPT = 5;
const BUSY = ["working", "verifying"];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Copy workspace.json to `self/backups/<timestamp>.json`, keeping the newest five.
 * @returns {Promise<string|null>} the backup's path, or null when there is no workspace yet
 */
export async function backupWorkspace(paths, at = Date.now(), kept = BACKUPS_KEPT) {
  if (!existsSync(paths.workspace)) return null;
  await fs.mkdir(paths.backups, { recursive: true, mode: 0o700 });
  const stamp = new Date(at).toISOString().replace(/[:.]/g, "-");
  let file = path.join(paths.backups, `${stamp}.json`);
  for (let n = 2; existsSync(file); n++) file = path.join(paths.backups, `${stamp}-${n}.json`);
  await fs.copyFile(paths.workspace, file);
  await fs.chmod(file, 0o600).catch(() => {});
  const all = (await fs.readdir(paths.backups)).filter((name) => name.endsWith(".json")).sort();
  for (const old of all.slice(0, Math.max(0, all.length - kept)))
    await fs.rm(path.join(paths.backups, old), { force: true });
  return file;
}

/** Sessions anywhere in the workspace that an agent is working or verifying in. */
export const busySessions = (sessions = []) =>
  sessions.filter((session) => BUSY.includes(session.status)).length;

/**
 * @typedef {{
 *   restart: (() => void | Promise<void>) | null,
 *   running: string | null,
 *   stockFlag?: boolean,
 *   command?: string,
 * }} LauncherInfo
 *   `restart` is null when nothing can restart ADE for the user (dev server, `npm start`);
 *   `running` is the kept version this process runs (null = stock).
 */

/**
 * @param {any} ctx the customize context
 * @param {{ launcher: () => LauncherInfo, poll?: number, buildTimeout?: number }} options
 */
export function createSwitch(ctx, { launcher, poll = 1000, buildTimeout = 600_000 }) {
  const { paths } = ctx;
  let builds = Promise.resolve();
  let waiting = null;
  const sw = () => ctx.data.switch;
  const set = (patch, { replace = false } = {}) => {
    ctx.data.switch = replace ? patch : { ...sw(), ...patch };
    for (const key of Object.keys(ctx.data.switch))
      if (ctx.data.switch[key] === undefined) delete ctx.data.switch[key];
    ctx.changed();
  };
  const running = () => launcher().running ?? null;

  async function versionOf(sha) {
    try {
      const dir = sha ? path.join(paths.builds, sha) : paths.source;
      return JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")).version ?? "";
    } catch {
      return "";
    }
  }

  /** Build `target` (null = stock) and make it current; the switch is then pending. */
  function queueBuild(target, output = null) {
    set({
      status: "preparing",
      target,
      error: undefined,
      output: undefined,
      rolledBack: undefined,
    });
    const task = builds.then(async () => {
      try {
        if (target)
          await prepareBuild({
            paths,
            run: ctx.run,
            sha: target,
            output,
            timeout: buildTimeout,
            installed: await ctx.installedDeps(),
          });
        await setCurrent(paths, target, await versionOf(target));
        await pruneBuilds(paths);
        if (sw().target !== target) return; // a newer Keep or Remove owns the switch now
        if (sw().status === "preparing") set({ status: target === running() ? "idle" : "pending" });
      } catch (error) {
        if (sw().target !== target) return;
        waiting = null;
        set({
          status: "failed",
          error: error?.message ?? String(error),
          output: error?.output,
          step: "build",
        });
      }
    });
    builds = task;
    return task;
  }

  /** Poll until nothing is working and the version is built, then restart. */
  async function waitAndRestart(info) {
    for (;;) {
      const now = sw();
      if (now.status !== "waiting") return;
      const agents = busySessions(ctx.appState.sessions);
      const checks = ctx.data.changes.some((change) => change.status === "checking");
      const building = !usableBuild(paths, now.target) && now.target !== null;
      const current = await readCurrent(paths);
      const ready = !building && (current?.sha ?? null) === (now.target ?? null);
      if (agents !== now.waitingFor || checks !== !!now.waitingForChecks)
        set({ waitingFor: agents, waitingForChecks: checks || undefined });
      if (!agents && !checks && ready) break;
      await delay(poll);
    }
    await backupWorkspace(paths, ctx.now());
    set({ status: "restarting", waitingFor: undefined, waitingForChecks: undefined });
    await ctx.flush();
    try {
      await info.restart();
    } catch (error) {
      set({ status: "failed", error: `ADE could not restart: ${error?.message ?? error}` });
    }
  }

  return {
    /**
     * `mine` moved (Keep or Remove). `reuseTree` is the tree the checks last
     * built in the copy: when `mine` has exactly that tree, its output is
     * reused instead of building again.
     */
    async mineChanged({ reuseTree = null } = {}) {
      const sha = await ctx.git.must(["rev-parse", "mine"]);
      const tree = await ctx.git.must(["rev-parse", "mine^{tree}"]);
      const stockTree = (await ctx.git(["rev-parse", "stock^{tree}"])).stdout.trim();
      const target = tree === stockTree ? null : sha;
      let output = null;
      const built = path.join(paths.source, ".output");
      if (target && reuseTree === tree && existsSync(path.join(built, "public"))) {
        // Copy now: the next change's checks rebuild the copy's output.
        output = path.join(paths.builds, `${target}.output`);
        await fs.rm(output, { recursive: true, force: true });
        await fs.mkdir(paths.builds, { recursive: true, mode: 0o700 });
        await fs.cp(built, output, { recursive: true }).catch(() => (output = null));
      }
      void queueBuild(target, output);
    },

    /** Restart ADE on the prepared version once no agent is working. */
    async restart() {
      const info = launcher();
      if (!info.restart)
        throw new CustomizeError(
          409,
          `Restart ADE to use your changes: stop it and run \`${info.command ?? "ade"}\`.`,
        );
      const status = sw().status ?? "idle";
      if (["waiting", "restarting"].includes(status)) return sw();
      if (status === "failed" && sw().step === "build") void queueBuild(sw().target ?? null);
      else if (!["pending", "preparing"].includes(status))
        throw new CustomizeError(409, "There is nothing new to restart into.");
      set({ status: "waiting", waitingFor: busySessions(ctx.appState.sessions) });
      waiting = waitAndRestart(info);
      return sw();
    },

    /** ADE started: reconcile the saved switch with what is running now. */
    async reconcile() {
      const info = launcher();
      const now = running();
      const current = await readCurrent(paths);
      const desired = current?.sha ?? null;
      ctx.data.current = {
        stock: now === null,
        sha: now,
        ...(info.stockFlag && desired ? { withoutChanges: true } : {}),
      };
      const status = sw().status ?? "idle";
      if (status === "restarting")
        set(
          now === (sw().target ?? null)
            ? { status: "idle", restartedAt: new Date(ctx.now()).toISOString() }
            : { status: desired === now ? "idle" : "pending" },
          { replace: true },
        );
      else if (status === "waiting") set({ status: "pending", waitingFor: undefined });
      else if (status === "preparing") void queueBuild(sw().target ?? null);
      else if (status === "idle" || status === "pending") {
        if (desired !== now && !info.stockFlag && (desired === null || usableBuild(paths, desired)))
          set({ status: "pending", target: desired });
        else if (status === "pending" && desired === now) set({ status: "idle" });
      }
    },

    /** The switch as the API shows it. */
    view() {
      const info = launcher();
      return {
        ...sw(),
        status: sw().status ?? "idle",
        launcher: !!info.restart,
        ...(info.restart ? {} : { command: info.command ?? "ade" }),
      };
    },

    /** Wait for builds and a restart in flight (tests). */
    async settled() {
      await builds;
      await waiting;
    },
  };
}
