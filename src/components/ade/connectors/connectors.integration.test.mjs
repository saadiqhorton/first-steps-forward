import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const executablePath = process.env.ADE_TEST_CHROMIUM || "/usr/bin/chromium";
// Set to a folder to also save light/dark, desktop/phone screenshots of the page and dialogs.
const screenshotDir = process.env.ADE_CONNECTORS_SCREENSHOT_DIR;
const SECRET = "exa-live-key-7f3c9a";

const PRESETS = [
  {
    id: "parallel",
    label: "Parallel",
    description: "Web search, page fetch and deep research from Parallel.",
    url: "https://mcp.parallel.ai/mcp",
    keyHeader: "Authorization",
    keyOptional: true,
    keyUrl: "https://platform.parallel.ai",
  },
  {
    id: "exa",
    label: "Exa",
    description: "Exa web search and page fetch.",
    url: "https://mcp.exa.ai/mcp",
    keyHeader: "x-api-key",
    keyOptional: true,
    keyUrl: "https://dashboard.exa.ai/api-keys",
  },
  {
    id: "firecrawl",
    label: "Firecrawl",
    description: "Scrape, search, map and crawl the web with Firecrawl.",
    url: "https://mcp.firecrawl.dev/v2/mcp",
    keyHeader: "Authorization",
    keyOptional: true,
    keyUrl: "https://www.firecrawl.dev/app/api-keys",
  },
];

const base = { enabled: true, createdAt: 1, updatedAt: 1 };
/** The approved design's four rows. */
const FULL = [
  {
    ...base,
    id: "c1",
    name: "parallel",
    label: "Parallel",
    preset: "parallel",
    transport: "http",
    url: "https://mcp.parallel.ai/mcp",
    headers: [{ name: "Authorization", set: true }],
    keySet: true,
    luna: true,
    projects: "all",
  },
  {
    ...base,
    id: "c2",
    name: "exa",
    label: "Exa",
    preset: "exa",
    transport: "http",
    url: "https://mcp.exa.ai/mcp",
    headers: [],
    keySet: false,
    luna: true,
    projects: [],
  },
  {
    ...base,
    id: "c3",
    name: "firecrawl",
    label: "Firecrawl",
    preset: "firecrawl",
    transport: "http",
    url: "https://mcp.firecrawl.dev/v2/mcp",
    headers: [{ name: "Authorization", set: true }],
    keySet: true,
    luna: false,
    projects: ["p1", "p2"],
  },
  {
    ...base,
    id: "c4",
    name: "playwright",
    label: "Playwright",
    transport: "stdio",
    command: "npx",
    args: ["@playwright/mcp@latest"],
    env: [{ name: "PLAYWRIGHT_BROWSERS_PATH", set: true }],
    enabled: false,
    luna: false,
    projects: ["p1"],
  },
];

/** Runs in the page before the app: a fake local service behind window.fetch. */
function mockService({ presets, connectors, theme }) {
  window.__theme = theme;
  window.__requests = [];
  const state = { connectors: structuredClone(connectors) };
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    window.__requests.push({ method, path: url.pathname, body });
    if (url.pathname === "/api/connectors" && method === "GET")
      return json({ connectors: state.connectors, presets });
    if (url.pathname === "/api/connectors" && method === "POST") {
      const preset = presets.find((item) => item.id === body.preset);
      const connector = {
        id: `n${state.connectors.length + 1}`,
        name: body.preset,
        label: preset.label,
        preset: body.preset,
        transport: "http",
        url: preset.url,
        headers: body.apiKey ? [{ name: preset.keyHeader, set: true }] : [],
        keySet: !!body.apiKey,
        enabled: true,
        luna: body.luna ?? true,
        projects: body.projects ?? "all",
        createdAt: 2,
        updatedAt: 2,
      };
      state.connectors.push(connector);
      return json({ connector });
    }
    const update = url.pathname.match(/^\/api\/connectors\/([^/]+)$/);
    if (update && method === "PATCH") {
      const connector = state.connectors.find((item) => item.id === update[1]);
      Object.assign(connector, body);
      return json({ connector });
    }
    const test = url.pathname.match(/^\/api\/connectors\/([^/]+)\/test$/);
    if (test) {
      if (test[1] === "c1") return json({ ok: true, tools: ["a", "b", "c", "d", "e"] });
      if (test[1] === "c2") return json({ ok: true, tools: ["search", "contents"] });
      if (test[1] === "c3") return json({ ok: false, error: "HTTP 401 · key rejected" });
      return json({ error: "Testing runs only for remote connectors." }, 400);
    }
    return json({ error: `Unexpected ${method} ${url.pathname}` }, 404);
  };
}

