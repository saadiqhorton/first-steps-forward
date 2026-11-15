// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/server/src/preview/PreviewBrowser.ts
// and apps/server/src/zipArchive.ts. Copyright (c) 2026 T3 Tools Inc. MIT License; see
// THIRD_PARTY_NOTICES.md.
//
// ADE's agent browser is Chrome for Testing's headless shell, pinned to one release and
// installed into ~/.ade on first use. Every byte is checked against the pinned size and
// SHA-256 before anything is unpacked. Versus T3 this is a plain module: no Effect runtime.
import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";

// To bump the pin, pick a version from
// https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json,
// download each platform's chrome-headless-shell zip, and replace the version and every byte count
// and SHA-256 below.
export const BROWSER_VERSION = "154.0.8037.92";
const ARCHIVES = {
  linux64: {
    bytes: 120_477_194,
    sha256: "636aa5c79f2693632e9921b8bbb050038ba11672e02346c06c20f991aed096f9",
  },
  "linux-arm64": {
    bytes: 121_182_296,
    sha256: "0ed0e47d9e9f639197f508d62ada09e5c6b4c4c60edab3160a9312a733091df6",
  },
  "mac-arm64": {
    bytes: 99_221_129,
    sha256: "77da14e75d7f2568e6f7898d3df7cdc6faac74b15e903b2c9d486ebb6ca9b929",
  },
  "mac-x64": {
    bytes: 104_748_425,
    sha256: "a54292aaacbb77f76f6ef47558e7c51ab884044e0adacca315567f83c060bcc4",
  },
  win32: {
    bytes: 114_295_943,
    sha256: "56b30d2d6c35775ebf8dc3618680f6529e1c38c87f7feb28a16e9904273d51f7",
  },
  win64: {
    bytes: 120_822_223,
    sha256: "3ac2561f02d9d87aadc0399d00b9002d718a4c365624fa67db9e7bfaf6b1a568",
  },
};

const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
const STAGING_STALE_AFTER_MS = 60 * 60_000;
// How long a caller waits on an install in progress. Agent tool calls time out near 60 s.
const DEFAULT_WAIT_MS = 45_000;

const coded = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const megabytes = (bytes) => Math.round(bytes / 1_000_000);

export function chromePlatform(platform, arch) {
  switch (platform) {
    case "linux":
      return arch === "x64" ? "linux64" : arch === "arm64" ? "linux-arm64" : null;
    case "darwin":
      return arch === "arm64" ? "mac-arm64" : arch === "x64" ? "mac-x64" : null;
    case "win32":
      // There is no Windows arm64 build; Windows on Arm runs the x64 one under emulation.
      return arch === "ia32" ? "win32" : arch === "x64" || arch === "arm64" ? "win64" : null;
    default:
      return null;
  }
}

/** The pinned release for this host, or null where Chrome for Testing has no headless shell. */
export function browserRelease(platform = process.platform, arch = process.arch) {
  const chrome = chromePlatform(platform, arch);
  if (chrome === null) return null;
  return {
    version: BROWSER_VERSION,
    platform: chrome,
    url: `https://storage.googleapis.com/chrome-for-testing-public/${BROWSER_VERSION}/${chrome}/chrome-headless-shell-${chrome}.zip`,
    ...ARCHIVES[chrome],
  };
}

const installFailed = (detail, cause) =>
  coded(
    "browser_install_failed",
    `ADE could not install its headless browser: ${detail} Try again.`,
    {
      cause,
    },
  );

/**
 * Installs and finds the pinned headless shell under `<baseDir>/tools/chrome-headless-shell`.
 * @param {{
 *   baseDir: string,
 *   platform?: NodeJS.Platform,
 *   arch?: string,
 *   release?: ReturnType<typeof browserRelease>,
 *   fetchImpl?: typeof fetch,
 *   waitMs?: number,
 *   env?: NodeJS.ProcessEnv,
 * }} options
 */
