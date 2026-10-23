// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/server/src/preview/PreviewBrowserHost.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
//
// Why the headless browser would not start on this host, in words a person can act on: missing
// shared libraries, an AppArmor policy that blocks Chrome's sandbox, or running as root. Each
// answer points at `npm run browser:setup` (scripts/browser-setup.mjs), which fixes the first
// two on apt-based Linux.
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";

export const SETUP_COMMAND = "npm run browser:setup";

export const NO_SANDBOX_SIGNATURE = "No usable sandbox";

export const sandboxDisabled = (env) => env.ADE_BROWSER_SANDBOX === "0";

/** Set on Ubuntu 23.10+: unprivileged user namespaces need an AppArmor profile. */
const USERNS_RESTRICTION = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";
export const APPARMOR_PROFILE_PATH = "/etc/apparmor.d/ade-chrome-headless-shell";

/** Modelled on the profile Ubuntu ships for Google Chrome; `unconfined` adds nothing beyond `userns`. */
export const APPARMOR_PROFILE = `# Written by \`${SETUP_COMMAND}\`: lets ADE's headless browser use Chrome's sandbox.
abi <abi/4.0>,
include <tunables/global>

profile ade-chrome-headless-shell /**/tools/chrome-headless-shell/*/*/chrome-headless-shell flags=(unconfined) {
  userns,

  include if exists <local/ade-chrome-headless-shell>
}
`;

/** Ubuntu 24.04 and Debian 13 renamed some with a `t64` suffix; setup installs whichever apt offers. */
export const DEBIAN_PACKAGES = [
  ["libnss3"],
  ["libglib2.0-0t64", "libglib2.0-0"],
  ["libatk1.0-0t64", "libatk1.0-0"],
  ["libatk-bridge2.0-0t64", "libatk-bridge2.0-0"],
  ["libatspi2.0-0t64", "libatspi2.0-0"],
  ["libdbus-1-3"],
  ["libx11-6"],
  ["libxcb1"],
  ["libxcomposite1"],
  ["libxdamage1"],
  ["libxext6"],
  ["libxfixes3"],
  ["libxrandr2"],
  ["libxkbcommon0"],
  ["libgbm1"],
  ["libasound2t64", "libasound2"],
  ["libexpat1"],
];

const coded = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

export const sandboxError = () =>
  coded(
    "browser_sandbox_blocked",
    `This host blocks the sandbox ADE's browser runs in (AppArmor on Ubuntu 23.10+). Run \`${SETUP_COMMAND}\` in the ADE folder once to allow it, then try again.`,
    { setupCommand: SETUP_COMMAND },
  );

export const librariesError = (libraries) =>
  coded(
    "browser_libraries_missing",
    `This host is missing libraries ADE's browser needs (${libraries.join(", ")}). Run \`${SETUP_COMMAND}\` in the ADE folder to install them, then try again.`,
    { setupCommand: SETUP_COMMAND, libraries },
  );

/** Chrome will not start its sandbox as root (crbug.com/638180), which no host setup fixes. */
export const rootError = () =>
  coded(
    "browser_root",
    "Chrome will not start its sandbox as root, so ADE's browser cannot run while ADE runs as root. Run ADE as a non-root user, or set ADE_BROWSER_SANDBOX=0 to run the browser unsandboxed as root.",
  );

/** Runs a short probe; any failure, including a timeout, reads as empty output. */
export function runCapture(command, args, { timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    let output = "";
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      resolve("");
      return;
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(output);
    });
  });
}

const MISSING_LIBRARY = /^\s*(\S+) => not found$/gm;
const LOADER_ERROR = /error while loading shared libraries: ([^:\s]+)/;

/**
 * The browser's own `--version` decides whether any are missing; `ldd` only lists them after the
 * real loader fails, because it can report libraries a host provides another way (NixOS's nix-ld).
 */
export async function missingLibraries(executable, run = runCapture) {
  const loaderError = LOADER_ERROR.exec(await run(executable, ["--version"]))?.[1];
  if (loaderError === undefined) return [];
  const listed = [...(await run("ldd", [executable])).matchAll(MISSING_LIBRARY)].map(
    (match) => match[1],
  );
  return listed.length > 0 ? listed : [loaderError];
}

/**
 * Explains a failed launch, or returns undefined to keep Playwright's own error.
 * @param {{ executable: string, cause: unknown, platform?: NodeJS.Platform, uid?: number | null, run?: typeof runCapture }} input
 */
export async function diagnoseLaunchFailure({
  executable,
  cause,
  platform = process.platform,
  uid = process.getuid?.() ?? null,
  run = runCapture,
}) {
  // Playwright's launch error drops Chrome's own output; its sandbox note survives.
  if (/sandboxing failed|No usable sandbox/i.test(String(cause?.message ?? cause))) {
    // Playwright reports Chrome's refusal to sandbox as root as a sandbox failure too.
    return uid === 0 ? rootError() : sandboxError();
  }
  if (platform !== "linux") return undefined;
  const libraries = await missingLibraries(executable, run);
  return libraries.length === 0 ? undefined : librariesError(libraries);
}

export async function sandboxBlocked({ platform = process.platform, readFile = fs.readFile } = {}) {
  if (platform !== "linux") return false;
  const restricted = await readFile(USERNS_RESTRICTION, "utf8").then(
    (value) => String(value).trim() === "1",
    () => false,
  );
  if (!restricted) return false;
  return !(await readFile(APPARMOR_PROFILE_PATH, "utf8").then(
    () => true,
    () => false,
  ));
}
