// Cross-platform process launching for everything ADE starts: agent CLIs,
// package-manager scripts (dev servers, checks), and harness installs.
//
// On Windows, npm/pnpm/yarn and npm-installed CLIs are `.cmd` shims. Node's
// spawn() cannot run them without a shell: plain `npm` is ENOENT, and
// `npm.cmd` is refused with EINVAL since the CVE-2024-27980 fix. cross-spawn
// resolves the shim through PATHEXT and runs it via cmd.exe with every
// argument escaped (including the double escaping .cmd files need), so ADE
// keeps passing argument arrays and nothing is ever interpolated by a shell.
// Elsewhere this is plain spawn(), so Linux/WSL/macOS behavior is unchanged.
import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import crossSpawn from "cross-spawn";

export function spawnCommand(bin, args, options = {}) {
  return process.platform === "win32"
    ? crossSpawn(bin, args, { ...options, shell: false })
    : spawn(bin, args, options);
}

/**
 * Stop a Windows process and everything it started. Launching a shim goes
 * through cmd.exe, so killing only the direct child would orphan the real
 * dev server (still holding its port). Returns whether taskkill succeeded.
 */
export function killTree(pid, { platform = process.platform, run = spawnSync } = {}) {
  if (platform !== "win32" || !Number.isInteger(pid) || pid <= 0) return false;
  const result = run("taskkill", ["/pid", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
  return result.status === 0;
}

/**
 * Run a command to completion and collect its output. Never rejects: a
 * command that cannot start reports code 127 with the reason on stderr, and
 * `timeout` (ms) ends a command that runs too long with SIGTERM.
 */
export function runCommand(bin, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawnCommand(bin, args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "",
      stderr = "",
      timedOut = false;
    const timer = opts.timeout
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, opts.timeout)
      : null;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}${e.message}` });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });
  });
}

/**
 * Stop a process ADE started, with everything it started: the whole process
 * group on POSIX (ADE spawns long-lived children detached), the tree on
 * Windows. Takes the child or a bare pid; a missing pid is a no-op.
 */
export function stopProcess(child) {
  const pid = typeof child === "number" ? child : child?.pid;
  if (!pid) return;
  try {
    if (process.platform !== "win32") process.kill(-pid, "SIGTERM");
    else if (killTree(pid)) return;
    else if (typeof child === "number") process.kill(pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    try {
      if (typeof child === "number") process.kill(pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch {}
  }
}

/**
 * Whether `pid` is alive and working in `directory`: how ADE recognises its
 * own processes after a restart, so it never signals a recycled pid.
 */
export async function processRunsIn(pid, directory) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") return (await fs.realpath(`/proc/${pid}/cwd`)) === directory;
    if (process.platform === "darwin") {
      const result = await runCommand("lsof", ["-Fn", "-a", "-p", String(pid), "-d", "cwd"], {
        timeout: 3000,
      });
      const cwd = result.stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith("n"))
        ?.slice(1);
      return cwd ? (await fs.realpath(cwd)) === directory : false;
    }
  } catch {}
  return false;
}

/** Full path of `bin` on PATH, or null when it is not installed. */
export async function findOnPath(bin) {
  const res = await runCommand(process.platform === "win32" ? "where" : "which", [bin], {
    timeout: 3000,
  });
  if (res.code !== 0) return null;
  const line = (res.stdout || "").trim().split(/\r?\n/)[0]?.trim();
  return line || null;
}
