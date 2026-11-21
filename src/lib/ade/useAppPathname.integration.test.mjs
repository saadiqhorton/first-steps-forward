import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const executablePath = process.env.ADE_TEST_CHROMIUM || "/usr/bin/chromium";

test(
  "pathname reconciles the prerendered shell on a direct visit and navigation",
  { skip: !existsSync(executablePath) },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ade-path-ui-"));
    await symlink(path.resolve("node_modules"), path.join(root, "node_modules"));
    await writeFile(
      path.join(root, "router.js"),
      `export const useRouterState = ({select}) => select({resolvedLocation:{pathname:location.pathname}, location:{pathname:location.pathname}, matches:[]});`,
    );
    await writeFile(
      path.join(root, "index.html"),
      '<div id="root"><a href="/workspace/customize" class="inactive">Customize ADE</a></div><script type="module" src="/fixture.jsx"></script>',
    );
    await writeFile(
      path.join(root, "fixture.jsx"),
      `import React from "react"; import {hydrateRoot} from "react-dom/client"; import {useAppPathname} from "${path.resolve("src/lib/ade/useAppPathname.ts")}"; function App(){const p=useAppPathname();return <a suppressHydrationWarning href="/workspace/customize" className={p.startsWith("/workspace/customize") ? "active" : "inactive"}>Customize ADE</a>} hydrateRoot(document.getElementById("root"),<App/>);`,
    );
    const server = await createServer({
      configFile: false,
      root,
      cacheDir: path.join(root, ".cache"),
      logLevel: "silent",
      plugins: [react()],
      resolve: {
        alias: [{ find: "@tanstack/react-router", replacement: path.join(root, "router.js") }],
        dedupe: ["react", "react-dom"],
      },
      server: {
        host: "127.0.0.1",
        port: 0,
        fs: { allow: [root, path.resolve("src"), path.resolve("node_modules")] },
      },
    });
    await server.listen();
    t.after(async () => {
      await server.close();
      await rm(root, { recursive: true, force: true });
    });
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox"],
    });
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/workspace/customize/123`);
    await page.waitForSelector("a.active");
    await page.evaluate(() => {
      history.pushState({}, "", "/workspace/inbox");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await page.waitForSelector("a.inactive");
    assert.equal(await page.locator("a").getAttribute("class"), "inactive");
  },
);
