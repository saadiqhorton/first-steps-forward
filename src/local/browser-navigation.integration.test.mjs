import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { createBrowserHub } from "./browser-page.mjs";

const executablePath = process.env.ADE_TEST_CHROMIUM || "/usr/bin/chromium";
const listen = (server, port = 0) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
const close = (server) =>
  new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

test(
  "failed navigation is kept per tab and reload retries the failed address",
  { skip: !existsSync(executablePath) },
  async (t) => {
    const probe = createServer();
    const port = await listen(probe);
    await close(probe);
    const url = `http://127.0.0.1:${port}/`;
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext();
    await context.newPage();
    const hub = createBrowserHub({ contextFor: async () => context });
    let server;
    t.after(async () => {
      await hub.closeAll();
      await browser.close();
      if (server?.listening) await close(server);
    });
    const session = await hub.get("project");
    await assert.rejects(session.navigate(url), /ERR_CONNECTION_REFUSED/);
    assert.equal(session.nav().url, url);
    assert.deepEqual(session.nav().error, { url, description: "net::ERR_CONNECTION_REFUSED" });
    const failedTab = session.tabs().activeId;
    await session.newTab();
    assert.equal(session.nav().error, null);
    await session.selectTab(failedTab);
    assert.equal(session.nav().error?.url, url);
    server = createServer((_req, res) => {
      res.end("recovered");
    });
    await listen(server, port);
    await session.reload();
    assert.equal(session.nav().error, null);
    assert.equal(session.nav().url, url);
    await close(server);
    await assert.rejects(session.navigate(url), /ERR_CONNECTION_REFUSED/);
    server = createServer((_req, res) => res.end("agent recovered"));
    await listen(server, port);
    await session.runAgentAction({ action: "reload" });
    assert.equal(session.nav().error, null);
    assert.equal(session.nav().url, url);
  },
);

test(
  "a touch probe reports whether the element under a point accepts text",
  { skip: !existsSync(executablePath) },
  async (t) => {
    const server = createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(`<!doctype html><meta charset=utf-8><style>
        body { margin: 0; font: 16px sans-serif }
        #field { position: absolute; left: 20px; top: 20px; width: 200px; height: 40px }
        #box { position: absolute; left: 20px; top: 100px; width: 200px; height: 40px; background: #ddd }
        #note { position: absolute; left: 20px; top: 180px; width: 200px; height: 60px }
        #check { position: absolute; left: 20px; top: 280px }
        #host { position: absolute; left: 20px; top: 320px; width: 200px; height: 40px }
      </style>
      <input id=field><div id=box>box</div><textarea id=note></textarea>
      <input id=check type=checkbox><div id=host></div>
      <script>
        host.attachShadow({ mode: "open" }).innerHTML =
          '<input id=inner style="width:200px;height:40px">';
      </script>`);
    });
    const url = `http://127.0.0.1:${await listen(server)}/`;
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext();
    await context.newPage();
    const hub = createBrowserHub({ contextFor: async () => context });
    t.after(async () => {
      await hub.closeAll();
      await browser.close();
      await close(server);
    });
    const session = await hub.get("project");
    await session.navigate(url);
    // waitUntil: "commit" resolves before the DOM is parsed; wait for the page itself.
    await session.runAgentAction({ action: "wait_for", text: "box" });
    // The first page on a tab is flagged so a hidden preview can surface it.
    assert.equal(session.nav().opened, true);
    const probe = async (x, y) => {
      const result = await session.input({ type: "probe", x, y });
      assert.deepEqual(result.probe, { x, y, editable: result.probe.editable });
      return result.probe;
    };
    assert.equal((await probe(100, 40)).editable, true, "text input");
    assert.equal((await probe(100, 115)).editable, false, "plain element");
    assert.equal((await probe(100, 200)).editable, true, "textarea");
    assert.equal((await probe(30, 300)).editable, false, "checkbox");
    assert.equal((await probe(100, 335)).editable, true, "input inside an open shadow root");
    // "Fill pane" mode fits the page to the viewer's pane, with the tab's other settings kept.
    await session.resize(700, 480);
    assert.deepEqual(session.viewport(), { width: 700, height: 480 });
    assert.deepEqual(session.browserSettings(), {
      viewport: { width: 700, height: 480 },
      zoomFactor: 1,
      colorScheme: "system",
    });
    // A later page replaces a real one, so it does not ask to be surfaced.
    await session.navigate(url);
    assert.equal(session.nav().opened, false);
  },
);
