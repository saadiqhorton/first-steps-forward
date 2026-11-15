import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { createBrowserHub } from "./browser-page.mjs";
import { browser as browserRoute } from "./routes/browser.mjs";

const executablePath = process.env.ADE_TEST_CHROMIUM || "/usr/bin/chromium";

test(
  "a page download is offered in its tab, readable by the agent, and cleaned up",
  { skip: !existsSync(executablePath) },
  async (t) => {
    const server = createServer((req, res) => {
      if (req.url === "/file") {
        res.writeHead(200, {
          "content-type": "text/plain",
          "content-disposition": 'attachment; filename="report.txt"',
        });
        return res.end("downloaded feedback");
      }
      res.writeHead(200, { "content-type": "text/html" });
      return res.end('<a href="/file">Download report</a>');
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const hub = createBrowserHub({ contextFor: async () => context });
    t.after(async () => {
      await hub.closeAll();
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    });
    const session = await hub.get("project");
    const tabId = session.tabs().activeId;
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    let off = () => {};
    const offered = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Download was not offered.")), 10000);
      off = session.on("downloads", (items) => {
        if (!items.length) return;
        clearTimeout(timer);
        resolve(items[0]);
      });
    });
    await page.getByText("Download report").click();
    const item = await offered;
    off();
    const readyDeadline = Date.now() + 3000;
    while (session.nav().fileNotShown?.status !== "ready" && Date.now() < readyDeadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(session.nav().fileNotShown?.downloadId, item.id);
    assert.equal(session.nav().url, `http://127.0.0.1:${server.address().port}/file`);
    assert.equal(item.tabId, tabId);
    assert.equal(item.fileName, "report.txt");
    const saved = session.openDownload(item.id);
    assert.equal(await readFile(saved.path, "utf8"), "downloaded feedback");
    const api = createServer((req, res) => {
      const parts = new URL(req.url, "http://localhost").pathname.split("/").filter(Boolean);
      void browserRoute({
        req,
        res,
        parts,
        state: { projects: [{ id: "project" }], sessions: [] },
        browserHub: hub,
        json: (response, code, value) => {
          response.writeHead(code, { "content-type": "application/json" });
          response.end(JSON.stringify(value));
          return true;
        },
      }).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => api.close(resolve)));
    const base = `http://127.0.0.1:${api.address().port}/projects/project/browser/downloads/${item.id}`;
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition"), /attachment.*report\.txt/);
    assert.equal(await response.text(), "downloaded feedback");
    const denied = await fetch(`${base}?session=another-conversation`);
    assert.equal(denied.status, 404);
    const status = await session.runAgentAction({ action: "status" });
    assert.match(status.text, /report\.txt/);
    assert.ok(status.text.includes(saved.path));
    await session.navigate(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(session.nav().fileNotShown, null);
    await assert.rejects(
      session.navigate(`http://127.0.0.1:${server.address().port}/file`),
      /downloaded/i,
    );
    const directDeadline = Date.now() + 3000;
    while (session.nav().fileNotShown?.status !== "ready" && Date.now() < directDeadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(session.nav().fileNotShown?.fileName, "report.txt");
    await hub.closeAll();
    await assert.rejects(access(saved.path), { code: "ENOENT" });
  },
);
