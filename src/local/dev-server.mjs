import { connect, createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { processRunsIn, spawnCommand as spawn, stopProcess as stopChild } from "./spawn.mjs";
import { packageManager } from "./project-scripts.mjs";
import {
  DevCommandError,
  devCommandEnv,
  resolveDevCommand,
  splitCommand,
  withPort,
} from "./dev-command.mjs";

// How long a starting dev server gets to accept a connection: a package script is a Node dev
// server; an approved command may first build or load a model (a Python UI, a Go binary).
const SCRIPT_LISTEN_MS = 10_000;
const COMMAND_LISTEN_MS = 30_000;

/**
 * Each project's single ADE-managed dev server: the records in
 * `state.processes`, the child processes behind them, and their launch.
 * @param {{ state: { projects: any[], processes: any[] }, save: () => Promise<void> }} deps
 */
export function createDevServers({ state, save }) {
  const children = new Map();
  // Process ids whose dev-server port has been confirmed to accept a
  // connection; a process that dies before that never actually listened.
  const listenedProcs = new Set();
  // Consecutive failed port probes per process, so one dropped poll does not
  // turn a healthy server into "Needs checking".
  const misses = new Map();
  let monitorTimer = null;
  // Projects whose dev server a start route is starting right now.
  const devStartClaims = new Set();
  const id = () => randomUUID();
  const now = () => Date.now();
  async function allocatePort() {
    // Ask the OS for an ephemeral port, but do not return it until nothing
    // answers there: WSL's mirrored networking (verified) keeps a just-closed
    // loopback socket connectable for up to ~500 ms, and a false connect would
    // make waitForListening report "running" before the dev server binds.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const port = await new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const allocated = server.address().port;
          server.close(() => resolve(allocated));
        });
      });
      const deadline = Date.now() + 1500;
      while (await probeConnection(port)) {
        if (Date.now() >= deadline) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!(await probeConnection(port))) return port;
      // Still connectable after 1.5 s: something really owns it — fresh port.
    }
    throw new Error("Could not allocate a free loopback port for the dev server.");
  }
  function probeConnection(port) {
    return new Promise((resolve) => {
      if (!port) return resolve(false);
      const socket = connect({ port, host: "127.0.0.1" });
      const finish = (ok) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(1000, () => finish(false));
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
    });
  }
  /**
   * Only a port that actually accepts a connection proves the dev server is
   * up. Bounded poll: returns false if the process dies first or nothing
   * listens within the window, so the caller can surface the captured stderr
   * tail and reset the port instead of reporting a stale "running".
   */
  async function waitForListening(proc, timeoutMs = SCRIPT_LISTEN_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!children.has(proc.id)) return false;
      if (await probeConnection(proc.port)) {
        listenedProcs.add(proc.id);
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }
  /**
   * Launch path shared by POST /processes/:id/start and the project-scoped
   * dev/start endpoint: framework-mapped flags, fresh port, listen-verified
   * "running", and an honest failure that resets the port.
   */
  async function startDevServer(proc, project) {
    if (proc.source === "approved") return startApprovedCommand(proc, project);
    // Map launch flags to the framework actually in the project: next
    // rejects --host outright (it takes -H/--hostname), vite and other
    // --host users take --host/--port, unknown scripts get only the port
    // plus PORT and HOST=127.0.0.1 in the environment. Launch flags are
    // computed per start from the stored base args, so restarts never
    // stack them.
    const { pkg } = await readDevCommand(project);
    const framework = detectFramework(pkg, pkg?.scripts?.dev ?? "");
    proc.port = await allocatePort();
    listenedProcs.delete(proc.id);
    const launch = {
      args: [...baseLaunchArgs(proc.args), ...devServerArgs(framework, proc.port, proc.bin)],
      // Unknown scripts: --port plus PORT and HOST in the environment. HOST is
      // best effort (some servers ignore it and bind wider) — the listen probe
      // then still gates reporting "running", but it connects to 127.0.0.1 and
      // cannot tell a loopback-only bind from a wide one; say so honestly.
      ...(framework === "unknown" ? { env: { PORT: String(proc.port), HOST: "127.0.0.1" } } : {}),
    };
    spawnProcess(proc, project, launch);
    return settleStart(proc, SCRIPT_LISTEN_MS);
  }
  /**
   * Launch the command the user approved for this project (project.devCommand), checked again
   * at every start: its folder must still resolve inside the project. No framework flags, only
   * PORT/HOST and {port}; a fixed port is probed instead of allocating one.
   */
  async function startApprovedCommand(proc, project) {
    listenedProcs.delete(proc.id);
    const refuse = async (message) => {
      proc.port = 0;
      proc.status = "stopped";
      proc.output = [...(proc.output ?? []), message].slice(-300);
      proc.updatedAt = now();
      await save();
      return proc;
    };
    let resolved;
    try {
      if (!project.devCommand)
        throw new DevCommandError("this project has no approved dev command any more");
      resolved = await resolveDevCommand(project.devCommand, project.path);
    } catch (error) {
      return refuse(`ADE did not run the dev command: ${error.message}`);
    }
    if (resolved.port) {
      if (await probeConnection(resolved.port))
        return refuse(
          `Port ${resolved.port} is already in use, so ADE did not start \`${resolved.command}\`. Stop whatever listens there first.`,
        );
      proc.port = resolved.port;
    } else proc.port = await allocatePort();
    const env = await devCommandEnv({
      dir: resolved.dir,
      root: await fs.realpath(project.path),
      port: proc.port,
    });
    const [bin, ...args] = withPort(resolved.argv, proc.port);
    // Where the process runs: how ADE recognises it after a restart (see processRunsIn).
    proc.dir = resolved.dir;
    spawnProcess(proc, project, { bin, args, env, cwd: resolved.dir });
    return settleStart(proc, COMMAND_LISTEN_MS);
  }
  /**
   * "running" is only reported once the port accepts a connection; otherwise surface the
   * captured stderr tail and reset the port.
   */
  async function settleStart(proc, timeoutMs) {
    const up = await waitForListening(proc, timeoutMs);
    if (up) {
      proc.status = "running";
    } else {
      const allocatedPort = proc.port;
      const alive = children.has(proc.id);
      if (alive) stopChild(children.get(proc.id));
      // Either way it never listened, so the allocated port is unusable:
      // reset it here (and again in the close handler) so a failed start
      // never reports a stale port.
      proc.port = 0;
      proc.output.push(
        alive
          ? `The dev server did not accept a connection on port ${allocatedPort} within ${timeoutMs / 1000} seconds; ADE stopped it. Its output is above.`
          : "The dev server exited before it could listen; its error output is above.",
      );
      proc.status = "stopped";
    }
    proc.updatedAt = now();
    await save();
    return proc;
  }
  /**
   * Current dev-server state from the ADE-managed process record, rebuilt on
   * every manifest so start/stop between turns is always reflected. Awareness
   * only: the agent is told the workspace owns start/stop (see constraints).
   */
  function devServerStatus(project) {
    const proc = state.processes.find((p) => p.projectId === project.id);
    if (!proc && project.devScriptNote) return "status unknown (package.json could not be read)";
    const source = devCommandSource(project, proc);
    if (!proc) return project.devCommand ? `stopped; ${source}` : source;
    const status =
      proc.status === "running"
        ? `running on 127.0.0.1:${proc.port}`
        : proc.status === "starting"
          ? "starting"
          : proc.startedAt
            ? "stopped"
            : "stopped (never started this session)";
    return `${status}; ${source}`;
  }
  /** Which dev command applies: the package script, the approved command, or none yet. */
  function devCommandSource(project, proc) {
    if (proc && proc.source !== "approved") return `package.json dev script (${proc.command})`;
    const approved = project.devCommand;
    if (approved)
      return `approved dev command \`${approved.command}\` in ${approved.cwd === "." ? "the project root" : approved.cwd}${approved.port ? ` on fixed port ${approved.port}` : ""} (dev_server_start runs it with no new approval)`;
    if (proc)
      return `dev command \`${proc.command}\`, no longer approved (the next start needs a new approval)`;
    return "no dev command yet: propose one with dev_server_start({ command, cwd })";
  }
  /**
   * Strip dev-server flags an earlier start may have left in the stored base
   * args (an older ADE persisted them into proc.args): the flags themselves
   * plus the value each one was appended with, so restarts never stack them.
   */
  function baseLaunchArgs(args) {
    const out = [];
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === "--" || arg === "127.0.0.1") continue;
      if (["--host", "-H", "--hostname", "--port", "-p"].includes(arg)) {
        i += 1;
        continue;
      }
      out.push(arg);
    }
    return out;
  }
  function spawnProcess(proc, project, launch = {}) {
    const bin = launch.bin ?? proc.bin;
    const args = launch.args ?? proc.args;
    const child = spawn(bin, args, {
      cwd: launch.cwd ?? project.path,
      env: { ...process.env, ...(launch.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: process.platform !== "win32",
    });
    proc.pid = child.pid;
    // "starting" until the port proves it accepts connections (see
    // waitForListening); the start route flips it to "running" or back.
    proc.status = "starting";
    proc.startedAt = now();
    proc.output = [`$ ${bin} ${args.join(" ")}`];
    children.set(proc.id, child);
    const line = (data) => {
      proc.output = [...proc.output, ...data.toString().split(/\r?\n/).filter(Boolean)].slice(-300);
      proc.updatedAt = now();
      save().catch(() => {});
    };
    child.stdout.on("data", line);
    child.stderr.on("data", line);
    child.on("error", (e) => {
      proc.status = "stopped";
      delete proc.pid;
      // A process that never listened leaves no usable port behind.
      if (!listenedProcs.has(proc.id)) proc.port = 0;
      proc.output.push(e.message);
      children.delete(proc.id);
      save().catch(() => {});
    });
    child.on("close", (code) => {
      proc.status = "stopped";
      proc.stoppedAt = now();
      delete proc.pid;
      if (!listenedProcs.has(proc.id)) proc.port = 0;
      proc.exitCode = code;
      proc.output.push(`Process exited (${code ?? "signal"})`);
      children.delete(proc.id);
      save().catch(() => {});
    });
    return proc;
  }
  /**
   * Read package.json fresh on every call (never cached): detect the dev
   * script and its package manager, or return a distinct note when the file
   * is unreadable or malformed instead of silently reporting "no script".
   */
  async function readDevCommand(project) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(project.path, "package.json"), "utf8"));
      const manager = await packageManager(project, pkg);
      return { pkg, devCommand: pkg.scripts?.dev ? `${manager} run dev` : "", note: null };
    } catch (error) {
      // No package.json at all (a Python, Go or Rust project) is simply no dev script.
      if (error?.code === "ENOENT") return { pkg: {}, devCommand: "", note: null };
      return {
        pkg: {},
        devCommand: "",
        note: `package.json could not be read or parsed (${error.message}); the dev script cannot be detected until the file is valid JSON.`,
      };
    }
  }
  /**
   * Re-evaluate scripts.dev for a project — called on every bootstrap poll —
   * and create or refresh its single ADE-managed dev-server record, keeping
   * the record id stable across rescans. Returns whether state changed so
   * the caller can persist cheaply.
   */
  async function refreshDevProcess(project) {
    const { devCommand, note } = await readDevCommand(project);
    const existing = state.processes.find((p) => p.projectId === project.id);
    if (note) {
      const changed = project.devScriptNote !== note;
      if (changed) project.devScriptNote = note;
      return { proc: existing ?? null, changed };
    }
    let changed = false;
    if (project.devScriptNote !== undefined) {
      delete project.devScriptNote;
      changed = true;
    }
    if (!devCommand) {
      if (project.devCommand) return approvedRecord(project, existing, changed);
      // No dev script: retire a stopped record, but never one currently running.
      if (existing && existing.status !== "running" && !children.has(existing.id)) {
        state.processes = state.processes.filter((p) => p.id !== existing.id);
        return { proc: null, changed: true };
      }
      return { proc: existing ?? null, changed };
    }
    if (existing?.source === "approved") {
      // A dev script appeared: it wins from the next start. A running approved command keeps
      // its record until it stops.
      if (existing.status === "running" || children.has(existing.id))
        return { proc: existing, changed };
      delete existing.source;
      delete existing.cwd;
      delete existing.dir;
      changed = true;
    }
    if (existing) {
      if (existing.command !== devCommand) {
        existing.command = devCommand;
        existing.output = [...(existing.output ?? []), `dev script changed: ${devCommand}`].slice(
          -300,
        );
        changed = true;
      }
      // While the record is not running, args always mirror the re-derived
      // devCommand: an older start route persisted mutated args into proc.args
      // (orphan positionals like "run dev -- 3000") and those must never leak
      // into the next launch argv. A running record keeps the args its live
      // child was started with.
      const [bin, ...args] = devCommand.split(" ");
      if (existing.status !== "running" && !children.has(existing.id)) {
        if (existing.bin !== bin || (existing.args ?? []).join(" ") !== args.join(" ")) {
          existing.bin = bin;
          existing.args = args;
          changed = true;
        }
      }
      return { proc: existing, changed };
    }
    const proc = {
      id: id(),
      projectId: project.id,
      name: "Development server",
      command: devCommand,
      bin: devCommand.split(" ")[0],
      args: devCommand.split(" ").slice(1),
      port: 0,
      status: "stopped",
      output: [],
    };
    state.processes.push(proc);
    return { proc, changed: true };
  }
  /**
   * The record for a project that runs its approved dev command: the command as approved (with
   * its {port} tokens) and its folder, so the processes list shows what really runs. A record
   * that is running keeps what its live child was started with.
   */
  function approvedRecord(project, existing, changed) {
    const { command, cwd } = project.devCommand;
    let argv = [];
    try {
      argv = splitCommand(command);
    } catch {}
    const fields = { source: "approved", command, cwd, bin: argv[0] ?? "", args: argv.slice(1) };
    if (!existing) {
      const proc = {
        id: id(),
        projectId: project.id,
        name: "Development server",
        ...fields,
        port: 0,
        status: "stopped",
        output: [],
      };
      state.processes.push(proc);
      return { proc, changed: true };
    }
    if (existing.status === "running" || children.has(existing.id))
      return { proc: existing, changed };
    for (const [key, value] of Object.entries(fields)) {
      if (JSON.stringify(existing[key]) === JSON.stringify(value)) continue;
      existing[key] = value;
      changed = true;
    }
    return { proc: existing, changed };
  }
  function claimStart(projectId) {
    if (devStartClaims.has(projectId)) return false;
    devStartClaims.add(projectId);
    return true;
  }
  function releaseStart(projectId) {
    devStartClaims.delete(projectId);
  }
  function hasRunning(projectId) {
    return state.processes.some((proc) => proc.projectId === projectId && children.has(proc.id));
  }
  async function stopDevServer(proc, project) {
    const child = children.get(proc.id);
    if (!child && proc.pid && !(await processRunsIn(proc.pid, proc.dir ?? project?.path))) {
      delete proc.pid;
      proc.status = "stopped";
      proc.stoppedAt = now();
      proc.updatedAt = now();
      await save();
      return { stalePid: true };
    }
    if (proc.status === "running" || proc.status === "starting") {
      // Visible while the stop is in flight, as Enjoy shows "Stop requested…".
      proc.status = "stopping";
      proc.updatedAt = now();
      await save();
    }
    stopChild(child ?? proc.pid);
    if (proc.status !== "stopped" || proc.pid) {
      proc.status = "stopped";
      proc.stoppedAt = now();
      delete proc.pid;
      proc.updatedAt = now();
      await save();
    }
    misses.delete(proc.id);
    return { stalePid: false };
  }

  /**
   * Confirm what ADE can: a process whose child is gone or whose port no longer answers
   * twice in a row is "unverified" rather than a stale "running". A process that starts
   * answering again returns to "running"; marking it good is for when you know better.
   */
  async function checkProcesses() {
    let changed = false;
    for (const proc of state.processes) {
      if (proc.status !== "running" && proc.status !== "unverified") continue;
      const project = state.projects.find((item) => item.id === proc.projectId);
      if (!project) continue;
      const child = children.get(proc.id);
      const alive = child
        ? true
        : proc.pid
          ? await processRunsIn(proc.pid, proc.dir ?? project.path)
          : false;
      if (!alive) {
        proc.status = "stopped";
        proc.stoppedAt = now();
        proc.updatedAt = now();
        delete proc.pid;
        misses.delete(proc.id);
        changed = true;
        continue;
      }
      const answers = proc.port ? await probeConnection(proc.port) : true;
      if (answers) {
        misses.delete(proc.id);
        if (proc.status === "unverified") {
          proc.status = "running";
          changed = true;
        }
        proc.verifiedAt = now();
        continue;
      }
      if (proc.status === "unverified") continue;
      const count = (misses.get(proc.id) ?? 0) + 1;
      misses.set(proc.id, count);
      if (count >= 2) {
        proc.status = "unverified";
        proc.updatedAt = now();
        misses.delete(proc.id);
        changed = true;
      }
    }
    if (changed) await save();
    return changed;
  }
  function markGood(proc) {
    if (!proc) return false;
    if (proc.status === "unverified") proc.status = "running";
    const changed = proc.status === "running" || !!proc.stopError;
    delete proc.stopError;
    proc.verifiedAt = now();
    proc.updatedAt = now();
    misses.delete(proc.id);
    return changed;
  }
  function startMonitor() {
    if (monitorTimer) return;
    monitorTimer = setInterval(() => {
      checkProcesses().catch(() => {});
    }, 15_000);
    monitorTimer.unref?.();
  }
  function stopMonitor() {
    if (monitorTimer) clearInterval(monitorTimer);
    monitorTimer = null;
  }
  return {
    claimStart,
    releaseStart,
    startDevServer,
    stopDevServer,
    devServerStatus,
    devCommandSource,
    refreshDevProcess,
    hasRunning,
    checkProcesses,
    markGood,
    startMonitor,
    stopMonitor,
  };
}
/**
 * The dev-server flag family the project's framework accepts: `next` rejects
 * --host outright (it takes -H/--hostname and -p), vite and other --host
 * users take --host/--port, and unknown scripts get only the port — the most
 * widely supported flag — with PORT and HOST=127.0.0.1 set in the environment
 * as belt-and-braces (servers that honor neither may bind wider; the listen
 * probe cannot tell, see startDevServer).
 */
export function detectFramework(pkg, devScript = "") {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  if (deps.next || /\bnext\s+dev\b/.test(devScript)) return "next";
  if (deps.vite || /\bvite\b/.test(devScript)) return "vite";
  return "unknown";
}
export function devServerArgs(framework, port, manager = "npm") {
  const flags =
    framework === "next"
      ? ["-H", "127.0.0.1", "-p"]
      : framework === "vite"
        ? ["--host", "127.0.0.1", "--port"]
        : ["--port"];
  // npm run requires `--` to forward flags to the script; pnpm/yarn/bun pass
  // `--` literally into the script argv, which makes vite/next ignore --port.
  return manager === "npm" ? ["--", ...flags, String(port)] : [...flags, String(port)];
}
