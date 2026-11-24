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

/**
 * Luna's activity is the Shell's right pane, in the same shape as a project conversation's
 * Activity panel. This checks the parts a user reads: the agent context rows, the readable
 * activity rows (an ADE notice, an error and a permission ask must never surface as raw
 * JSON), no project Checks section, and a clean empty state.
 */
test(
  "Luna activity panel shows agent context and readable activity rows",
  { skip: !existsSync(executablePath) },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ade-luna-activity-ui-"));
    const source = path.resolve("src");
    await symlink(path.resolve("node_modules"), path.join(root, "node_modules"));
    await writeFile(
      path.join(root, "index.html"),
      '<div id="root"></div><script type="module" src="/fixture.jsx"></script>',
    );
    await writeFile(
      path.join(root, "fixture.jsx"),
      `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {AssistantActivityPanel} from '@/components/ade/AssistantActivityPanel';
    import {threadTrace} from '@/components/ade/workspaceChatTrace.mjs';
    const at = 1;
    const activity = [
      { id: 'n1', type: 'notice', text: 'Connectors could not be read, so this turn runs without them.', at },
      { id: 'l1', type: 'log', text: '{"type":"tool_execution_start","toolCallId":"c1","toolName":"mcp__parallel__web_search","args":{"query":"insforge"}}', at },
      { id: 'l2', type: 'log', text: '{"type":"tool_execution_end","toolCallId":"c1","toolName":"mcp__parallel__web_search","result":{"content":[{"type":"text","text":"InsForge is an open-source backend."}]},"isError":false}', at },
      { id: 'e1', type: 'error', text: 'The Parallel connector closed before the search finished.', at },
    ];
    const thread = { workspacePath: '/home/me/.ade/luna/abc' };
    const panel = (empty) => (
      <AssistantActivityPanel
        agentId="pi"
        agentName="Pi Agent"
        model="ollama-cloud/glm-5.3"
        mode="chat"
        workspacePath={thread.workspacePath}
        status="Ready"
        trace={threadTrace(empty ? [] : activity)}
        live={false}
      />
    );
    window.showEmpty = () => createRoot(document.getElementById('root')).render(panel(true));
    createRoot(document.getElementById('root')).render(panel(false));
  `,
    );
    const server = await createServer({
      configFile: false,
      root,
      cacheDir: path.join(root, ".vite-cache"),
      logLevel: "silent",
      plugins: [react()],
      resolve: {
        alias: [{ find: "@", replacement: source }],
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
    const aside = page.locator('aside[aria-label="Activity"]');
    await aside.waitFor();

    assert.deepEqual(await aside.locator("h2").allInnerTexts(), ["Agent context", "Logs"]);
    const context = await aside.locator("dl").innerText();
    assert.match(context, /Agent\s+Pi Agent/);
    assert.match(context, /Model\s+ollama-cloud\/glm-5\.3/);
    assert.match(context, /Mode\s+Chat/);
    assert.match(context, /Workspace\s+\/home\/me\/\.ade\/luna\/abc/);
    assert.match(context, /Status\s+Ready/);
    assert.equal(await aside.getByText("Checks", { exact: true }).count(), 0);

    // The failed turn stays open, so every row is readable text — never a raw log line.
    const logs = await aside.innerText();
    assert.match(logs, /Looked up\s*insforge/);
    assert.match(logs, /Connectors could not be read, so this turn runs without them\./);
    assert.match(logs, /The Parallel connector closed before the search finished\./);
    assert.equal(logs.includes('{"type"'), false);

    await page.evaluate(() => window.showEmpty());
    await aside.getByText("No agent activity yet.").waitFor();
    assert.deepEqual(await aside.locator("h2").allInnerTexts(), ["Agent context", "Logs"]);
  },
);
