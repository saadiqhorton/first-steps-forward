import { chromium } from "@playwright/test";
const out = process.argv[2];
const browser = await chromium.launch();
const logs = [];
async function session(vw, vh) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type()))
      logs.push(`[${vw}] ${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => logs.push(`[${vw}] pageerror: ${e.message.slice(0, 300)}`));
  await page.goto("http://127.0.0.1:3100/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  return { ctx, page };
}
async function dragSeam(page, toX, toY) {
  const seam = page.locator("#seam-shell-right");
  const b = await seam.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + (b.height > 40 ? 60 : 0));
  await page.mouse.down();
  await page.mouse.move(toX ?? b.x + b.width / 2, toY ?? b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });

// 1. Wide window, side dock default, then narrow right panel to ~310px
let { ctx, page } = await session(1600, 900);
console.log("url:", page.url());
await shot(page, "01-side-default-1600");
await page
  .locator("#right-computer-tab")
  .click()
  .catch(() => {});
await dragSeam(page, 1600 - 310, null);
await shot(page, "02-side-310px-1600");
await page
  .locator("#right-activity-tab")
  .click()
  .catch(() => {});
await page.waitForTimeout(300);
await shot(page, "03-side-310px-activity");
// collapse via button
await page
  .getByRole("button", { name: "Collapse right panel" })
  .click()
  .catch((e) => logs.push("no collapse btn " + e.message));
await page.waitForTimeout(500);
await shot(page, "04-side-collapsed-rail");
// expand via rail computer icon
await page
  .getByRole("button", { name: "Computer", exact: true })
  .first()
  .click()
  .catch((e) => logs.push("rail computer " + e.message));
await page.waitForTimeout(500);
await shot(page, "05-side-reexpanded");
// dock to bottom
await page
  .getByRole("button", { name: "Dock to bottom" })
  .click()
  .catch((e) => logs.push("dock btn " + e.message));
await page.waitForTimeout(700);
await shot(page, "06-bottom-dock-1600");
await page
  .getByRole("button", { name: "Collapse right panel" })
  .click()
  .catch((e) => logs.push("collapse bottom " + e.message));
await page.waitForTimeout(500);
await shot(page, "07-bottom-collapsed-bar");
await page
  .getByRole("button", { name: "Show right panel" })
  .first()
  .click()
  .catch((e) => logs.push("expand bottom " + e.message));
await page.waitForTimeout(500);
await page
  .getByRole("button", { name: "Dock to side" })
  .click()
  .catch((e) => logs.push("dock side " + e.message));
await page.waitForTimeout(500);
await ctx.close();

// 2. 1024 window, side dock, max-narrow
({ ctx, page } = await session(1024, 768));
await dragSeam(page, 1024 - 280, null);
await shot(page, "08-side-min-1024");
await ctx.close();

// 3. Small window: forced bottom dock
({ ctx, page } = await session(820, 900));
await shot(page, "09-small-820-bottom");
await page
  .locator("#right-computer-tab")
  .click()
  .catch(() => {});
await page.waitForTimeout(300);
await shot(page, "10-small-820-computer");
await ctx.close();

// 4. Workflows page narrow main panel
({ ctx, page } = await session(1280, 800));
const wf = page.url().replace(/\/conversations.*$/, "/workflows");
await page.goto(wf, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await dragSeam(page, 1280 - 760, null);
await shot(page, "11-workflows-narrow-main");
await ctx.close();

console.log(logs.join("\n") || "no console errors");
await browser.close();
