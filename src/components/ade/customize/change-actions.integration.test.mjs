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
  "preview action starts once, waits while starting, and expands when running",
  { skip: !existsSync(executablePath) },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ade-change-actions-"));
    const source = path.resolve("src");
    await symlink(path.resolve("node_modules"), path.join(root, "node_modules"));
    await writeFile(
      path.join(root, "api.js"),
      `export const AMBER_TEXT = "";
       export const keepChange = () => {};
       export const undoChange = () => {};
       export const rerunChecks = () => {};
       export const runningWithoutChanges = () => false;
       export const updateRowFor = () => undefined;
       export const useCustomizeAction = () => ({ isPending: false, mutate() {} });`,
    );
    await writeFile(
      path.join(root, "store.js"),
      `export const useNow = () => Date.now(); export const timeAgo = () => "just now";`,
    );
    await writeFile(path.join(root, "router.js"), `export const useNavigate = () => () => {};`);
    await writeFile(
      path.join(root, "preview.js"),
      `export const canTry = () => true;
       export const usePreviewAction = () => ({ isPending: false, mutate: (input) => window.starts.push(input) });`,
    );
    await writeFile(path.join(root, "kept.js"), `export const RemoveConfirm = () => null;`);
    await writeFile(
      path.join(root, "switch.js"),
      `export const StockNotice = () => null; export const SwitchCard = () => null;`,
    );
    await writeFile(path.join(root, "update.js"), `export const NeedsYouCard = () => null;`);
    await writeFile(path.join(root, "text.js"), `export const keepBlockedReason = () => null;`);
    await writeFile(
      path.join(root, "index.html"),
      '<div id="root"></div><script type="module" src="/fixture.jsx"></script>',
    );
    await writeFile(
      path.join(root, "fixture.jsx"),
      `import React, {useState} from "react";
       import {createRoot} from "react-dom/client";
       import {ChangeActions} from "${path.join(source, "components/ade/customize/ChangeActions.tsx")}";
       window.starts = []; window.opens = [];
       function App() {
         const [status, setStatus] = useState("stopped");
         const [expanded, setExpanded] = useState(false);
         window.setPreview = setStatus;
         const change = { id: "sample", status: "ready", title: "Sample", preview: { status } };
         return <><ChangeActions change={change} state={{}} onAskAgain={() => {}} onTry={() => { window.opens.push(status); if (status === "running") setExpanded(true); }}/><output data-testid="expanded">{String(expanded)}</output></>;
       }
       createRoot(document.getElementById("root")).render(<App/>);`,
    );
    const server = await createServer({
      configFile: false,
      root,
      cacheDir: path.join(root, ".vite-cache"),
      logLevel: "silent",
      plugins: [react()],
      resolve: {
        alias: [
          { find: "@/lib/ade/customizeApi", replacement: path.join(root, "api.js") },
          { find: "@/lib/ade/store", replacement: path.join(root, "store.js") },
          { find: "@tanstack/react-router", replacement: path.join(root, "router.js") },
          { find: "./PreviewPanel", replacement: path.join(root, "preview.js") },
          { find: "./KeptList", replacement: path.join(root, "kept.js") },
          { find: "./SwitchCard", replacement: path.join(root, "switch.js") },
          { find: "./UpdateNotice", replacement: path.join(root, "update.js") },
          { find: "./customizeText", replacement: path.join(root, "text.js") },
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
    await page.goto(server.resolvedUrls.local[0], { timeout: 30_000 });
    await page.getByRole("button", { name: "Try it" }).click();
    assert.deepEqual(await page.evaluate(() => window.starts), [{ id: "sample", action: "start" }]);
    assert.deepEqual(await page.evaluate(() => window.opens), ["stopped"]);

    await page.evaluate(() => window.setPreview("starting"));
    const starting = page.getByRole("button", { name: "Starting…" });
    await starting.waitFor();
    assert.equal(await starting.isDisabled(), true);
    await starting.click({ force: true });
    assert.deepEqual(await page.evaluate(() => window.opens), ["stopped"]);

    await page.evaluate(() => window.setPreview("running"));
    const expand = page.getByRole("button", { name: "Expand preview" });
    await expand.waitFor();
    assert.equal(await expand.getAttribute("aria-pressed"), null);
    await expand.click();
    assert.equal(await page.getByTestId("expanded").textContent(), "true");
    assert.deepEqual(await page.evaluate(() => window.opens), ["stopped", "running"]);
    assert.deepEqual(await page.evaluate(() => window.starts), [{ id: "sample", action: "start" }]);
  },
);
