/* Rendered check for the skills workspace workshop: loads every option, runs the
 * import / create / edit / remove loop inside the mock, and writes screenshots.
 * Usage: node tools/check.mjs [outDir] */
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

const browser = await chromium.launch({
  executablePath: await findChromium(),
});
const problems = [];

/** The bundled browser revision may not match playwright-core's; use whatever
 * chromium is on the machine instead. */
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

async function newPage(hash) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text().split("\n")[0]}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(base + hash, { waitUntil: "networkidle" });
  await page.waitForTimeout(350);
  return page;
}

// --- overview -------------------------------------------------------------
{
  const page = await newPage("");
  const cards = await page.locator("#overview-grid .ov-card").count();
  console.log(`overview cards: ${cards}`);
  if (cards !== 5) problems.push(`expected 5 overview cards, got ${cards}`);
  await page.screenshot({ path: join(outDir, "overview.png"), fullPage: true });
  await page.close();
}

// --- every option ---------------------------------------------------------
for (const id of [1, 2, 3, 4, 5]) {
  const page = await newPage(`#option-${id}`);
  const stage = page.locator("#stage-frame .mock");
  if ((await stage.count()) !== 1) problems.push(`option ${id}: no mock mounted`);
  const notes = await page.locator("#opt-notes li").count();
  if (notes < 3) problems.push(`option ${id}: only ${notes} notes`);
  const closeups = await page.locator("#closeups .closeup").count();
  if (closeups < 1) problems.push(`option ${id}: no close-ups`);
  await page.screenshot({ path: join(outDir, `option-${id}.png`), fullPage: true });
  await page.close();
}

// --- the central interaction ---------------------------------------------
// Runs inside option 1's mock: import a package, create a skill, edit it, remove it.
{
  const page = await newPage("#option-1");
  const mock = page.locator("#stage-frame .mock");
  const count = async () => await mock.locator(".g-card").count();

  const before = await count();
  await mock.locator('[data-act="open-import"]').click();
  await page.waitForTimeout(200);
  await mock.locator('[data-act="pick-file"]').click();
  await page.waitForTimeout(200);
  const staged = await mock.locator(".g-staged-row").count();
  console.log(`staged skills in dialog: ${staged}`);
  if (staged < 1) problems.push("import dialog staged nothing");
  await mock.locator('[data-act="do-import"]').click();
  await page.waitForTimeout(300);
  const after = await count();
  console.log(`cards before ${before} after ${after}`);
  if (after <= before) problems.push("import did not add a skill card");

  // create
  await mock.locator('[data-act="new"]').click();
  await page.waitForTimeout(200);
  await mock.locator("#g-name").fill("release-checklist");
  await mock.locator("#g-desc").fill("Use this skill when a release is cut.");
  await page.waitForTimeout(150);
  await mock.locator('[data-act="save"]').click();
  await page.waitForTimeout(300);
  const created = await mock.locator(".g-card").count();
  console.log(`cards after create: ${created}`);
  if (created <= after) problems.push("create did not add a skill card");

  // edit
  await mock.locator(".g-card").first().click();
  await page.waitForTimeout(200);
  await mock.locator('[data-act="edit"]').first().click();
  await page.waitForTimeout(200);
  await mock.locator("#g-desc").fill("Use this skill when a release is cut, to check the notes.");
  await page.waitForTimeout(150);
  await mock.locator('[data-act="save"]').click();
  await page.waitForTimeout(300);
  const edited = await mock.locator(".g-drawer .g-detail-desc").first().innerText();
  console.log(`edited description: ${edited.slice(0, 60)}`);
  if (!edited.includes("check the notes")) problems.push("edit did not persist the description");

  // remove
  await mock.locator('[data-act="remove"]').first().click();
  await page.waitForTimeout(150);
  await mock.locator('[data-act="remove-yes"]').click();
  await page.waitForTimeout(300);
  const removed = await mock.locator(".g-card").count();
  console.log(`cards after remove: ${removed}`);
  if (removed !== created - 1) problems.push("remove did not drop a card");

  await page.screenshot({ path: join(outDir, "option-1-interaction.png"), fullPage: true });
  await page.close();
}

