/* Element screenshots of one option's mock in its key states, for use as build references.
 * Usage: node tools/refs.mjs <outDir> [option=2] */
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir, access } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const dir = fileURLToPath(new URL("..", import.meta.url));
const repo = resolve(dir, "../..");
const outDir = resolve(process.argv[2] || join(dir, "refs"));
const opt = process.argv[3] || "2";
await mkdir(outDir, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const body = await readFile(join(repo, p));
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/artifacts/customize-ade-workshop/index.html`;
let exe;
for (const c of [
  join(homedir(), ".cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell"),
  join(homedir(), ".cache/ms-playwright/chromium-1254/chrome-linux64/chrome"),
  "/usr/bin/chromium",
]) {
  try {
    await access(c);
    exe = c;
    break;
  } catch {}
}
const browser = await chromium.launch({ executablePath: exe });
const seg = (page, ctl, v) => page.locator(`#${ctl} button[data-v='${v}']`).click();

async function capture(name, { theme = "dark", width = "desktop", scenario, act } = {}) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  await page.goto(`${base}#option-${opt}`, { waitUntil: "networkidle" });
  if (scenario) await seg(page, "ctl-scenario", scenario);
  await seg(page, "ctl-theme", theme);
  await seg(page, "ctl-width", width);
  await page.locator("#ctl-fit button[data-v='100']").click().catch(() => {});
  await page.waitForTimeout(200);
  const mock = page.locator("#stage-frame .mock");
  if (act) await act(page, mock);
  await page.waitForTimeout(300);
  await mock.screenshot({ path: join(outDir, name) });
  console.log("wrote", name);
  await page.close();
}

const toReady = async (page, mock) => {
  await mock.locator('[data-act="submit"]').first().click();
  await mock.locator('[data-act="keep"]:not([disabled])').first().waitFor({ timeout: 15000 });
  await mock.locator('[data-act="try"]:not([disabled])').first().click();
};
await capture("W01-start-dark.png");
await capture("W02-ready-preview-dark.png", { act: toReady });
await capture("W03-check-fails-dark.png", {
  scenario: "fails",
  act: async (p, m) => {
    await m.locator('[data-act="submit"]').first().click();
    await m.locator('[data-role="fail-output"]').waitFor({ timeout: 15000 });
  },
});
await capture("W04-kept-changes-dark.png", {
  act: async (p, m) => {
    await toReady(p, m);
    await m.locator('[data-act="keep"]:not([disabled])').first().click();
    await m.getByText("You're on your version.").first().waitFor({ timeout: 10000 });
    await m.locator('[data-act="tab"][data-id="changes"]').click().catch(() => {});
  },
});
await capture("W05-update-needs-you-dark.png", { scenario: "needs" });
await capture("W06-first-visit-dark.png", { scenario: "first" });
await capture("W07-ready-preview-light.png", { theme: "light", act: toReady });
await capture("W08-phone-dark.png", { width: "phone" });
await browser.close();
server.close();