async function startFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ade-connectors-ui-"));
  const source = path.resolve("src");
  await symlink(path.resolve("node_modules"), path.join(root, "node_modules"));
  await mkdir(path.join(root, "public"));
  const write = (name, text) => writeFile(path.join(root, name), text);
  await write(
    "store.js",
    `const state = {projects:[{id:"p1",name:"spec-flow"},{id:"p2",name:"first-steps-forward"}]};
     export const useAdeState = (select) => select(state);`,
  );
  await write(
    "router.js",
    `import React from "react";
     export const Link = ({children, to, params: _p, ...rest}) => React.createElement("a", {href: to, ...rest}, children);`,
  );
  await write(
    "index.html",
    '<div id="root" style="min-height:100vh;background:var(--background);color:var(--foreground)"></div><script type="module" src="/fixture.jsx"></script>',
  );
  await write(
    "fixture.jsx",
    `
    import React from "react";
    import {createRoot} from "react-dom/client";
    import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
    import {ConnectorsWorkspace} from "@/components/ade/connectors/ConnectorsWorkspace";
    import "@/styles.css";
    document.documentElement.dataset.theme = window.__theme;
    const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
    createRoot(document.getElementById("root")).render(
      <QueryClientProvider client={client}><ConnectorsWorkspace /></QueryClientProvider>,
    );
  `,
  );
  const server = await createServer({
    configFile: false,
    root,
    publicDir: path.resolve("public"),
    cacheDir: path.join(root, ".vite-cache"),
    logLevel: "silent",
    plugins: [react(), (await import("@tailwindcss/vite")).default()],
    resolve: {
      alias: [
        { find: "@/lib/ade/store", replacement: path.join(root, "store.js") },
        { find: "@tanstack/react-router", replacement: path.join(root, "router.js") },
        { find: "@", replacement: source },
      ],
      dedupe: ["react", "react-dom"],
    },
    server: {
      host: "127.0.0.1",
      port: 0,
      fs: { allow: [source, root, path.resolve("node_modules"), path.resolve("public")] },
    },
  });
  await server.listen();
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  const open = async ({ connectors, theme = "light", width = 1280, height = 800 }) => {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("pageerror", (error) => console.error("Connectors browser error:", error));
    await page.addInitScript(mockService, { presets: PRESETS, connectors, theme });
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByRole("heading", { name: "Connectors" }).waitFor();
    await page.getByText("Add a connector").waitFor();
    return page;
  };
  return { open };
}

