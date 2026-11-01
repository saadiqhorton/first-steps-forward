import { connect, createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnCommand as spawn, stopProcess as stopChild } from "./spawn.mjs";
import { packageManager } from "./project-scripts.mjs";

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
  async function waitForListening(proc, timeoutMs = 10000) {
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
    // "running" is only reported once the port accepts a connection;
    // otherwise surface the captured stderr tail and reset the port.
    const up = await waitForListening(proc);
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
          ? `The dev server did not accept a connection on port ${allocatedPort} within 10 seconds; ADE stopped it. Its output is above.`
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
    if (!proc)
      return project.devScriptNote
        ? "status unknown (package.json could not be read)"
        : "no dev script detected";
    if (proc.status === "running") return `running on 127.0.0.1:${proc.port}`;
    if (proc.status === "starting") return "starting";
    return proc.startedAt ? "stopped" : "stopped (never started this session)";
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
    const args = launch.args ?? proc.args;
    const child = spawn(proc.bin, args, {
      cwd: project.path,
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
    proc.output = [`$ ${proc.bin} ${args.join(" ")}`];
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
      // No dev script: retire a stopped record, but never one currently running.
      if (existing && existing.status !== "running" && !children.has(existing.id)) {
        state.processes = state.processes.filter((p) => p.id !== existing.id);
        return { proc: null, changed: true };
      }
      return { proc: existing ?? null, changed };
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
  return { children, devStartClaims, startDevServer, devServerStatus, refreshDevProcess };
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
