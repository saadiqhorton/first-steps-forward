/* Rendered check for the Customize ADE workshop. Loads the overview and every
 * option in both themes and widths, runs the central interaction (submit, wait,
 * try, keep, find it in Your changes, remove), the first-visit, check-fails and
 * update scenarios, reset, console errors and 390px overflow. Writes shots/.
 * Usage: node tools/check.mjs [outDir] */
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir, access } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const dir = join(fileURLToPath(new URL("..", import.meta.url)));
const repo = join(dir, "../..");
const outDir = join(dir, process.argv[2] || "shots");
await mkdir(outDir, { recursive: true });

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2" };
// The pages @import tokens from the repo's src/, so serve that too (read-only).
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    const base = p.startsWith("/src/") ? repo : dir;
    const body = await readFile(join(base, p));
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

async function findChromium() {
  for (const c of [
    join(homedir(), ".cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell"),
    join(homedir(), ".cache/ms-playwright/chromium-1254/chrome-linux64/chrome"),
    "/usr/bin/chromium",
  ]) {
    try {
      await access(c);
      return c;
    } catch {
      /* keep looking */
    }
  }
}
const browser = await chromium.launch({ executablePath: await findChromium() });
const problems = [];
const fail = (m) => problems.push(m);

async function open(hash, width = 1440) {
  const page = await browser.newPage({ viewport: { width, height: 1100 } });
  page.on("console", (m) => m.type() === "error" && fail(`console: ${m.text().split("\n")[0]}`));
  page.on("pageerror", (e) => fail(`pageerror: ${e.message}`));
  await page.goto(base + hash, { waitUntil: "networkidle" });
  await page.waitForTimeout(250);
  return page;
}
const seg = (page, ctl, v) => page.locator(`#${ctl} button[data-v='${v}']`).click();
const shot = async (page, name) => {
  // Screenshots show the whole mock: switch to Fit first.
  await page.locator("#ctl-fit button[data-v='fit']").click().catch(() => {});
  await page.waitForTimeout(80);
  return page.screenshot({ path: join(outDir, name), fullPage: true });
};

// --- overview --------------------------------------------------------------
{
  const page = await open("");
  const cards = await page.locator("#overview-grid .ov-card").count();
  const cu = await page.locator("#closeups .closeup").count();
  console.log(`overview cards ${cards}, close-ups ${cu}`);
  if (cards !== 4) fail(`expected 4 overview cards, got ${cards}`);
  if (cu < 5) fail(`expected close-ups, got ${cu}`);
  for (const t of ["idle", "building", "needs"])
    if (!(await page.locator(`#closeups [data-tab-state='${t}']`).count())) fail(`close-up tab state ${t} missing`);
  await shot(page, "overview.png");
  await page.close();
}

// --- every option, both themes and widths ----------------------------------
for (const id of [1, 2, 3, 4]) {
  for (const theme of ["light", "dark"]) {
    for (const width of ["desktop", "phone"]) {
      const page = await open(`#option-${id}`);
      await seg(page, "ctl-theme", theme);
      await seg(page, "ctl-width", width);
      await page.waitForTimeout(150);
      const mock = page.locator("#stage-frame .mock");
      if ((await mock.count()) !== 1) fail(`option ${id}: no mock mounted`);
      const nav = await mock.locator("[data-tab-state]").count();
      if (width === "desktop" && !(await mock.locator(".a-nav", { hasText: "Customize ADE" }).count())) fail(`option ${id}: Customize ADE tab missing`);
      if (width === "phone") {
        const over = await mock.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        if (over) fail(`option ${id} phone: mock overflows horizontally`);
        await mock.locator('[data-act="menu"]').click();
        if (!(await mock.locator("[data-menu-customize]").count())) fail(`option ${id} phone: Customize ADE not in the Projects menu`);
      }
      if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)) fail(`option ${id}: page scrolls sideways`);
      if (width === "desktop" && (await page.locator("#ctl-fit button[aria-pressed=true]").getAttribute("data-v")) !== "100") fail("desktop should default to 100%");
      await shot(page, `option-${id}-${theme}-${width}.png`);
      await page.close();
    }
  }
}

