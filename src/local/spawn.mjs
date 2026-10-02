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
