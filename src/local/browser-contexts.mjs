// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/server/src/preview/ServerBrowserContexts.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
//
// Owns the headless browser's Playwright resources. Persistent profiles each get their own
// launchPersistentContext under `profilesDir`; isolated (incognito) contexts share one launched
// browser. Playwright launches Chrome over a pipe, so no DevTools port is opened and Chrome exits
// with ADE.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

import { sandboxDisabled } from "./browser-host.mjs";
import { BROWSER_RENDER_SCALE, DEFAULT_VIEWPORT } from "../shared/browser-contract.mjs";

export const INCOGNITO_PROFILE_ID = "incognito";
export const CONTEXT_VIEWPORT = DEFAULT_VIEWPORT;
const CONTEXT_OPTIONS = { viewport: CONTEXT_VIEWPORT, deviceScaleFactor: BROWSER_RENDER_SCALE };
const noop = () => {};

const UA_PLATFORMS = { darwin: "macOS", linux: "Linux", win32: "Windows" };

/** Sites block a user agent that disagrees with `Sec-CH-UA`, so both change together. */
export function chromeIdentity(headlessUserAgent, host) {
  const version = /HeadlessChrome\/((\d+)[\d.]*)/.exec(headlessUserAgent);
  const fullVersion = version?.[1];
  const major = version?.[2];
  if (!version || !fullVersion || !major) return null;
  const brands = (names) => [
    { brand: "Chromium", version: names(major) },
    { brand: "Google Chrome", version: names(major) },
    { brand: "Not A(Brand", version: names("99") },
  ];
  return {
    userAgent: headlessUserAgent.replace(version[0], `Chrome/${major}.0.0.0`),
    userAgentMetadata: {
      brands: brands((value) => value),
      fullVersionList: brands((value) => (value === major ? fullVersion : `${value}.0.0.0`)),
      platform: UA_PLATFORMS[host.platform] ?? "Unknown",
      platformVersion: host.platform === "linux" ? host.release : "",
      architecture: host.arch.startsWith("arm") ? "arm" : "x86",
      bitness: host.arch.endsWith("64") ? "64" : "32",
      model: "",
      mobile: false,
      wow64: false,
    },
  };
}

/** Presents the page as ordinary Chrome instead of HeadlessChrome, on this CDP session. */
export async function presentAsChrome(
  cdp,
  host = { platform: process.platform, arch: process.arch },
) {
  const { userAgent } = await cdp.send("Browser.getVersion");
  const identity = chromeIdentity(userAgent, { ...host, release: os.release() });
  if (identity) await cdp.send("Emulation.setUserAgentOverride", identity);
}

/**
 * @param {{
 *   profilesDir: string,
 *   executable: () => Promise<string>,
 *   diagnose?: (executable: string, cause: unknown) => Promise<Error | undefined>,
 *   env?: NodeJS.ProcessEnv,
 *   onContextClose?: (context: import("playwright-core").BrowserContext) => void,
 *   launcher?: Pick<typeof chromium, "launch" | "launchPersistentContext">,
 * }} options
 */
