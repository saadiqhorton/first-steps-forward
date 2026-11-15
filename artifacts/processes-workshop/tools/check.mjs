/* Rendered check for the Processes workshop: loads every option, exercises the
 * central interaction (search, select, stop, mark as good, stop all), checks
 * state isolation and focus, and writes screenshots. Usage: node tools/check.mjs [outDir] */
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, mkdir, access } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const dir = join(fileURLToPath(new URL("..", import.meta.url)));
const outDir = join(dir, process.argv[2] || "shots");
await mkdir(outDir, { recursive: true });

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    const body = await readFile(join(dir, p));
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/index.html`;

async function findChromium() {
  const candidates = [
    join(
      homedir(),
      ".cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell",
    ),
    join(homedir(), ".cache/ms-playwright/chromium-1254/chrome-linux64/chrome"),
    "/usr/bin/chromium",
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return undefined;
}

const browser = await chromium.launch({ executablePath: await findChromium() });
const problems = [];

async function newPage(hash) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text().split("\n")[0]}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(base + hash, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  return page;
}

// --- overview -------------------------------------------------------------
{
  const page = await newPage("");
  const cards = await page.locator("#overview-grid .ov-card").count();
  console.log(`overview cards: ${cards}`);
  if (cards !== 4) problems.push(`expected 4 overview cards, got ${cards}`);
  await page.screenshot({ path: join(outDir, "overview.png"), fullPage: true });
  await page.close();
}

// --- every option renders -------------------------------------------------
for (const id of [1, 2, 3, 4]) {
  const page = await newPage(`#option-${id}`);
  const stage = page.locator("#stage-frame .mock");
  if ((await stage.count()) !== 1) problems.push(`option ${id}: no mock mounted`);
  const notes = await page.locator("#opt-notes li").count();
  if (notes < 3) problems.push(`option ${id}: only ${notes} notes`);
  const closeups = await page.locator("#closeups .closeup").count();
  if (closeups < 2) problems.push(`option ${id}: only ${closeups} close-ups`);
  const rowSel = id === 1 || id === 2 ? ".m-prow" : id === 3 ? ".o3-row" : ".o4-card";
  const rows = await stage.locator(rowSel).count();
  console.log(`option ${id}: rows=${rows}`);
  if (rows < 2) problems.push(`option ${id}: the sample list is missing`);
  await page.screenshot({ path: join(outDir, `option-${id}.png`), fullPage: true });
  await page.close();
}

