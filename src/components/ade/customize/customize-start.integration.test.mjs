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
  "Customize ADE's composer exposes workflows and file references for its private copy",
  { skip: !existsSync(executablePath) },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ade-customize-start-"));
    const source = path.resolve("src");
    await symlink(path.resolve("node_modules"), path.join(root, "node_modules"));
    const write = (name, text) => writeFile(path.join(root, name), text);
    await write(
      "index.html",
      '<div id="root"></div><script type="module" src="fixture.jsx"></script>',
    );
    await write("store.js", "export const useAdeState = (select) => select({agents:[]});");
    await write(
      "agent.jsx",
      'export const AgentPicker = () => null; export const agentChipLabel = () => ({title:"OpenCode",subtitle:"Free model"});',
    );
    await write(
      "api.js",
      "export const changeInProgress = () => null; export const createChange = async () => ({}); export const useCustomizeAction = () => ({isPending:false,mutateAsync:async () => ({})});",
    );
    await write(
      "router.js",
      "export const Link = ({children}) => children; export const useNavigate = () => () => {};",
    );
    await write("notice.js", "export const warnUser = () => {}; ");
    await write(
      "draft.js",
      `export const saveComposerDraft = async () => {};
       export const MAX_BROWSER_RECORDING_BYTES = 1048576;
       export const isBrowserRecording = () => false;
       export const ensureBrowserFeedbackLoaded = async () => {};
       export const finishBrowserFeedbackTransfer = async () => {};
       export const peekBrowserFeedback = () => [];
       export const subscribeBrowserFeedback = () => () => {};
       export const takeBrowserFeedback = () => [];`,
    );
    await write("dialog.jsx", "export const SignInDialog = () => null;");
    await write("kept.jsx", "export const KeptList = () => null;");
    await write("update.jsx", "export const UpdateNotice = () => null;");
    await write(
      "selection.js",
      `
      export const useAgentSelection = () => ({
        selection: {agentId:"opencode",model:"opencode/mimo-v2.6-flash-free",effort:"",speed:"",permission:"build"},
        setSelection: () => {}, agent: undefined, unusableReason: null,
      });
    `,
    );
    await write(
      "fixture.jsx",
      `
      import React from "react";
      import {createRoot} from "react-dom/client";
      import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
      import {CustomizeStart} from "${path.join(source, "components/ade/customize/CustomizeStart.tsx")}";
      const state = {setup:{status:"ready"},update:null,changes:[],switch:{status:"idle"}};
      createRoot(document.getElementById("root")).render(
        <QueryClientProvider client={new QueryClient()}><CustomizeStart state={state}/></QueryClientProvider>
      );
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
          { find: "@/components/ade/AgentPicker", replacement: path.join(root, "agent.jsx") },
          { find: "@/components/ade/SignInDialog", replacement: path.join(root, "dialog.jsx") },
          { find: "@/lib/ade/browser/composerFeedback", replacement: path.join(root, "draft.js") },
          { find: "@/lib/ade/customizeApi", replacement: path.join(root, "api.js") },
          { find: "@/lib/ade/userNotices", replacement: path.join(root, "notice.js") },
          { find: "@/components/ade/customize/KeptList", replacement: path.join(root, "kept.jsx") },
          { find: "./KeptList", replacement: path.join(root, "kept.jsx") },
          { find: "./UpdateNotice", replacement: path.join(root, "update.jsx") },
          { find: "./useAgentSelection", replacement: path.join(root, "selection.js") },
          { find: "@tanstack/react-router", replacement: path.join(root, "router.js") },
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
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on("pageerror", (error) => console.error("CustomizeStart browser error:", error));
    page.on("console", (message) => {
      if (message.type() === "error")
        console.error("CustomizeStart console error:", message.text());
    });
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByRole("heading", { name: "What should ADE do differently?" }).waitFor();
    await page.getByLabel("Insert workflow or skill").waitFor();
    await page.getByLabel("Reference a project file or folder").waitFor();
    assert.equal(await page.getByLabel("Insert workflow or skill").isVisible(), true);
    assert.equal(await page.getByLabel("Reference a project file or folder").isVisible(), true);
    assert.equal(await page.getByPlaceholder("Describe a change").evaluate((el) => el.rows), 2);
  },
);