export function createBrowserInstaller({
  baseDir,
  platform = process.platform,
  arch = process.arch,
  release = browserRelease(platform, arch),
  fetchImpl = fetch,
  waitMs = DEFAULT_WAIT_MS,
  env = process.env,
}) {
  // Never discover or connect to the user's ordinary browser profile. A headed browser is
  // explicitly selected by the operator and still uses ADE's own isolated profiles.
  const headed = env.ADE_BROWSER_HEADED === "1";
  const configuredExecutable = (env.ADE_BROWSER_EXECUTABLE ?? "").trim();
  const installRoot = path.join(
    baseDir,
    "tools",
    "chrome-headless-shell",
    release?.platform ?? `${platform}-${arch}`,
  );
  const executableName =
    platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  /** @type {{ tag: "idle" } | { tag: "installing", done: Promise<string> } | { tag: "installed", executable: string } | { tag: "failed", error: Error }} */
  let state = { tag: "idle" };
  const progress = { downloadedBytes: 0, unpacking: false };
  let gate = Promise.resolve();

  async function systemExecutable() {
    const help =
      "Set ADE_BROWSER_EXECUTABLE to the absolute path of a full Chrome or Chromium executable.";
    if (!configuredExecutable || !path.isAbsolute(configuredExecutable)) {
      throw coded(
        "browser_unsupported",
        `ADE's visible browser needs a local browser executable. ${help}`,
      );
    }
    if (/chrome-headless-shell(?:\.exe)?$/i.test(path.basename(configuredExecutable))) {
      throw coded(
        "browser_unsupported",
        `Chrome's headless shell cannot show passkey dialogs. ${help}`,
      );
    }
    let info;
    try {
      info = await fs.stat(configuredExecutable);
    } catch {
      throw coded("browser_unsupported", `ADE cannot find the selected browser. ${help}`);
    }
    if (!info.isFile() || (platform !== "win32" && (info.mode & 0o111) === 0)) {
      throw coded("browser_unsupported", `The selected browser is not an executable file. ${help}`);
    }
    return configuredExecutable;
  }

  async function installedExecutable() {
    if (!release) return null;
    const executable = path.join(installRoot, release.version, executableName);
    try {
      const info = await fs.stat(executable);
      return info.isFile() && (platform === "win32" || (info.mode & 0o111) !== 0)
        ? executable
        : null;
    } catch {
      return null;
    }
  }

  async function download(archivePath) {
    let response;
    try {
      response = await fetchImpl(release.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch (cause) {
      throw installFailed(
        "The download from storage.googleapis.com failed. Check this machine's network access.",
        cause,
      );
    }
    if (!response.ok || !response.body) {
      throw installFailed(
        `The download from storage.googleapis.com failed (HTTP ${response.status}).`,
      );
    }
    const contentLength = response.headers.get("content-length");
    const contentEncoding = response.headers.get("content-encoding")?.trim().toLowerCase();
    if (
      (!contentEncoding || contentEncoding === "identity") &&
      contentLength !== null &&
      Number(contentLength) !== release.bytes
    ) {
      throw installFailed("The download size did not match the pinned release.");
    }
    const hash = createHash("sha256");
    const file = await fs.open(archivePath, "wx", 0o600);
    try {
      for await (const chunk of response.body) {
        progress.downloadedBytes += chunk.byteLength;
        if (progress.downloadedBytes > release.bytes) {
          throw installFailed("The download was larger than the pinned release.");
        }
        hash.update(chunk);
        await file.write(chunk);
      }
    } catch (cause) {
      if (cause?.code === "browser_install_failed") throw cause;
      throw installFailed(
        "The download from storage.googleapis.com failed. Check this machine's network access.",
        cause,
      );
    } finally {
      await file.close();
    }
    if (progress.downloadedBytes !== release.bytes || hash.digest("hex") !== release.sha256) {
      throw installFailed("The download failed its size or SHA-256 check. Nothing was installed.");
    }
  }

  async function extract(archivePath, destination) {
    const unsafe = () => installFailed("The archive contains an unexpected or unsafe entry.");
    const zip = await new Promise((resolve, reject) =>
      yauzl.open(
        archivePath,
        { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true },
        (error, opened) =>
          error || !opened
            ? reject(installFailed("Could not open the verified archive.", error))
            : resolve(opened),
      ),
    );
    const root = `chrome-headless-shell-${release.platform}/`;
    let foundExecutable = false;
    const next = () =>
      new Promise((resolve, reject) => {
        const cleanup = () => {
          zip.off("entry", onEntry);
          zip.off("end", onEnd);
          zip.off("error", onError);
        };
        const onEntry = (entry) => (cleanup(), resolve(entry));
        const onEnd = () => (cleanup(), resolve(null));
        const onError = (cause) => (
          cleanup(),
          reject(installFailed("The archive could not be read.", cause))
        );
        zip.once("entry", onEntry);
        zip.once("end", onEnd);
        zip.once("error", onError);
        zip.readEntry();
      });
    try {
      await fs.mkdir(destination);
      for (;;) {
        const entry = await next();
        if (!entry) break;
        const unixMode = entry.externalFileAttributes >>> 16;
        const unixType = unixMode & 0o170000;
        const isDirectory = entry.fileName.endsWith("/");
        const relative = entry.fileName.startsWith(root) ? entry.fileName.slice(root.length) : null;
        const target = relative === null ? null : path.resolve(destination, relative);
        if (
          relative === null ||
          target === null ||
          (relative !== "" && !target.startsWith(`${destination}${path.sep}`)) ||
          relative.split("/").includes("..") ||
          (unixType !== 0 && unixType !== (isDirectory ? 0o040000 : 0o100000)) ||
          (entry.generalPurposeBitFlag & 1) !== 0 ||
          ![0, 8].includes(entry.compressionMethod)
        ) {
          throw unsafe();
        }
        if (isDirectory) {
          await fs.mkdir(target, { recursive: true });
          continue;
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        const readable = await new Promise((resolve, reject) =>
          zip.openReadStream(entry, (cause, stream) =>
            cause || !stream
              ? reject(installFailed("Could not read an archive member.", cause))
              : resolve(stream),
          ),
        );
        await pipeline(readable, createWriteStream(target, { flags: "wx" }));
        // The binary and its shared libraries carry exec bits in the archive.
        if (platform !== "win32" && (unixMode & 0o777) !== 0) {
          await fs.chmod(target, unixMode & 0o777);
        }
        if (relative === executableName) foundExecutable = true;
      }
    } catch (cause) {
      if (cause?.code === "browser_install_failed") throw cause;
      throw installFailed(
        "Could not unpack the browser. Check free disk space in ADE's home directory.",
        cause,
      );
    } finally {
      zip.close();
    }
    if (!foundExecutable) {
      throw installFailed("The archive does not contain chrome-headless-shell.");
    }
  }

  async function install() {
    await fs.mkdir(installRoot, { recursive: true });
    // Staging shares the install root's filesystem so publishing is one rename.
    const staging = await fs.mkdtemp(path.join(installRoot, ".install-"));
    try {
      const archivePath = path.join(staging, "download.zip");
      const unpacked = path.join(staging, "browser");
      await download(archivePath);
      progress.unpacking = true;
      await extract(archivePath, unpacked);
      const destination = path.join(installRoot, release.version);
      await fs.rm(destination, { recursive: true, force: true });
      await fs.rename(unpacked, destination);
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
    // Two ADE instances can share a home, so a staging directory touched within the last hour
    // may be another instance's install in progress and stays.
    const now = Date.now();
    for (const name of await fs.readdir(installRoot).catch(() => [])) {
      if (name === release.version) continue;
      const target = path.join(installRoot, name);
      try {
        if (name.startsWith(".install-")) {
          const info = await fs.stat(target);
          if (now - info.mtimeMs < STAGING_STALE_AFTER_MS) continue;
        }
        await fs.rm(target, { recursive: true, force: true });
      } catch {}
    }
    return path.join(installRoot, release.version, executableName);
  }

  // Serializes state changes, so two callers never start two installs.
  function withGate(fn) {
    const run = gate.then(fn);
    gate = run.catch(() => {});
    return run;
  }

  const join = () =>
    withGate(async () => {
      if (state.tag === "installing") return state;
      if (state.tag === "failed") {
        const failed = state;
        state = { tag: "idle" };
        return failed;
      }
      const installed = await installedExecutable();
      if (installed) {
        state = { tag: "installed", executable: installed };
        return state;
      }
      progress.downloadedBytes = 0;
      progress.unpacking = false;
      // Installs belong to the installer, so they finish even when no caller is still waiting.
      const done = install().then(
        (executable) => {
          state = { tag: "installed", executable };
          return executable;
        },
        (cause) => {
          const error =
            cause?.code === "browser_install_failed"
              ? cause
              : installFailed("Could not save the browser in ADE's home directory.", cause);
          state = { tag: "failed", error };
          throw error;
        },
      );
      done.catch(() => {});
      state = { tag: "installing", done };
      return state;
    });

  function installingError() {
    const progressText = progress.unpacking
      ? "unpacking"
      : `${megabytes(progress.downloadedBytes)} of ${megabytes(release.bytes)} MB downloaded`;
    return coded(
      "browser_installing",
      `ADE is installing its headless browser (${progressText}). Try again in a minute.`,
      { progress: snapshotProgress() },
    );
  }

  function unsupportedError() {
    return coded(
      "browser_unsupported",
      `ADE's headless browser is not available on ${platform}-${arch}: Chrome for Testing has no headless shell for it.`,
    );
  }

  function snapshotProgress() {
    return {
      downloadedBytes: progress.downloadedBytes,
      totalBytes: release?.bytes ?? 0,
      unpacking: progress.unpacking,
    };
  }

  return {
    release,

    /**
     * Path to the installed headless shell. The first call starts the install; callers wait for
     * it up to `wait` ms and then get its progress as a `browser_installing` error, while the
     * install keeps running.
     * @param {{ wait?: number }} [options]
     * @returns {Promise<string>}
     */
    async executable({ wait = waitMs } = {}) {
      if (headed) {
        try {
          const executable = await systemExecutable();
          state = { tag: "installed", executable };
          return executable;
        } catch (error) {
          state = { tag: "failed", error };
          throw error;
        }
      }
      if (!release) throw unsupportedError();
      const current = await join();
      if (current.tag === "installed") return current.executable;
      if (current.tag === "failed") throw current.error;
      let timer;
      const timeout = new Promise((_resolve, reject) => {
        if (Number.isFinite(wait)) timer = setTimeout(() => reject(installingError()), wait);
      });
      // A caller that saw the install fail clears it, so the next call starts a fresh one.
      const done = current.done.catch((error) =>
        withGate(() => {
          if (state.tag === "failed" && state.error === error) state = { tag: "idle" };
        }).then(() => {
          throw error;
        }),
      );
      try {
        return await Promise.race([done, timeout]);
      } finally {
        clearTimeout(timer);
      }
    },

    /** The installed executable, without starting an install. */
    installed: () => (headed ? systemExecutable().catch(() => null) : installedExecutable()),

    /** Install state for status displays; never starts an install. */
    status() {
      if (headed) {
        if (state.tag === "failed") return { state: "failed", detail: state.error.message };
        return { state: state.tag === "installed" ? "installed" : "idle" };
      }
      if (!release) return { state: "unsupported", detail: unsupportedError().message };
      if (state.tag === "installing") return { state: "installing", progress: snapshotProgress() };
      if (state.tag === "failed") return { state: "failed", detail: state.error.message };
      return { state: state.tag === "installed" ? "installed" : "idle" };
    },
  };
}