// --- the invalid package path ---------------------------------------------
{
  const page = await newPage("#option-2");
  await page.locator("#ctl-package button[data-v='invalid']").click();
  await page.waitForTimeout(250);
  const mock = page.locator("#stage-frame .mock");
  await mock.locator('[data-act="pick-file"]').first().click();
  await page.waitForTimeout(250);
  const error = await mock.locator(".x-error").count();
  console.log(`invalid package error shown: ${error > 0}`);
  if (!error) problems.push("invalid package did not show an error");
  await page.screenshot({ path: join(outDir, "option-2-invalid.png"), fullPage: true });
  await page.close();
}

// --- project skills stay hidden until they are asked for ---------------------
{
  const page = await newPage("#option-1");
  const mock = page.locator("#stage-frame .mock");
  const hidden = await mock.locator(".g-card").count();
  await page.locator("#ctl-detect button[data-v='shown']").click();
  await page.waitForTimeout(300);
  const shown = await mock.locator(".g-card").count();
  console.log(`cards with project skills hidden ${hidden}, shown ${shown}`);
  if (hidden !== 3 || shown !== 5) problems.push(`project detection wrong (${hidden} → ${shown})`);

  // A found project skill is read-only, and can be copied into ADE.
  await mock.locator('[data-act="select"][data-id="untangle-codebase"]').click();
  await page.waitForTimeout(250);
  const copyButton = await mock.locator('[data-act="copy-to-ade"]').count();
  if (!copyButton) problems.push("no way to copy a found project skill into ADE");
  await mock.locator('[data-act="copy-to-ade"]').click();
  await page.waitForTimeout(300);
  const notice = await mock.locator(".m-notice").innerText();
  console.log(`copy notice: ${notice}`);
  if (!notice.includes("~/.ade/skills")) problems.push("copy did not say where the skill went");
  await page.close();
}

// --- reset clears state ----------------------------------------------------
{
  const page = await newPage("#option-1");
  const mock = page.locator("#stage-frame .mock");
  await mock.locator('[data-act="open-import"]').click();
  await page.waitForTimeout(200);
  await mock.locator('[data-act="pick-file"]').click();
  await page.waitForTimeout(200);
  await mock.locator('[data-act="do-import"]').click();
  await page.waitForTimeout(300);
  const imported = await mock.locator(".g-card").count();
  await page.locator("#ctl-reset").click();
  await page.waitForTimeout(400);
  const afterReset = await mock.locator(".g-card").count();
  const notices = await mock.locator(".m-notice").count();
  console.log(`cards after import ${imported}, after reset ${afterReset}, notices ${notices}`);
  if (afterReset !== 3) problems.push(`reset did not restore the library (${afterReset} cards)`);
  if (notices) problems.push("reset left a toast behind");
  await page.close();
}

// --- keyboard focus survives a re-render -----------------------------------
{
  const page = await newPage("#option-1");
  const mock = page.locator("#stage-frame .mock");
  await mock.locator('[data-act="open-import"]').click();
  await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelector("#ctl-package button[data-v='zip']").focus());
  await page.locator("#ctl-package button[data-v='zip']").click();
  await page.waitForTimeout(250);
  const controlFocus = await page.evaluate(() => document.activeElement?.textContent?.trim());
  console.log(`focus after package switch: ${controlFocus}`);
  if (!controlFocus?.includes("zip")) problems.push("the package control lost focus");

  // Focus a card, activate it with the keyboard, and check the focus follows.
  await mock.locator(".g-card").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const cardFocus = await page.evaluate(() => document.activeElement?.getAttribute("data-focus"));
  console.log(`focus after keyboard activation: ${cardFocus}`);
  if (!cardFocus?.startsWith("card-")) problems.push("the mock lost focus after a re-render");
  await page.close();
}

// --- light theme -----------------------------------------------------------
{
  const page = await newPage("#option-1");
  await page.locator("#ctl-theme button[data-v='light']").click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(outDir, "option-1-light.png"), fullPage: true });
  await page.close();
}

await browser.close();
server.close();

if (problems.length) {
  console.log("\nPROBLEMS:");
  for (const p of problems) console.log(" -", p);
  process.exitCode = 1;
} else {
  console.log("\nno problems found");
}