// --- central interaction ----------------------------------------------------
const TITLE = "Copy full log button";
async function toKept(page, mock) {
  await mock.locator('[data-act="submit"]').first().click();
  await page.waitForTimeout(200);
  if (await mock.locator('[data-act="keep"]:not([disabled])').count()) fail("Keep it was enabled while building");
  await mock.locator('[data-act="keep"]:not([disabled])').first().waitFor({ timeout: 12000 });
  await mock.locator('[data-act="try"]:not([disabled])').first().click();
  await page.waitForTimeout(200);
  if (!(await mock.locator('[data-role="preview"]').count())) fail("Try it did not show the preview");
  await mock.locator('[data-act="copylog"]').first().click();
  await page.waitForTimeout(150);
  if (!(await mock.locator('[data-role="preview"]', { hasText: "Copied" }).count())) fail("Copy log did not say Copied");
  await mock.locator('[data-act="keep"]:not([disabled])').first().click();
  await page.waitForTimeout(250);
  const steps = await mock.innerText();
  if (!/Wait for agents to finish/.test(steps)) fail("switching sequence not shown");
  await mock.getByText("You're on your version.").first().waitFor({ timeout: 8000 }).catch(() => fail("never reached 'You're on your version.'"));
}
for (const id of [1, 2, 3, 4]) {
  const page = await open(`#option-${id}`);
  const mock = page.locator("#stage-frame .mock");
  await page.waitForTimeout(100);
  await toKept(page, mock);
  await shot(page, `option-${id}-kept.png`);
  if (id === 1) await mock.locator('[data-act="open-sheet"]').click();
  if (id === 2) await mock.locator('[data-act="tab"][data-id="changes"]').click();
  await page.waitForTimeout(200);
  const row = mock.locator(`[data-kept]`, { hasText: TITLE });
  if (!(await row.count())) fail(`option ${id}: kept change not in Your changes`);
  if (id === 1) await shot(page, "option-1-sheet.png");
  await row.locator('[data-act="remove"]').click();
  await page.waitForTimeout(150);
  await mock.locator('[data-act="remove-confirm"]').click();
  await page.waitForTimeout(1800);
  if (await mock.locator(`[data-kept]`, { hasText: TITLE }).count()) fail(`option ${id}: Remove did not remove`);
  if (!(await mock.locator("[data-kept]", { hasText: "Stop dev servers" }).count()) && id !== 2) fail(`option ${id}: first kept change vanished`);
  console.log(`option ${id}: submit, try, keep, appear, remove ok`);
  await page.close();
}

// --- keyboard focus survives re-render --------------------------------------
{
  const page = await open("#option-1");
  const ta = page.locator('#stage-frame [data-act="draft"]');
  await ta.fill("");
  await ta.type("Hello there");
  await page.waitForTimeout(100);
  const v = await ta.inputValue();
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-act"));
  if (v !== "Hello there" || focused !== "draft") fail(`draft typing lost focus or text (${focused}: ${v})`);
  await page.close();
}

// --- check fails -------------------------------------------------------------
for (const id of [1, 2, 3, 4]) {
  const page = await open(`#option-${id}`);
  await seg(page, "ctl-scenario", "fails");
  const mock = page.locator("#stage-frame .mock");
  await mock.locator('[data-act="submit"]').first().click();
  await mock.locator('[data-role="fail-output"]').waitFor({ timeout: 12000 }).catch(() => fail(`option ${id}: no failure output`));
  const keeps = mock.locator('[data-act="keep"]');
  const total = await keeps.count();
  const off = await mock.locator('[data-act="keep"][disabled]').count();
  if (!total || total !== off) fail(`option ${id}: Keep it not disabled on failed checks (${off}/${total})`);
  if (!/The agent is fixing this/.test(await mock.innerText())) fail(`option ${id}: missing 'The agent is fixing this'`);
  if (id === 1) await shot(page, "option-1-fails.png");
  // reset clears the in-progress change and its timers
  await page.locator("#ctl-reset").click();
  await page.waitForTimeout(300);
  if (await mock.locator('[data-act="keep"]').count()) fail(`option ${id}: reset left the change card`);
  await page.close();
}

// --- first visit and updates --------------------------------------------------
for (const id of [1, 2, 3, 4]) {
  let page = await open(`#option-${id}`);
  let mock = page.locator("#stage-frame .mock");
  await seg(page, "ctl-scenario", "first");
  await mock.locator('[data-act="setup"]').click();
  await page.waitForTimeout(500);
  if (!(await mock.locator('[role="progressbar"]').count())) fail(`option ${id}: no setup progress`);
  if (id === 1) await shot(page, "option-1-setup.png");
  await mock.locator('[data-act="draft"]').waitFor({ timeout: 8000 }).catch(() => fail(`option ${id}: setup never finished`));

  await seg(page, "ctl-scenario", "needs");
  for (const a of ["update-retry", "update-without", "update-stay"])
    if (!(await mock.locator(`[data-act="${a}"]`).count())) fail(`option ${id}: update decision missing ${a}`);
  if ((await mock.locator('[data-tab-state="needs"]').count()) < 1) fail(`option ${id}: tab not 'needs you' for the update`);
  if (id === 1) await shot(page, "option-1-update-needs.png");
  await mock.locator('[data-act="update-stay"]').click();
  await mock.locator('[data-act="update-review"]').waitFor({ timeout: 2000 }).catch(() => fail(`option ${id}: Stay on 0.1.15 did nothing`));

  await seg(page, "ctl-scenario", "carry");
  await mock.locator('[data-act="update-now"]').click();
  await mock.getByText("ADE is on 0.1.16").first().waitFor({ timeout: 6000 }).catch(() => fail(`option ${id}: carry-over update did not finish`));
  await page.close();
}

// --- 390px viewport: no sideways scroll ----------------------------------------
for (const hash of ["", "#option-1", "#option-2", "#option-3", "#option-4"]) {
  const page = await open(hash, 390);
  if (hash) await seg(page, "ctl-width", "phone");
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2))
    fail(`page ${hash || "overview"} scrolls sideways at 390px`);
  await shot(page, `narrow-${hash.replace("#", "") || "overview"}.png`);
  await page.close();
}

await browser.close();
server.close();
console.log(problems.length ? `PROBLEMS:\n- ${[...new Set(problems)].join("\n- ")}` : "all checks passed");
process.exit(problems.length ? 1 : 0);
