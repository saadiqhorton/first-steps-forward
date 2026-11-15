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
  "composer inserts workflow, skill and project references",
  { skip: !existsSync(executablePath) },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ade-composer-ui-"));
    const source = path.resolve("src");
    await symlink(path.resolve("node_modules"), path.join(root, "node_modules"));
    await writeFile(
      path.join(root, "store.js"),
      "export const useAdeState = (select) => select({agents:[]});",
    );
    await writeFile(
      path.join(root, "agent.jsx"),
      'export const AgentPicker = () => null; export const agentChipLabel = () => ({title:"Agent",subtitle:"Model"});',
    );
    await writeFile(
      path.join(root, "index.html"),
      '<div id="root"></div><script type="module" src="/fixture.jsx"></script>',
    );
    await writeFile(
      path.join(root, "fixture.jsx"),
      `
    import React, {useState} from "react";
    import {createRoot} from "react-dom/client";
    import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
    import {Composer} from "@/components/ade/Composer";
    import {SessionMessage} from "@/components/ade/SessionMessage";
    import {loadFeedbackDraft} from "@/lib/ade/browser/feedbackPersistence";
    window.sent = []; window.rejectSend = false;
    window.readDraft = () => loadFeedbackDraft("composer:followup");
    function App() {
      const [workflow, setWorkflow] = useState(null);
      const [message, setMessage] = useState(null);
      const followup = location.search.includes("followup");
      return <><Composer projectId="p1" draftStorageKey={followup ? "followup" : undefined} mode={followup ? "follow-up" : "new"} selection={{agentId:"codex",model:"",effort:"",speed:"",permission:"build"}} onSelectionChange={()=>{}} branch="main" placeholder="Message" sending={false} workflow={workflow} onWorkflowSelect={followup ? undefined : setWorkflow} onWorkflowRemove={()=>setWorkflow(null)} onSend={async (text,files,delivery,presentation)=>{if(window.rejectSend)return false;window.sent.push({text,presentation});setMessage({role:"user",text,presentation,id:"1",at:1}); return true;}} />{message && <div data-testid="sent-message"><SessionMessage message={message}/></div>}</>;
    }
    createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);
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
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/workflows")
        return route.fulfill({
          json: {
            workflows: [
              {
                id: "w1",
                name: "Review code",
                description: "Review",
                prompt: "Inspect carefully.",
              },
            ],
          },
        });
      if (url.pathname === "/api/skills/p1")
        return route.fulfill({
          json: {
            skills: [
              {
                id: "s1",
                name: "test-skill",
                description: "Test",
                location: ".ade/skills/test-skill",
                path: "/project/.ade/skills/test-skill",
              },
            ],
          },
        });
      if (url.pathname.endsWith("/search"))
        return route.fulfill({
          json: { entries: [{ name: "my folder", path: "src/my folder", kind: "folder" }] },
        });
      if (url.pathname.endsWith("/entries"))
        return route.fulfill({ json: { entries: [{ name: "src", path: "src", kind: "folder" }] } });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto(server.resolvedUrls.local[0]);
    const input = page.locator("textarea");
    await input.fill("/review");
    await page.getByRole("option", { name: /Review code/ }).waitFor();
    await input.press("Enter");
    assert.equal(await page.getByLabel("Remove Review code workflow").count(), 1);
    await input.fill("Use /test-skill");
    await page.getByRole("option", { name: /test-skill/ }).waitFor();
    await input.press("Enter");
    assert.equal(await page.getByLabel("Remove test-skill skill").count(), 1);
    assert.equal((await input.inputValue()).trim(), "Use");
    await input.fill("Look at @folder");
    await page.getByRole("option", { name: /src\/my folder/ }).click();
    assert.equal((await input.inputValue()).trim(), "Look at");
    assert.equal(await page.getByLabel("Remove my folder folder").count(), 1);
    await page.getByLabel("Remove my folder folder").click();
    assert.equal(await page.getByLabel("Remove my folder folder").count(), 0);
    await input.fill("Look at @folder");
    await page.getByRole("option", { name: /src\/my folder/ }).click();
    await page.evaluate(() => {
      window.rejectSend = true;
    });
    await page.getByLabel("Send", { exact: true }).click();
    assert.equal(await page.getByLabel("Remove test-skill skill").count(), 1);
    assert.equal(await page.getByLabel("Remove my folder folder").count(), 1);
    await page.evaluate(() => {
      window.rejectSend = false;
    });
    await page.getByLabel("Send", { exact: true }).click();
    const sent = await page.evaluate(() => window.sent[0]);
    assert.match(sent.text, /Inspect carefully\./);
    assert.match(sent.text, /test-skill\/SKILL.md/);
    assert.match(sent.text, /src\/my folder/);
    assert.equal(sent.presentation.text, "Look at");
    assert.deepEqual(
      sent.presentation.references.map((item) => item.kind),
      ["workflow", "skill", "folder"],
    );
    assert.match(await page.getByTestId("sent-message").innerText(), /Review code/);
    assert.doesNotMatch(
      await page.getByTestId("sent-message").innerText(),
      /read and follow|src\/my folder/,
    );
    await page.goto(`${server.resolvedUrls.local[0]}?followup=1`);
    await page.getByLabel("Insert workflow or skill").click();
    await page.getByRole("option", { name: /Review code/ }).waitFor();
    await input.press("Escape");
    await input.fill("");
    await page.getByLabel("Reference a project file or folder").click();
    await page.getByRole("option", { name: /src/ }).waitFor();
    await input.press("Escape");
    const chooser = page.waitForEvent("filechooser");
    await page.getByLabel("Attach files").click();
    await (await chooser).setFiles([]);
    await input.fill("/review");
    await page.getByRole("option", { name: /Review code/ }).waitFor();
    await input.press("Enter");
    assert.equal(await page.getByLabel("Remove Review code workflow").count(), 1);
    await page.waitForFunction(async () => (await window.readDraft())?.contextItems?.length === 1);
    await page.reload();
    await page.getByLabel("Remove Review code workflow").waitFor();
    assert.equal((await input.inputValue()).trim(), "");
    await page.getByLabel("Send", { exact: true }).click();
    assert.equal((await page.evaluate(() => window.sent[0])).text, "Inspect carefully.");
  },
);
