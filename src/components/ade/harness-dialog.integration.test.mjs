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
  "update dialog ignores stale status and recovers progress without events",
  { skip: !existsSync(executablePath) },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ade-harness-ui-"));
    const source = path.resolve("src");
    await symlink(path.resolve("node_modules"), path.join(root, "node_modules"));
    await writeFile(
      path.join(root, "index.html"),
      '<div id="root"></div><script type="module" src="/fixture.jsx"></script>',
    );
    await writeFile(
      path.join(root, "store.js"),
      `
    let reads = 0;
    const running = {agentId:'codex', kind:'update', status:'running', command:'npm install', output:['Downloading', 'Installing']};
    const done = {...running, status:'succeeded', exitCode:0};
    export const harnessJob = () => ++reads === 1
      ? location.search ? Promise.resolve(running) : new Promise(resolve => setTimeout(() => resolve({status:'idle', output:[]}), 900))
      : Promise.resolve(done);
    export const useAdeState = (select) => select({agents:[{id:'codex', name:'Codex'}]});
    export const useAde = () => ({harnessCommand:()=>'npm install', startHarness: async()=>running, refresh:async()=>{}});
  `,
    );
    await writeFile(
      path.join(root, "fixture.jsx"),
      `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
    import {HarnessDialog} from '@/components/ade/HarnessDialog';
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><HarnessDialog agentId="codex" kind="update" onClose={()=>{}} /></QueryClientProvider>);
  `,
    );
    const server = await createServer({
      configFile: false,
      root,
      cacheDir: path.join(root, ".vite-cache"),
      logLevel: "silent",
      plugins: [react()],
      resolve: {
        alias: [
          { find: "@/lib/ade/store", replacement: path.join(root, "store.js") },
          { find: "@", replacement: source },
        ],
        dedupe: ["react", "react-dom"],
      },
      server: {
        host: "127.0.0.1",
        port: 0,
        fs: { allow: [source, root, path.resolve("node_modules")] },
      },
    });
    await server.listen();
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox"],
    });
    t.after(async () => {
      await browser.close();
      await server.close();
      await rm(root, { recursive: true, force: true });
    });
    const page = await browser.newPage();
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByRole("button", { name: "Run" }).click();
    await page.getByText("Status: running").waitFor();
    await page.getByText("Status: succeeded · exit 0").waitFor({ timeout: 6000 });
    assert.equal(await page.locator("pre").last().textContent(), "Downloading\nInstalling");
    assert.equal(await page.getByRole("button", { name: "Close" }).isEnabled(), true);
    await page.goto(`${server.resolvedUrls.local[0]}?resume`);
    await page.getByText("Status: running").waitFor();
    await page.getByText("Status: succeeded · exit 0").waitFor({ timeout: 6000 });
    assert.equal(await page.locator("pre").last().textContent(), "Downloading\nInstalling");
    assert.equal(await page.getByRole("button", { name: "Close" }).isEnabled(), true);
  },
);
