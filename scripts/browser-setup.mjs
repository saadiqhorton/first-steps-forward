// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/server/src/cli/browser.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
//
// `npm run browser:setup`: sets up this Linux host for ADE's headless browser. Allows Chrome's
// sandbox where AppArmor blocks it (Ubuntu 23.10+), and installs the shared libraries and fonts
// the browser needs on apt-based systems. It explains what it would do, and asks to be run with
// sudo when that needs root.
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  APPARMOR_PROFILE,
  APPARMOR_PROFILE_PATH,
  DEBIAN_PACKAGES,
  missingLibraries,
  rootError,
  runCapture,
  sandboxBlocked,
  sandboxDisabled,
} from "../src/local/browser-host.mjs";

const FONT_PACKAGES = ["fontconfig", "fonts-liberation"];
const script = fileURLToPath(import.meta.url);
const rootCommand = `sudo ${process.execPath} ${script}`;

function runStep(step, command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", (cause) => reject(new Error(`Could not ${step}: ${cause.message}`)));
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Could not ${step}: ${command} exited with ${code}`)),
    );
  });
}

/** Under sudo the process home is root's, so it falls back to the invoking user's ~/.ade. */
async function adeHome() {
  const sudoUser = process.env.SUDO_USER;
  if (!sudoUser) return path.join(os.homedir(), ".ade");
  const entry = await runCapture("getent", ["passwd", sudoUser]);
  const home = entry.trim().split(":")[5];
  return path.join(home || os.homedir(), ".ade");
}

async function installedBrowser(baseDir) {
  const root = path.join(baseDir, "tools", "chrome-headless-shell");
  for (const platform of await fs.readdir(root).catch(() => [])) {
    for (const version of await fs.readdir(path.join(root, platform)).catch(() => [])) {
      const executable = path.join(root, platform, version, "chrome-headless-shell");
      if (
        await fs.stat(executable).then(
          () => true,
          () => false,
        )
      )
        return executable;
    }
  }
  return null;
}

/** Chrome starts without fonts, but pages then render no text. No fontconfig counts as no font. */
async function fontAvailable() {
  const font = await runCapture("fc-match", ["--format=%{file}", "sans-serif"]);
  return font.trim() !== "";
}

async function aptOffers(name) {
  const policy = await runCapture("apt-cache", ["policy", name]);
  const candidate = /Candidate:\s*(\S+)/.exec(policy)?.[1];
  return candidate !== undefined && candidate !== "(none)";
}

async function main() {
  if (process.platform !== "linux") {
    console.log("Nothing to set up: ADE's browser runs as is on this system.");
    return;
  }
  const isRoot = process.getuid?.() === 0;
  // Root, unless sudo came from another user, is likely ADE's own account.
  const rootWarning =
    isRoot && (process.env.SUDO_USER ?? "root") === "root" && !sandboxDisabled(process.env)
      ? rootError().message
      : undefined;

  const needsProfile = await sandboxBlocked();
  const browser = await installedBrowser(await adeHome());
  const missing = browser ? await missingLibraries(browser) : [];
  const needsFonts = !(await fontAvailable());
  const hasApt = await fs.stat("/usr/bin/apt-get").then(
    () => true,
    () => false,
  );

  if (!needsProfile && missing.length === 0 && !needsFonts) {
    console.log(
      rootWarning ??
        (browser
          ? "This host is ready for ADE's browser."
          : "Chrome's sandbox is allowed here. ADE's browser installs on first use; if it then reports missing libraries, run this again."),
    );
    return;
  }

  if (!isRoot) {
    if (needsProfile)
      console.log(
        `This host blocks the sandbox ADE's browser runs in. Setup installs an AppArmor profile at ${APPARMOR_PROFILE_PATH} that allows it.`,
      );
    if (missing.length > 0)
      console.log(`ADE's browser is missing ${missing.join(", ")}; setup installs them.`);
    if (needsFonts)
      console.log("ADE's browser needs fontconfig and system fonts; setup installs them.");
    console.log(`\nThis needs root. Run:\n\n  ${rootCommand}\n`);
    return;
  }

  if (needsProfile) {
    await fs.writeFile(APPARMOR_PROFILE_PATH, APPARMOR_PROFILE);
    await runStep("load the AppArmor profile", "apparmor_parser", ["-r", APPARMOR_PROFILE_PATH]);
    console.log("Allowed Chrome's sandbox for ADE's browser.");
  }

  if ((missing.length > 0 || needsFonts) && !hasApt) {
    if (missing.length > 0)
      console.log(
        `ADE's browser is missing ${missing.join(", ")}. Install them with your package manager, then run this again.`,
      );
    if (needsFonts)
      console.log(
        "ADE's browser needs fontconfig and system fonts. Install them with your package manager, then run this again.",
      );
    return;
  }
  if (missing.length > 0 || needsFonts)
    await runStep("refresh the package lists", "apt-get", ["update"]);

  if (missing.length > 0) {
    const packages = [];
    for (const names of DEBIAN_PACKAGES) {
      let chosen = names[0];
      for (const name of names) {
        if (await aptOffers(name)) {
          chosen = name;
          break;
        }
      }
      packages.push(chosen);
    }
    await runStep("install the browser's libraries", "apt-get", [
      "install",
      "-y",
      "--no-install-recommends",
      ...packages,
    ]);
    console.log("Installed the browser's libraries.");
  }

  if (needsFonts) {
    await runStep("install the browser's fonts", "apt-get", [
      "install",
      "-y",
      "--no-install-recommends",
      ...FONT_PACKAGES,
    ]);
    if (!(await fontAvailable())) {
      console.log(
        "Font packages are installed, but Fontconfig still finds no system font. Check its configuration and run setup again.",
      );
      return;
    }
    console.log("Installed the browser's fonts. Restart ADE if the browser was already open.");
  }

  console.log(rootWarning ?? "This host is ready for ADE's browser.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
