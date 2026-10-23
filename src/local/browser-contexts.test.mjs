import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  chromeIdentity,
  createBrowserContexts,
  INCOGNITO_PROFILE_ID,
  presentAsChrome,
} from "./browser-contexts.mjs";

class FakeContext extends EventEmitter {
  closed = false;
  constructor(kind, options) {
    super();
    this.kind = kind;
    this.options = options;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }
}

function fakeLauncher({ failLaunch } = {}) {
  const calls = { launch: [], persistent: [], browsers: [] };
  return {
    calls,
    async launch(options) {
      calls.launch.push(options);
      if (failLaunch) throw failLaunch;
      const browser = new EventEmitter();
      browser.contexts = [];
      browser.newContext = async (contextOptions) => {
        const context = new FakeContext("isolated", contextOptions);
        browser.contexts.push(context);
        return context;
      };
      browser.close = async () => browser.emit("disconnected");
      calls.browsers.push(browser);
      return browser;
    },
    async launchPersistentContext(directory, options) {
      calls.persistent.push({ directory, options });
      if (failLaunch) throw failLaunch;
      return new FakeContext("persistent", options);
    },
  };
}

function setup(options = {}) {
  const profilesDir = mkdtempSync(path.join(os.tmpdir(), "ade-browser-profiles-"));
  const launcher = fakeLauncher(options);
  const contexts = createBrowserContexts({
    profilesDir,
    executable: async () => "/opt/chrome-headless-shell",
    env: options.env ?? {},
    diagnose: options.diagnose,
    launcher,
  });
  return { profilesDir, launcher, contexts };
}

test("chromeIdentity presents HeadlessChrome as Chrome with matching client hints", () => {
  const identity = chromeIdentity(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/154.0.8037.92 Safari/537.36",
    { platform: "linux", arch: "x64", release: "6.9.0" },
  );
  assert.match(identity.userAgent, /Chrome\/154\.0\.0\.0 Safari/);
  assert.doesNotMatch(identity.userAgent, /Headless/);
  assert.deepEqual(
    identity.userAgentMetadata.brands.map((brand) => brand.brand),
    ["Chromium", "Google Chrome", "Not A(Brand"],
  );
  assert.equal(identity.userAgentMetadata.fullVersionList[0].version, "154.0.8037.92");
  assert.equal(identity.userAgentMetadata.platform, "Linux");
  assert.equal(identity.userAgentMetadata.platformVersion, "6.9.0");
  assert.equal(
    chromeIdentity("Mozilla/5.0 Chrome/154.0", { platform: "linux", arch: "x64" }),
    null,
  );
});

test("presentAsChrome overrides the user agent on the page's CDP session", async () => {
  const sent = [];
  const cdp = {
    async send(method, params) {
      sent.push([method, params]);
      if (method === "Browser.getVersion")
        return { userAgent: "Mozilla/5.0 HeadlessChrome/154.0.1.2 Safari/537.36" };
      return {};
    },
  };
  await presentAsChrome(cdp, { platform: "darwin", arch: "arm64" });
  const [method, params] = sent.at(-1);
  assert.equal(method, "Emulation.setUserAgentOverride");
  assert.equal(params.userAgentMetadata.platform, "macOS");
  assert.equal(params.userAgentMetadata.architecture, "arm");
});

test("persistent profiles launch headless and sandboxed in their own directory, once", async () => {
  const { profilesDir, launcher, contexts } = setup();
  const first = await contexts.contextFor("project-1");
  assert.equal(await contexts.contextFor("project-1"), first);
  const [{ directory, options }] = launcher.calls.persistent;
  assert.equal(directory, path.join(profilesDir, "project-1"));
  assert.ok(existsSync(directory));
  assert.equal(options.headless, true);
  assert.equal(options.chromiumSandbox, true);
  assert.equal(options.executablePath, "/opt/chrome-headless-shell");
  assert.deepEqual(options.ignoreDefaultArgs, ["--enable-automation"]);
  assert.ok(options.args.includes("--disable-blink-features=AutomationControlled"));
  assert.deepEqual(options.viewport, { width: 1280, height: 800 });
  assert.equal(options.deviceScaleFactor, 2);
  // A closed context is launched again on the next request.
  await first.close();
  assert.notEqual(await contexts.contextFor("project-1"), first);
  assert.equal(launcher.calls.persistent.length, 2);
});

test("incognito contexts share one launched browser, one context per isolation key", async () => {
  const { launcher, contexts } = setup();
  const a = await contexts.contextFor(INCOGNITO_PROFILE_ID, "project-a");
  const b = await contexts.contextFor(INCOGNITO_PROFILE_ID, "project-b");
  assert.notEqual(a, b);
  assert.equal(a.kind, "isolated");
  assert.equal(await contexts.contextFor(INCOGNITO_PROFILE_ID, "project-a"), a);
  assert.equal(launcher.calls.launch.length, 1);
  assert.equal(launcher.calls.persistent.length, 0);
});

test("an explicit ADE_BROWSER_SANDBOX=0 is the only way to drop the sandbox", async () => {
  const { launcher, contexts } = setup({ env: { ADE_BROWSER_SANDBOX: "0" } });
  await contexts.contextFor("p");
  assert.equal(launcher.calls.persistent[0].options.chromiumSandbox, false);
});

test("launch failures are replaced by the host diagnosis when there is one", async () => {
  const failure = new Error("No usable sandbox!");
  const diagnosed = Object.assign(new Error("run npm run browser:setup"), {
    code: "browser_sandbox_blocked",
  });
  const seen = [];
  const { contexts } = setup({
    failLaunch: failure,
    diagnose: async (executable, cause) => {
      seen.push([executable, cause]);
      return diagnosed;
    },
  });
  await assert.rejects(contexts.contextFor("p"), { code: "browser_sandbox_blocked" });
  assert.deepEqual(seen, [["/opt/chrome-headless-shell", failure]]);
  const plain = setup({ failLaunch: failure, diagnose: async () => undefined });
  await assert.rejects(plain.contexts.contextFor("p"), failure);
});

test("clearing a profile closes its context and deletes its directory", async () => {
  const { profilesDir, contexts } = setup();
  const context = await contexts.contextFor("project-1");
  await contexts.clearProfile("project-1");
  assert.equal(context.closed, true);
  assert.equal(existsSync(path.join(profilesDir, "project-1")), false);
  await contexts.clearProfile(INCOGNITO_PROFILE_ID);
});

test("closing shuts every context and the shared browser, and refuses new ones", async () => {
  const { launcher, contexts } = setup();
  const persistent = await contexts.contextFor("p");
  const isolated = await contexts.contextFor(INCOGNITO_PROFILE_ID, "p");
  let disconnected = false;
  launcher.calls.browsers[0].on("disconnected", () => (disconnected = true));
  await contexts.close();
  assert.equal(persistent.closed, true);
  assert.equal(isolated.closed, true);
  assert.equal(disconnected, true);
  await assert.rejects(contexts.contextFor("p"), /closed/);
});