test(
  "Connectors adds a preset with a key, guards an empty project choice, and never shows the key",
  { skip: !existsSync(executablePath) },
  async (t) => {
    const { open } = await startFixture(t);
    const page = await open({ connectors: [] });
    await page.getByText("No connectors yet.").waitFor();

    await page.getByRole("button", { name: "Add Exa" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Add Exa" }).waitFor();
    assert.equal(
      await dialog.getByRole("link", { name: "Get a key" }).getAttribute("href"),
      "https://dashboard.exa.ai/api-keys",
    );
    await dialog.getByLabel("API key").fill(SECRET);
    assert.equal(await dialog.getByLabel("API key").getAttribute("type"), "password");
    await dialog.getByRole("button", { name: "Add connector" }).click();
    await dialog.waitFor({ state: "detached" });

    const posts = (await page.evaluate(() => window.__requests)).filter(
      (request) => request.method === "POST",
    );
    assert.deepEqual(posts, [
      {
        method: "POST",
        path: "/api/connectors",
        body: { preset: "exa", apiKey: SECRET, luna: true, projects: "all" },
      },
    ]);
    const row = page.locator('[data-connector="exa"]');
    await row.getByText("Key saved").waitFor();
    await row.getByText("Luna and all projects").waitFor();
    await page.locator('[data-preset="exa"]').getByText("Added").waitFor();
    assert.equal((await page.content()).includes(SECRET), false);

    // Projects with "Only these" and nothing ticked can't be saved.
    await page.getByRole("button", { name: "Add Parallel" }).click();
    await dialog.getByRole("heading", { name: "Add Parallel" }).waitFor();
    await dialog.getByRole("button", { name: "Projects", exact: true }).click();
    await dialog.getByLabel("Only these").check();
    const error = dialog.getByRole("alert");
    await error.waitFor();
    assert.equal(await error.textContent(), "Pick at least one project, or choose Luna.");
    await dialog.getByRole("button", { name: "Add connector" }).click();
    assert.equal(
      (await page.evaluate(() => window.__requests)).filter((r) => r.method === "POST").length,
      1,
    );
    await dialog.getByLabel("spec-flow").check();
    assert.equal(await dialog.getByRole("alert").count(), 0);
    await dialog.getByRole("button", { name: "Add connector" }).click();
    await dialog.waitFor({ state: "detached" });
    const last = (await page.evaluate(() => window.__requests))
      .filter((request) => request.method === "POST")
      .at(-1);
    assert.deepEqual(last.body, { preset: "parallel", luna: false, projects: ["p1"] });
    await page.locator('[data-connector="parallel"]').getByText("spec-flow only").waitFor();
  },
);

test(
  "Connectors lists saved connectors with scope, key state and test results",
  { skip: !existsSync(executablePath) },
  async (t) => {
    const { open } = await startFixture(t);
    const page = await open({ connectors: FULL });
    const parallel = page.locator('[data-connector="parallel"]');
    await parallel.getByText("Luna and all projects").waitFor();
    await page.locator('[data-connector="exa"]').getByText("No key, free tier").waitFor();
    await page
      .locator('[data-connector="firecrawl"]')
      .getByText("spec-flow, first-steps-forward")
      .waitFor();
    await page
      .locator('[data-connector="playwright"]')
      .getByText("npx @playwright/mcp@latest")
      .waitFor();
    assert.equal(await parallel.getByRole("button", { name: "Preview tools" }).count(), 0);
    await parallel.getByRole("button", { name: "Test Parallel" }).click();
    await parallel.getByText("Connected · 5 tools").waitFor();
    const previewParallel = parallel.getByRole("button", { name: "Preview tools" });
    await previewParallel.waitFor();
    await previewParallel.click();
    await parallel.getByText("Available tools").waitFor();
    await parallel.getByRole("list", { name: "Parallel available tools" }).getByText("a").waitFor();
    const exa = page.locator('[data-connector="exa"]');
    await exa.getByRole("button", { name: "Test Exa" }).click();
    await exa.getByText("Connected · 2 tools").waitFor();
    await exa.getByRole("button", { name: "Preview tools" }).click();
    await exa.getByRole("list", { name: "Exa available tools" }).getByText("search").waitFor();
    await page.getByRole("button", { name: "Test Firecrawl" }).click();
    await page.getByText("HTTP 401 · key rejected").waitFor();
    for (const preset of PRESETS)
      await page.locator(`[data-preset="${preset.id}"]`).getByText("Added").waitFor();

    for (const [id, name, label, originalUrl, nextUrl, luna, projects] of [
      [
        "c1",
        "parallel",
        "Parallel",
        "https://mcp.parallel.ai/mcp",
        "https://parallel.example.net/mcp",
        true,
        "all",
      ],
      ["c2", "exa", "Exa", "https://mcp.exa.ai/mcp", "https://exa.example.net/mcp", true, []],
      [
        "c3",
        "firecrawl",
        "Firecrawl",
        "https://mcp.firecrawl.dev/v2/mcp",
        "https://crawl.example.net/mcp",
        false,
        ["p1", "p2"],
      ],
    ]) {
      const row = page.locator(`[data-connector="${name}"]`);
      await row.getByRole("button", { name: `Edit ${label}` }).click();
      const editDialog = page.getByRole("dialog");
      const remoteUrl = editDialog.getByLabel("Remote URL");
      assert.equal(await remoteUrl.inputValue(), originalUrl);
      await remoteUrl.fill(nextUrl);
      await editDialog.getByRole("button", { name: "Save connector" }).click();
      await editDialog.waitFor({ state: "detached" });
      const patch = (await page.evaluate(() => window.__requests))
        .filter((request) => request.method === "PATCH")
        .at(-1);
      assert.deepEqual(patch, {
        method: "PATCH",
        path: `/api/connectors/${id}`,
        body: { luna, projects, url: nextUrl },
      });
    }

    // A saved secret shows as "Saved", never as a value.
    await page.getByRole("button", { name: "Edit Playwright" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Saved").waitFor();
    assert.equal(await dialog.getByLabel("PLAYWRIGHT_BROWSERS_PATH value").inputValue(), "");
    await page.keyboard.press("Escape");

    if (!screenshotDir) return;
    await mkdir(screenshotDir, { recursive: true });
    for (const theme of ["light", "dark"]) {
      for (const [device, width, height] of [
        ["desktop", 1280, 800],
        ["phone", 390, 844],
      ]) {
        const shot = await open({ connectors: FULL, theme, width, height });
        await shot.getByRole("button", { name: "Test Parallel" }).click();
        await shot.getByText("Connected · 5 tools").waitFor();
        await shot
          .locator('[data-connector="parallel"]')
          .getByRole("button", { name: "Preview tools" })
          .click();
        await shot.getByRole("button", { name: "Test Firecrawl" }).click();
        await shot.getByText("HTTP 401 · key rejected").waitFor();
        await shot.screenshot({
          path: path.join(screenshotDir, `connectors-${theme}-${device}.png`),
          fullPage: true,
        });
        const empty = await open({ connectors: [], theme, width, height });
        await empty.getByRole("button", { name: "Add Exa" }).click();
        await empty.getByRole("dialog").getByRole("heading", { name: "Add Exa" }).waitFor();
        await empty.waitForTimeout(400);
        await empty.screenshot({
          path: path.join(screenshotDir, `add-exa-${theme}-${device}.png`),
        });
        await shot.getByRole("button", { name: "Edit Playwright" }).click();
        await shot.getByRole("dialog").getByText("Saved").waitFor();
        await shot.waitForTimeout(400);
        await shot.screenshot({
          path: path.join(screenshotDir, `edit-playwright-${theme}-${device}.png`),
        });
        await shot.keyboard.press("Escape");
        await shot.getByRole("button", { name: "Custom connector" }).click();
        await shot.getByRole("dialog").getByRole("heading", { name: "Custom connector" }).waitFor();
        await shot.waitForTimeout(400);
        await shot.screenshot({
          path: path.join(screenshotDir, `custom-${theme}-${device}.png`),
        });
      }
    }
  },
);
