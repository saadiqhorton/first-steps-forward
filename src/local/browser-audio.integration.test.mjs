import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createBrowserHub } from "./browser-page.mjs";
import { AUDIO_EXTENSION_ID } from "./browser-audio.mjs";

const executablePath = process.env.ADE_TEST_CHROMIUM || "/usr/bin/chromium";
const extensionPath = fileURLToPath(new URL("./browser-audio-extension", import.meta.url));

test(
  "full Chromium controls actual per-tab audio without modifying page media",
  { skip: !existsSync(executablePath) },
  async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ade-audio-test-"));
    const context = await chromium.launchPersistentContext(directory, {
      executablePath,
      headless: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        "--no-sandbox",
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    const hub = createBrowserHub({ contextFor: async () => context });
    t.after(async () => {
      await hub.closeAll();
      await rm(directory, { recursive: true, force: true });
    });
    if (!context.serviceWorkers().length)
      await context.waitForEvent("serviceworker", { timeout: 5000 });
    const session = await hub.get("project");
    const first = session.tabs().activeId;
    const page = context.pages()[0];
    await page.setContent('<audio id="audio"></audio>');
    await session.newTab();
    const second = session.tabs().activeId;
    const deadline = Date.now() + 6000;
    while (session.tabs().tabs.some((tab) => !tab.audio) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(
      session.tabs().tabs.map((tab) => tab.audio?.muted),
      [false, false],
    );
    await session.setTabAudio(first, true);
    assert.equal(session.tabs().tabs.find((tab) => tab.id === first).audio.muted, true);
    assert.equal(session.tabs().tabs.find((tab) => tab.id === second).audio.muted, false);
    assert.equal(await page.locator("#audio").evaluate((element) => element.muted), false);
    await session.setTabAudio(first, false);
    assert.equal(session.tabs().tabs.find((tab) => tab.id === first).audio.muted, false);

    // Chromium may stop an idle extension worker even while Playwright retains its handle.
    // Muting must wake it without a navigation.
    const cdp = await context.newCDPSession(page);
    let versionId;
    cdp.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
      for (const version of versions)
        if (version.scriptURL === `chrome-extension://${AUDIO_EXTENSION_ID}/worker.js`)
          versionId = version.versionId;
    });
    await cdp.send("ServiceWorker.enable");
    const versionDeadline = Date.now() + 2000;
    while (!versionId && Date.now() < versionDeadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(versionId);
    await cdp.send("ServiceWorker.stopWorker", { versionId });
    await session.setTabAudio(first, true);
    assert.equal(session.tabs().tabs.find((tab) => tab.id === first).audio.muted, true);
    await cdp.detach();
  },
);