// --- option 1: search, select, stop, mark good, stop all ------------------
{
  const page = await newPage("#option-1");
  const mock = page.locator("#stage-frame .mock");
  const rows = () => mock.locator(".m-prow").count();

  const before = await rows();
  await mock.locator('[data-act="search"]').fill("storybook");
  await mock.locator('[data-act="search"]').dispatchEvent("input");
  await page.waitForTimeout(250);
  const filtered = await rows();
  console.log(`rows before search ${before}, for “storybook” ${filtered}`);
  if (filtered !== 1) problems.push(`search did not narrow the list (${filtered})`);

  // Focus survives the re-render, so typing keeps the caret in the field.
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-act"));
  if (focused !== "search") problems.push(`search lost focus after filtering (${focused})`);

  await mock.locator('[data-act="search"]').fill("");
  await mock.locator('[data-act="search"]').dispatchEvent("input");
  await page.waitForTimeout(250);

  // Select the Storybook process; the detail pane follows.
  await mock.locator('[data-act="select"][data-id="p2"]').click();
  await page.waitForTimeout(200);
  const title = await mock.locator(".o1-detail-title h2").innerText();
  console.log(`selected process: ${title}`);
  if (!/Storybook/.test(title)) problems.push("selecting a row did not open its details");

  // Mark all as good clears the reminder.
  await page.locator("#ctl-scenario button[data-v='checking']").click();
  await page.waitForTimeout(300);
  const checksBefore = await mock.locator(".o1-checks").count();
  await mock.locator('[data-act="mark-all"]').first().click();
  await page.waitForTimeout(250);
  const checksAfter = await mock.locator(".o1-checks").count();
  console.log(`checks banner before ${checksBefore}, after ${checksAfter}`);
  if (!checksBefore || checksAfter) problems.push("Mark all as good did not clear the reminder");
  await page.screenshot({ path: join(outDir, "option-1-checking.png"), fullPage: true });

  // Stop one process: it says Stop requested, then leaves the list.
  await page.locator("#ctl-scenario button[data-v='mixed']").click();
  await page.waitForTimeout(300);
  await mock.locator('[data-act="stop"][data-id="p1"]').first().click();
  await page.waitForTimeout(150);
  const stopping = await mock.locator(".m-prow-flag", { hasText: "Stop requested" }).count();
  const notice = await mock.locator(".m-notice").innerText();
  console.log(`stop requested rows: ${stopping}; notice: ${notice.slice(0, 60)}`);
  if (!stopping) problems.push("Stop did not show Stop requested…");
  await page.screenshot({ path: join(outDir, "option-1-stopping.png"), fullPage: true });
  await page.waitForTimeout(1400);
  const afterStop = await rows();
  console.log(`rows after stop: ${afterStop}`);
  if (afterStop !== before - 1) problems.push(`stopped process stayed in the list (${afterStop})`);

  // Stop all asks before it acts.
  await mock.locator('[data-act="stop-all"]').first().click();
  await page.waitForTimeout(250);
  const dialog = await mock.locator(".m-dialog").count();
  console.log(`stop-all confirmation: ${dialog}`);
  if (!dialog) problems.push("Stop all did not ask for confirmation");
  await page.screenshot({ path: join(outDir, "option-1-stop-all.png"), fullPage: true });
  await mock.locator('[data-act="confirm-stop-all"]').click();
  await page.waitForTimeout(1500);
  const empty = await mock.locator(".o1-detail .m-empty-state").count();
  console.log(`empty state after stop all: ${empty}`);
  if (!empty) problems.push("Stop all did not empty the list");

  await page.close();
}

// --- option 3: row selection, output dock, wrap and follow ----------------
{
  const page = await newPage("#option-3");
  const mock = page.locator("#stage-frame .mock");
  await mock.locator('.o3-row[data-id="p3"]').click();
  await page.waitForTimeout(200);
  const name = await mock.locator(".o3-dock-name").innerText();
  console.log(`dock process: ${name}`);
  if (!/Test watcher/.test(name)) problems.push("console dock did not follow the selected row");

  const out = mock.locator("[data-output]");
  await out.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForTimeout(250);
  const followOff = await mock.locator('[data-act="follow"]').count();
  const scrolled = await mock.locator(".o3-dock-bar").innerText();
  console.log(`follow after scrolling up: button ${followOff}, bar “${scrolled.split("\n")[0]}”`);
  if (followOff !== 1 || !/scrolled back/i.test(scrolled))
    problems.push("scrolling up did not pause Follow latest");
  await mock.locator('[data-act="follow"]').click();
  await page.waitForTimeout(200);
  const followOn = await mock.locator('[data-act="follow"]').count();
  if (followOn !== 0) problems.push("Follow latest did not resume");

  await mock.locator('[data-act="wrap"]').click();
  await page.waitForTimeout(200);
  const wrap = await mock.locator('[data-act="wrap"]').getAttribute("aria-pressed");
  console.log(`wrap after toggle: ${wrap}`);
  if (wrap !== "false") problems.push("Wrap output lines did not toggle");

  await page.screenshot({ path: join(outDir, "option-3-dock.png"), fullPage: true });
  await page.close();
}

