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
  "picker keeps agent defaults, supports manual models, and closes after selection",
  { skip: !existsSync(executablePath) },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ade-picker-ui-"));
    const source = path.resolve("src");
    await symlink(path.resolve("node_modules"), path.join(root, "node_modules"));
    await writeFile(
      path.join(root, "index.html"),
      '<div id="root"></div><script type="module" src="/fixture.jsx"></script>',
    );
    await writeFile(
      path.join(root, "store.js"),
      `
    export const useAdeState = (select) => select({agents:[{id:'codex',name:'Codex',short:'Codex',installed:true,signedIn:true,installMethod:'mise',version:window.testVersion || '1.0.0',updateAvailable:true,latestVersion:'1.1.0',authMethod:'Account',authNote:'Signed in',harness:{install:'npm install',update:'mise upgrade'}},{id:'claude',name:'Claude Code',short:'Claude',installed:true,signedIn:true,installMethod:'other',version:'1.0.0'}]});
    export const useAde = () => ({setDefaultAgent:()=>{}});
    export const useActiveProject = () => ({id:'p1',name:'Project',defaultAgent:'codex'});
    export const agentModels = async()=>{ window.modelReads=(window.modelReads||0)+1; if(window.delayPreset) await new Promise(r=>setTimeout(r,800)); return {available:true,models:[{id:'model-one',label:'Model One'}]}; }; 
    export const optionCapabilities = async(agent)=>{ window.capReads=(window.capReads||0)+1; return {efforts:['low','high'],speeds:['fast'],permissions:agent === 'claude' ? ['manual','build','plan','auto'] : ['build','plan'],permissionLabels:agent === 'claude' ? {manual:'Manual',build:'Accept edits',plan:'Plan',auto:'Auto'} : {build:'Workspace write',plan:'Read-only'},permissionNotes:{build:'Build',plan:'Plan',manual:'Manual',auto:'Auto'}}; }; 
  `,
    );
    await writeFile(
      path.join(root, "dialogs.jsx"),
      `import React from 'react'; export const HarnessDialog = ({agentId,kind,onClose}) => <div role="dialog"><span>{kind} {agentId}</span><button onClick={onClose}>Close mock</button></div>; export const SignInDialog = () => null;`,
    );
    await writeFile(
      path.join(root, "fixture.jsx"),
      `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {AgentPicker} from '@/components/ade/AgentPicker';
    function App() {
      const [version,setVersion] = useState(0); window.testVersion = version ? '1.1.0' : '1.0.0';
      const [selection,setSelection] = useState({agentId:'codex',model:'model-one',effort:'',speed:'',permission:'build'});
      return <><button onClick={()=>setVersion(1)}>Change CLI version</button><AgentPicker value={selection} onChange={setSelection} onClose={()=>window.closedPicker = true}/><output>{JSON.stringify(selection)}</output></>;
    }
    createRoot(document.getElementById('root')).render(<App />);
  `,
    );
    await writeFile(
      path.join(root, "agents.html"),
      '<div id="root"></div><script type="module" src="/agents.jsx"></script>',
    );
    await writeFile(
      path.join(root, "agents.jsx"),
      `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {AgentsPanel} from '@/components/ade/AgentsPanel';
      createRoot(document.getElementById('root')).render(<AgentsPanel />);
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
          { find: "@/components/ade/HarnessDialog", replacement: path.join(root, "dialogs.jsx") },
          { find: "@/components/ade/SignInDialog", replacement: path.join(root, "dialogs.jsx") },
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
    await page.route("**/api/agents/check-updates", (route) =>
      route.fulfill({ json: { failed: [] } }),
    );
    await page.goto(server.resolvedUrls.local[0]);
    assert.equal(
      await page.getByRole("button", { name: "Model One" }).getAttribute("aria-pressed"),
      "true",
    );
    await page.getByRole("button", { name: "Update to 1.1.0" }).click();
    await page.keyboard.press("Escape");
    assert.notEqual(await page.evaluate(() => window.closedPicker), true);
    await page.getByRole("button", { name: "Close mock" }).click();
    await page.getByRole("button", { name: "Default (recommended)" }).click();
    assert.equal(JSON.parse(await page.locator("output").textContent()).model, "");
    await page.getByRole("button", { name: "Other model id…" }).click();
    await page.getByLabel("Custom model ID").fill("provider/custom");
    assert.equal(JSON.parse(await page.locator("output").textContent()).model, "provider/custom");
    await page.getByLabel("Custom model ID").fill("");
    assert.equal(JSON.parse(await page.locator("output").textContent()).model, "");
    await page.getByRole("button", { name: "Model One" }).click();
    await page.getByRole("button", { name: "Save as preset" }).click();
    await page.getByLabel("Preset name").fill("Everyday");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Default (recommended)" }).click();
    assert.equal(JSON.parse(await page.locator("output").textContent()).model, "");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.waitForFunction(
      () => JSON.parse(document.querySelector("output").textContent).model === "model-one",
    );
    await page.getByRole("button", { name: "Default (recommended)" }).click();
    await page.evaluate(() => {
      window.delayPreset = true;
    });
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.getByRole("button", { name: "High", exact: true }).click();
    await page.waitForTimeout(1000);
    assert.equal(JSON.parse(await page.locator("output").textContent()).model, "");
    assert.equal(JSON.parse(await page.locator("output").textContent()).effort, "high");
    await page.evaluate(() => {
      window.delayPreset = false;
    });
    const before = await page.evaluate(() => ({
      models: window.modelReads,
      caps: window.capReads,
    }));
    await page.getByRole("button", { name: "Change CLI version" }).click();
    await page.waitForFunction(
      ({ models, caps }) => window.modelReads > models && window.capReads > caps,
      before,
    );
    assert.equal(
      await page.getByRole("button", { name: "High", exact: true }).getAttribute("aria-pressed"),
      "true",
    );
    await page.evaluate(() => {
      const presets = JSON.parse(localStorage.getItem("ade-agent-presets"));
      presets[0].selection.effort = "obsolete";
      localStorage.setItem("ade-agent-presets", JSON.stringify(presets));
    });
    await page.reload();
    await page.getByLabel("Saved presets").selectOption({ label: "Everyday" });
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    assert.match(await page.getByRole("alert").textContent(), /no longer offers/);
    assert.equal(JSON.parse(await page.locator("output").textContent()).effort, "");
    await page.getByRole("button", { name: "Delete selected preset" }).click();
    assert.equal(await page.getByLabel("Saved presets").count(), 0);
    await page.getByRole("button", { name: /Claude Code/ }).click();
    await page.getByRole("button", { name: "Manual", exact: true }).click();
    assert.equal(JSON.parse(await page.locator("output").textContent()).permission, "manual");
    await page.getByRole("button", { name: "Auto", exact: true }).click();
    await page.getByRole("button", { name: "Save as preset" }).click();
    await page.getByLabel("Preset name").fill("Claude auto");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.reload();
    await page.getByLabel("Saved presets").selectOption({ label: "Claude auto" });
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await page.waitForFunction(
      () => JSON.parse(document.querySelector("output").textContent).permission === "auto",
    );
    assert.equal(
      await page.getByRole("button", { name: "Auto", exact: true }).getAttribute("aria-pressed"),
      "true",
    );
    await page.getByRole("button", { name: /Codex/ }).click();
    await page.getByRole("button", { name: "Workspace write", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Auto", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Check for updates" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Check for updates" }).waitFor();
    await page.getByLabel("Close after selection").check();
    await page.getByRole("button", { name: "Model One" }).click();
    assert.equal(JSON.parse(await page.locator("output").textContent()).model, "model-one");
    assert.equal(await page.evaluate(() => window.closedPicker), true);
    await page.goto(new URL("agents.html", server.resolvedUrls.local[0]).href);
    await page.getByRole("button", { name: "Check for updates" }).click();
    await page.getByRole("button", { name: "Update to 1.1.0" }).click();
    assert.equal(await page.getByRole("dialog").getByText("update codex").count(), 1);
  },
);
