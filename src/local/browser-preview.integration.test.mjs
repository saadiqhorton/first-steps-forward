import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { createBrowserHub } from "./browser-page.mjs";

const executablePath = process.env.ADE_TEST_CHROMIUM || "/usr/bin/chromium";

test(
  "preview inspects elements and applies browser settings to the actual page",
  { skip: !existsSync(executablePath) },
  async (t) => {
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    const hub = createBrowserHub({ contextFor: async () => context });
    t.after(async () => {
      await hub.closeAll();
      await browser.close();
    });
    const session = await hub.get("project");
    await page.setContent(
      '<title>Preview</title><button id="target" style="position:absolute;left:20px;top:30px;width:180px;height:60px;color:rgb(1, 2, 3)">Save <input value="secret"></button>',
    );
    await page.evaluate(() => {
      document.querySelector("#target").__reactFiber$fixture = {
        type: function SaveButton() {},
        _debugSource: { fileName: "src/SaveButton.tsx", lineNumber: 12, columnNumber: 4 },
      };
    });
    const selected = await session.inspectElement(30, 40);
    assert.equal(selected.selector, "#target");
    assert.equal(selected.pageTitle, "Preview");
    assert.deepEqual(selected.rect, { x: 20, y: 30, width: 180, height: 60 });
    assert.match(selected.styles, /color: rgb\(1, 2, 3\)/);
    assert.doesNotMatch(selected.htmlPreview, /secret/);
    assert.equal(selected.componentName, "SaveButton");
    assert.deepEqual(selected.source, {
      fileName: "src/SaveButton.tsx",
      lineNumber: 12,
      columnNumber: 4,
    });
    const change = await session.setAnnotationStyle("annotation-1", "#target", "color", "#ff0000");
    assert.equal(change.previousValue, "rgb(1, 2, 3)");
    assert.equal(
      await page.locator("#target").evaluate((element) => getComputedStyle(element).color),
      "rgb(255, 0, 0)",
    );
    await session.restoreAnnotationStyles("annotation-1");
    assert.equal(
      await page.locator("#target").evaluate((element) => getComputedStyle(element).color),
      "rgb(1, 2, 3)",
    );
    const screenshot = await session.captureScreenshot();
    assert.equal(screenshot.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    await page.setContent('<button id="one" style="position:absolute;left:20px;top:20px;width:80px;height:40px">One</button><button id="two" style="position:absolute;left:140px;top:20px;width:80px;height:40px">Two</button>');
    const region = await session.inspectRegion({ x: 0, y: 0, width: 250, height: 100 });
    assert.deepEqual(region.map((element) => element.selector).sort(), ["#one", "#two"]);

    await session.adjustBrowser({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
    assert.deepEqual(
      await page.evaluate(() => [
        innerWidth,
        innerHeight,
        matchMedia("(prefers-color-scheme: dark)").matches,
      ]),
      [390, 844, true],
    );
    await session.adjustBrowser({ zoomFactor: 2 });
    assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight]), [195, 422]);
    assert.deepEqual(session.viewport(), { width: 195, height: 422 });
    await session.adjustBrowser({ zoomFactor: 1, colorScheme: "light" });
    assert.deepEqual(
      await page.evaluate(() => [
        innerWidth,
        innerHeight,
        matchMedia("(prefers-color-scheme: light)").matches,
      ]),
      [390, 844, true],
    );
    assert.deepEqual(session.viewport(), { width: 390, height: 844 });
    const first = session.tabs().activeId;
    await session.newTab();
    const second = session.tabs().activeId;
    assert.notEqual(second, first);
    assert.equal(session.tabs().tabs.length, 2);
    assert.deepEqual(session.browserSettings(second), { viewport: { width: 1280, height: 800 }, zoomFactor: 1, colorScheme: "system" });
    await session.adjustBrowser({ tabId: second, viewport: { width: 768, height: 1024 }, colorScheme: "dark" });
    assert.equal(session.browserSettings(first).colorScheme, "light");
    assert.deepEqual(session.browserSettings(first).viewport, { width: 390, height: 844 });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(
      session.tabs().activeId,
      second,
      "an intentionally opened blank tab stays selected",
    );
    await session.selectTab(first);
    assert.equal(session.tabs().activeId, first);
    await page.setContent('<body style="margin:0;background:rgb(255,0,0)"></body>');
    const frames = [];
    const stopPinned = await session.startScreencast(
      { tabId: first, maxWidth: 390, maxHeight: 844 },
      (jpeg, ack) => {
        frames.push(jpeg.toString("base64"));
        ack();
      },
    );
    await session.selectTab(second);
    await page.evaluate(() => {
      document.body.style.background = "rgb(0,255,0)";
    });
    let green = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !green) {
      const frame = frames.pop();
      if (frame)
        green = await page.evaluate(async (base64) => {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const image = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0);
          image.close();
          const p = ctx.getImageData(10, 10, 1, 1).data;
          return p[1] > 180 && p[0] < 80;
        }, frame);
      if (!green) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await stopPinned();
    assert.equal(
      green,
      true,
      "a pinned stream continues capturing its original tab after switching",
    );
    const pinnedShot = await session.captureScreenshot(first);
    const shotGreen = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0); image.close();
      const pixel = context.getImageData(10, 10, 1, 1).data;
      return pixel[1] > 180 && pixel[0] < 80;
    }, pinnedShot.toString("base64"));
    assert.equal(shotGreen, true, "capture uses the requested tab even when another is active");
    await session.closeTab(second);
    assert.deepEqual(
      session.tabs().tabs.map((tab) => tab.id),
      [first],
    );
  },
);