export function createBrowserContexts({
  profilesDir,
  executable,
  diagnose,
  env = process.env,
  onContextClose,
  launcher = chromium,
}) {
  /** @type {Map<string, Promise<import("playwright-core").BrowserContext>>} */
  const contexts = new Map();
  /** @type {Map<string, Promise<void>>} */
  const clearing = new Map();
  /** Keys of the contexts that live on the shared browser (isolated and incognito ones). */
  const shared = new Set();
  /** @type {Promise<import("playwright-core").Browser> | undefined} */
  let browser;
  /** @type {Promise<void> | undefined} */
  let closing;

  async function launchOptions() {
    const executablePath = await executable();
    return {
      executablePath,
      env,
      args: [
        "--disable-gpu",
        "--force-device-scale-factor=2",
        "--disable-blink-features=AutomationControlled",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
      headless: true,
      // Only an explicit operator opt-out disables sandboxing. Launch errors never do.
      chromiumSandbox: !sandboxDisabled(env),
    };
  }

  async function launch(options, start) {
    try {
      return await start();
    } catch (cause) {
      throw (await diagnose?.(options.executablePath, cause).catch(() => undefined)) ?? cause;
    }
  }

  function sharedBrowser() {
    if (!browser) {
      const launched = launchOptions().then(async (options) => {
        const instance = await launch(options, () => launcher.launch(options));
        instance.on("disconnected", () => {
          if (browser === launched) browser = undefined;
        });
        return instance;
      });
      browser = launched;
      launched.catch(() => {
        if (browser === launched) browser = undefined;
      });
    }
    return browser;
  }

  /** Closes the shared browser once no context lives on it, so its Chrome process exits. */
  function releaseSharedBrowser() {
    if (shared.size > 0 || !browser) return;
    const released = browser;
    // Unset first: a context requested while it shuts down launches a fresh browser.
    browser = undefined;
    released.then((instance) => instance.close()).catch(noop);
  }

  function profileDirectory(profileId) {
    const encoded = encodeURIComponent(profileId);
    return path.join(
      profilesDir,
      profileId === "." || profileId === ".." ? encoded.replaceAll(".", "%2E") : encoded,
    );
  }

  async function createContext(profileId, isolationKey) {
    if (isolationKey !== undefined || profileId === INCOGNITO_PROFILE_ID) {
      return (await sharedBrowser()).newContext(CONTEXT_OPTIONS);
    }
    const directory = profileDirectory(profileId);
    const options = await launchOptions();
    await fs.mkdir(directory, { recursive: true });
    return launch(options, () =>
      launcher.launchPersistentContext(directory, { ...options, ...CONTEXT_OPTIONS }),
    );
  }

  return {
    /**
     * The context for a persistent profile, or a fresh isolated one per `isolationKey`.
     * @returns {Promise<import("playwright-core").BrowserContext>}
     */
    contextFor(profileId, isolationKey) {
      if (closing) return Promise.reject(new Error("The agent browser is closed."));
      const key = JSON.stringify([profileId, isolationKey ?? null]);
      const cached = contexts.get(key);
      if (cached) return cached;
      const onSharedBrowser = isolationKey !== undefined || profileId === INCOGNITO_PROFILE_ID;
      if (onSharedBrowser) shared.add(key);
      const forget = () => {
        // A newer context may already hold this key while the old one finishes closing.
        if (contexts.get(key) !== pending) return;
        contexts.delete(key);
        if (shared.delete(key)) releaseSharedBrowser();
      };
      const cleared = clearing.get(key)?.catch(noop) ?? Promise.resolve();
      const pending = cleared
        .then(() => createContext(profileId, isolationKey))
        .then(async (context) => {
          context.on("close", () => {
            forget();
            onContextClose?.(context);
          });
          if (closing) {
            await context.close().catch(noop);
            throw new Error("The agent browser is closed.");
          }
          return context;
        });
      contexts.set(key, pending);
      pending.catch(forget);
      return pending;
    },

    /** Closes the profile's context and deletes everything it stored. */
    async clearProfile(profileId) {
      if (profileId === INCOGNITO_PROFILE_ID) return;
      const key = JSON.stringify([profileId, null]);
      const run = (async () => {
        const pending = contexts.get(key);
        if (pending) {
          contexts.delete(key);
          const context = await pending.catch(() => undefined);
          await context?.close();
        }
        await fs.rm(profileDirectory(profileId), { recursive: true, force: true });
      })();
      clearing.set(key, run);
      try {
        await run;
      } finally {
        if (clearing.get(key) === run) clearing.delete(key);
      }
    },

    close() {
      closing ??= (async () => {
        await Promise.allSettled(
          [...contexts.values()].map(async (pending) => (await pending).close()),
        );
        const instance = await browser?.catch(() => undefined);
        await instance?.close().catch(noop);
        contexts.clear();
      })();
      return closing;
    },
  };
}