// --- option 2: no project tab, follow latest in the expanded log ----------
{
  const page = await newPage("#option-2");
  const mock = page.locator("#stage-frame .mock");
  const projectTabs = await mock.locator(".m-sections").innerText();
  console.log(`project tabs: ${projectTabs.replace(/\n/g, " | ")}`);
  if (!/Processes/.test(projectTabs))
    problems.push("Option 2 is missing the ADE-only Processes project tab");
  const rightTabs = await mock.locator(".o2-tabs").innerText();
  if (!/Processes/.test(rightTabs)) problems.push("Processes is not in the right-pane tabs");

  const out = mock.locator("[data-output]");
  await out.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForTimeout(250);
  const scrolled = await mock.locator(".o2-output-label").innerText();
  const follow = await mock.locator('[data-act="follow"]').count();
  console.log(`rail output: ${scrolled}; follow button ${follow}`);
  if (!/Scrolled back/i.test(scrolled) || follow !== 1)
    problems.push("Option 2 did not pause follow when scrolled");
  await mock.locator('[data-act="follow"]').click();
  await page.waitForTimeout(200);
  const following = await mock.locator(".o2-output-label").innerText();
  console.log(`after follow: ${following}`);
  if (!/Following log/i.test(following)) problems.push("Option 2 Follow latest did not resume");
  await page.screenshot({ path: join(outDir, "option-2-follow.png"), fullPage: true });
  await page.close();
}

// --- option 4: sheet opens and closes, Escape works -----------------------
{
  const page = await newPage("#option-4");
  const mock = page.locator("#stage-frame .mock");
  await mock.locator('[data-act="sheet"][data-id="p2"]').click();
  await page.waitForTimeout(300);
  const sheet = await mock.locator(".o4-sheet").count();
  const sheetTitle = sheet ? await mock.locator(".o4-sheet h2").innerText() : "";
  console.log(`sheet open: ${sheet}; title: ${sheetTitle}`);
  if (!sheet) problems.push("card details did not open the sheet");
  await page.screenshot({ path: join(outDir, "option-4-sheet.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  if (await mock.locator(".o4-sheet").count()) problems.push("Escape did not close the sheet");
  await page.close();
}

// --- scenarios, theme and reset ------------------------------------------
{
  const page = await newPage("#option-1");
  const mock = page.locator("#stage-frame .mock");
  await page.locator("#ctl-scenario button[data-v='empty']").click();
  await page.waitForTimeout(300);
  const emptyText = await mock.locator(".o1-detail .m-empty-state h3").first().innerText();
  console.log(`empty scenario: ${emptyText}`);
  if (!/Nothing running/.test(emptyText)) problems.push("empty scenario did not show Nothing running yet");

  await page.locator("#ctl-scenario button[data-v='failing']").click();
  await page.waitForTimeout(250);
  await mock.locator('[data-act="select"][data-id="p2"]').click();
  await page.waitForTimeout(200);
  await mock.locator('[data-act="stop"][data-id="p2"]').first().click();
  await page.waitForTimeout(300);
  const failed = await mock.locator(".o1-error").count();
  console.log(`couldn't stop message: ${failed}`);
  if (!failed) problems.push("stop failure did not explain itself");

  await page.locator("#ctl-theme button[data-v='dark']").click();
  await page.waitForTimeout(250);
  const theme = await mock.getAttribute("data-mock-theme");
  console.log(`mock theme: ${theme}`);
  if (theme !== "dark") problems.push("theme control did not switch the mock");
  await page.screenshot({ path: join(outDir, "option-1-dark.png"), fullPage: true });

  await page.locator("#ctl-reset").click();
  await page.waitForTimeout(250);
  const rows = await mock.locator(".m-prow").count();
  const query = await mock.locator('[data-act="search"]').inputValue();
  console.log(`after reset rows ${rows}, query “${query}”`);
  if (!rows || query) problems.push("reset did not clear the scenario and search");
  await page.close();
}

// --- narrow window smoke test --------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 600, height: 1100 } });
  page.on("pageerror", (e) => problems.push(`narrow pageerror: ${e.message}`));
  await page.goto(base + "#option-1", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, "narrow.png"), fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  );
  if (overflow) problems.push("the page scrolls sideways at 600px");
  await page.close();
}

await browser.close();
server.close();

console.log(problems.length ? `PROBLEMS:\n- ${problems.join("\n- ")}` : "all checks passed");
process.exit(problems.length ? 1 : 0);
