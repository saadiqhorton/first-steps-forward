import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { createBrowserHub } from "./browser-page.mjs";

const executablePath = process.env.ADE_TEST_CHROMIUM || "/usr/bin/chromium";

test(
  "a tab captures a favicon without forwarding its cookies across origins",
  { skip: !existsSync(executablePath) },
  async (t) => {
    let image;
    let crossOriginCookie;
    const icons = createServer((req, res) => {
      if (req.headers["user-agent"]?.includes("node")) crossOriginCookie = req.headers.cookie ?? "";
      res.writeHead(200, { "content-type": "image/png" });
      res.end(image);
    });
    await new Promise((resolve) => icons.listen(0, "127.0.0.1", resolve));
    const site = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<link rel="icon" href="http://127.0.0.1:${icons.address().port}/icon.png"><title>Favicon</title>`,
      );
    });
    await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const context = canvas.getContext("2d");
      context.fillStyle = "red";
      context.fillRect(0, 0, 16, 16);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    image = Buffer.from(png, "base64");
    await context.addCookies([
      { name: "private", value: "not-for-icons", url: `http://127.0.0.1:${site.address().port}/` },
    ]);
    const hub = createBrowserHub({ contextFor: async () => context });
    t.after(async () => {
      await hub.closeAll();
      await browser.close();
      await Promise.all([
        new Promise((resolve) => site.close(resolve)),
        new Promise((resolve) => icons.close(resolve)),
      ]);
    });
    const session = await hub.get("project");
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No favicon was captured.")), 10000);
      const off = session.on("tabs", ({ tabs }) => {
        const icon = tabs.find((tab) => tab.favicon)?.favicon;
        if (!icon) return;
        clearTimeout(timer);
        off();
        resolve(icon);
      });
    });
    await page.goto(`http://127.0.0.1:${site.address().port}/`);
    const favicon = await result;
    assert.match(favicon, /^data:image\/png;base64,/);
    assert.equal(crossOriginCookie, "");
  },
);
