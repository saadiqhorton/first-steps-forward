// `ade doctor`: one line per thing ADE needs, so "why doesn't X work here" is answered without
// starting the server. Reuses the same detection the UI's agent list and browser host run.
import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { adapters } from "./adapters/index.mjs";
import {
  diagnoseLaunchFailure,
  sandboxBlocked,
  sandboxDisabled,
  SETUP_COMMAND,
} from "./browser-host.mjs";
import { browserRelease, createBrowserInstaller } from "./browser-install.mjs";
import { runCommand } from "./spawn.mjs";
import { loadTerminal } from "./terminal-loader.mjs";
import { MIN_NODE_MAJOR } from "../shared/runtime-contract.mjs";

export { MIN_NODE_MAJOR };

/** @typedef {{ level: "ok" | "warn" | "fail", label: string, detail: string }} Check */

/** @param {Check["level"]} level @param {string} label @param {string} detail @returns {Check} */
const check = (level, label, detail) => ({ level, label, detail });

/** @param {string} version e.g. `process.versions.node` */
export function nodeSupported(version = process.versions.node) {
  return Number(version.split(".")[0]) >= MIN_NODE_MAJOR;
}

/**
 * @param {{
 *   run?: typeof runCommand,
 *   loadTerminalModule?: typeof loadTerminal,
 *   dataDir?: string,
 *   nodeVersion?: string,
 *   platform?: NodeJS.Platform,
 *   arch?: string,
 *   env?: NodeJS.ProcessEnv,
 *   uid?: number | null,
 * }} [deps] injected by tests
 * @returns {Promise<Check[]>}
 */
export async function runDoctor({
  run = runCommand,
  loadTerminalModule = loadTerminal,
  dataDir = path.join(os.homedir(), ".ade"),
  nodeVersion = process.versions.node,
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  uid = process.getuid?.() ?? null,
} = {}) {
  /** @type {Check[]} */
  const checks = [];

  checks.push(
    nodeSupported(nodeVersion)
      ? check("ok", "node", `v${nodeVersion}`)
      : check("fail", "node", `v${nodeVersion}; ADE needs Node ${MIN_NODE_MAJOR} or newer`),
  );

  const git = await run("git", ["--version"], { timeout: 5000 });
  checks.push(
    git.code === 0
      ? check("ok", "git", git.stdout.trim())
      : check("fail", "git", "not found on PATH; ADE needs Git to manage projects"),
  );

  for (const adapter of Object.values(adapters)) {
    const label = adapter.name;
    const res = await run(adapter.bin, ["--version"], { timeout: 5000 });
    if (res.code !== 0) {
      checks.push(check("warn", label, `\`${adapter.bin}\` not installed. ${adapter.installHint}`));
      continue;
    }
    const version = (res.stdout || res.stderr).trim().split(/\r?\n/)[0].slice(0, 100);
    const auth = await adapter.detectAuth(run);
    checks.push(
      auth.signedIn
        ? check("ok", label, `${version}, signed in`)
        : check("warn", label, `${version}, not signed in. ${adapter.signIn.note}`),
    );
  }

  try {
    await loadTerminalModule();
    checks.push(check("ok", "terminal", "node-pty loaded"));
  } catch (error) {
    checks.push(check("warn", "terminal", `unavailable (optional): ${error.message}`));
  }

  checks.push(await browserCheck({ dataDir, platform, arch, env, uid, run }));

  checks.push(await dataDirCheck(dataDir));
  return checks;
}

async function browserCheck({ dataDir, platform, arch, env, uid, run }) {
  const label = "browser";
  const release = browserRelease(platform, arch);
  if (!release)
    return check("warn", label, `no headless browser build for ${platform}-${arch} (optional)`);
  const installer = createBrowserInstaller({ baseDir: dataDir, platform, arch, release });
  const executable = await installer.installed();
  const blockers = [];
  if (platform === "linux" && !sandboxDisabled(env)) {
    if (await sandboxBlocked({ platform })) blockers.push("AppArmor blocks Chrome's sandbox");
  }
  if (executable) {
    const cause = uid === 0 && !sandboxDisabled(env) ? new Error("No usable sandbox") : undefined;
    const explained = await diagnoseLaunchFailure({ executable, cause, platform, uid, run });
    if (explained) blockers.push(explained.message.split(". ")[0]);
  } else if (uid === 0 && !sandboxDisabled(env)) {
    blockers.push("Chrome will not start its sandbox as root");
  }
  const state = executable
    ? `Chrome headless shell ${release.version} installed`
    : `Chrome headless shell ${release.version} not installed; downloads (${Math.round(release.bytes / 1_000_000)} MB) on first use`;
  return blockers.length > 0
    ? check(
        "warn",
        label,
        `${state}; blocked: ${blockers.join("; ")}. Fix: ade browser-setup (${SETUP_COMMAND} from a clone)`,
      )
    : check("ok", label, state);
}

async function dataDirCheck(dataDir) {
  // Checks without creating anything: the nearest existing ancestor decides whether ADE can create it.
  let dir = dataDir;
  for (;;) {
    try {
      await fs.access(dir, constants.W_OK);
      return check("ok", "data dir", `${dataDir} is writable`);
    } catch (error) {
      if (error.code !== "ENOENT")
        return check("fail", "data dir", `${dataDir} is not writable (${dir})`);
      const parent = path.dirname(dir);
      if (parent === dir) return check("fail", "data dir", `${dataDir} cannot be created`);
      dir = parent;
    }
  }
}

const MARK = { ok: "ok  ", warn: "warn", fail: "FAIL" };

/** @param {Check} item */
export const formatCheck = (item) => `${MARK[item.level]}  ${item.label}: ${item.detail}`;
