import { chromium } from "/home/dezignerdrugz/Work/first-steps-forward/node_modules/playwright-core/index.mjs";

process.env.TMPDIR = "/home/dezignerdrugz/tmp";
const BASE = "http://127.0.0.1:4321";
const OUT = "/home/dezignerdrugz/Work/first-steps-forward/artifacts/shell-regression";
const boot = await (await fetch(`${BASE}/api/bootstrap`)).json();
const project = boot.projects[0];
const session = "session-shell-fixture";
const convo = `/p/${project.id}/conversations`;
const convoDetail = `/p/${project.id}/conversations/${session}`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });

async function widths(page) {
  return page.evaluate(() => {
    const w = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), w: Math.round(r.width), display: getComputedStyle(el).display };
    };
    return {
      url: location.pathname,
      left: w('[data-testid="conversations-list"]'),
      leftSeam: w('[data-testid="seam-conversations-list"]'),
      convMain: w('[data-testid="conversations-main"]'),
      main: w('[data-testid="shell-main"]'),
      right: w('[data-testid="shell-right"]'),
      rightSeam: w('[data-testid="seam-shell-right"]'),
      filesExplorer: w('[data-testid="files-explorer"]'),
      filesSeam: w('[data-testid="seam-files-explorer"]'),
      filesMain: w('[data-testid="files-main"]'),
      bodyFull: document.body.classList.contains("shell-full-width"),
      scrollW: document.documentElement.scrollWidth,
      viewportW: innerWidth,
      storage: Object.fromEntries(
        [
          "ade-shell-layout-v2",
          "ade-conversations-layout",
          "ade-files-layout",
          "ade-conversations-list-width",
          "ade-files-explorer-width",
        ].map((k) => [k, localStorage.getItem(k)]),
      ),
    };
  });
}

async function drag(page, selector, dx) {
  const el = page.locator(selector).first();
  const box = await el.boundingBox();
  if (!box) throw new Error(`No box for ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(350);
}

async function go(page, path) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => !!document.querySelector("main") || !!document.querySelector('[data-testid="files-main"]'),
    null,
    { timeout: 15000 },
  );
  await page.waitForTimeout(600);
}

async function shot(page, tag) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.screenshot({ path: `${OUT}/${tag}.png`, timeout: 20000 });
      return;
    } catch (error) {
      if (attempt === 2) console.log(`screenshot ${tag} failed: ${error.message}`);
      await page.waitForTimeout(300);
    }
  }
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const issues = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") issues.push(`${m.type()}: ${m.text().slice(0, 200)}`);
});
page.on("pageerror", (e) => issues.push(`pageerror: ${e.message}`));

// Start clean: no saved layouts.
await go(page, convo);
await page.evaluate(() => {
  for (const k of ["ade-shell-layout-v2", "ade-conversations-layout", "ade-files-layout", "ade-conversations-list-width", "ade-files-explorer-width"]) localStorage.removeItem(k);
});
await go(page, convo);

let w = await widths(page);
console.log("INITIAL", JSON.stringify(w));
const initialLeft = w.left.w;
const initialRight = w.right.w;
check("conversations starts with both panes", initialLeft > 200 && initialRight > 500, JSON.stringify({ initialLeft, initialRight }));

// 1. Drag left list to ~300.
const leftSeamX = w.leftSeam.x;
await drag(page, '[data-testid="seam-conversations-list"]', 300 - initialLeft);
w = await widths(page);
console.log("AFTER LEFT DRAG", JSON.stringify(w));
const left300 = w.left.w;
check("left list drag reaches ~300px", Math.abs(left300 - 300) <= 6, `left=${left300}`);
check("right pane unchanged after left drag", w.right.w === initialRight, `right=${w.right.w} vs ${initialRight}`);

// Drag right pane to ~420 (drag seam right).
await drag(page, '[data-testid="seam-shell-right"]', initialRight - 420);
w = await widths(page);
console.log("AFTER RIGHT DRAG", JSON.stringify(w));
const right420 = w.right.w;
check("right pane drag reaches ~420px", Math.abs(right420 - 420) <= 8, `right=${right420}`);
check("left list unchanged after right drag", w.left.w === left300, `left=${w.left.w} vs ${left300}`);

// Persist after reload.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!document.querySelector("main"), null, { timeout: 15000 });
await page.waitForTimeout(900);
w = await widths(page);
console.log("AFTER RELOAD", JSON.stringify(w));
check("left width persists after reload", Math.abs(w.left.w - left300) <= 2, `left=${w.left.w} vs ${left300}`);
check("right width persists after reload", Math.abs(w.right.w - right420) <= 2, `right=${w.right.w} vs ${right420}`);
check("no full-width class leaked onto conversations", !w.bodyFull, `bodyFull=${w.bodyFull}`);
await shot(page, "1440-split-baseline");

// 2. Collapse/expand right; left must not move.
await page.getByRole("button", { name: "Collapse right panel" }).click();
await page.waitForTimeout(500);
w = await widths(page);
console.log("RIGHT COLLAPSED", JSON.stringify(w));
check("right collapse does not change left width", Math.abs(w.left.w - left300) <= 2, `left=${w.left.w}`);
check("right is collapsed to the rail", w.right.w === 40, `right=${w.right.w}`);
await page.getByRole("button", { name: "Show right panel" }).click();
await page.waitForTimeout(700);
w = await widths(page);
console.log("RIGHT EXPANDED", JSON.stringify(w));
check("right expand restores ~420 and leaves left alone", Math.abs(w.right.w - right420) <= 8 && Math.abs(w.left.w - left300) <= 2, `right=${w.right.w} left=${w.left.w}`);
await shot(page, "1440-right-collapsed");

// Collapse/expand left; right must not move.
await page.getByRole("button", { name: "Hide conversation list" }).click();
await page.waitForTimeout(500);
w = await widths(page);
console.log("LEFT COLLAPSED", JSON.stringify(w));
check("left collapse does not change right width", Math.abs(w.right.w - right420) <= 2, `right=${w.right.w}`);
check("left is collapsed", w.left.w === 0, `left=${w.left.w}`);
await shot(page, "1440-left-collapsed");
await page.getByRole("button", { name: "Show conversation list" }).click();
await page.waitForTimeout(700);
w = await widths(page);
console.log("LEFT EXPANDED", JSON.stringify(w));
check("left expand restores ~300 and leaves right alone", Math.abs(w.left.w - left300) <= 6 && Math.abs(w.right.w - right420) <= 2, `left=${w.left.w} right=${w.right.w}`);

// 3. Workspace round trip.
await page.locator('header a[href="/workspace/assistant"]').click();
await page.waitForTimeout(800);
w = await widths(page);
console.log("AT WORKSPACE", JSON.stringify(w));
check("workspace hides the project panes", w.right.display === "none" && w.bodyFull, JSON.stringify({ right: w.right, bodyFull: w.bodyFull }));
await page.goBack();
await page.waitForTimeout(1000);
w = await widths(page);
console.log("BACK FROM WORKSPACE", JSON.stringify(w));
check("left width restored after workspace trip", Math.abs(w.left.w - left300) <= 2, `left=${w.left.w}`);
check("right width restored after workspace trip", Math.abs(w.right.w - right420) <= 2, `right=${w.right.w}`);

// Reload on workspace, then go back to the conversation.
await page.locator('header a[href="/workspace/assistant"]').click();
await page.waitForTimeout(700);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("main");
await page.waitForTimeout(700);
w = await widths(page);
console.log("WORKSPACE RELOADED", JSON.stringify(w));
check("workspace reload stays full width", w.bodyFull && w.right.display === "none", JSON.stringify({ bodyFull: w.bodyFull, right: w.right }));
await page.goBack();
await page.waitForTimeout(1100);
w = await widths(page);
console.log("BACK AFTER WORKSPACE RELOAD", JSON.stringify(w));
check("left width restored after workspace reload", Math.abs(w.left.w - left300) <= 2, `left=${w.left.w}`);
check("right width restored after workspace reload", Math.abs(w.right.w - right420) <= 2, `right=${w.right.w}`);
check("layout storage survived the workspace trip", !!w.storage["ade-conversations-layout"] && !!w.storage["ade-shell-layout-v2"], JSON.stringify(w.storage));

// 4. Files split.
await go(page, `/p/${project.id}/files`);
w = await widths(page);
console.log("FILES INITIAL", JSON.stringify(w));
const filesInitial = w.filesExplorer.w;
const rightBeforeFilesDrag = w.right.w;
await drag(page, '[data-testid="seam-files-explorer"]', 60);
w = await widths(page);
console.log("FILES AFTER DRAG", JSON.stringify(w));
const filesAfter = w.filesExplorer.w;
check("files explorer width changes independently", filesAfter > filesInitial + 30, `before=${filesInitial} after=${filesAfter}`);
check("files drag leaves the shell right pane alone", Math.abs(w.right.w - rightBeforeFilesDrag) <= 2, `right=${w.right.w} vs ${rightBeforeFilesDrag}`);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => !!document.querySelector('[data-testid="files-main"]'),
  null,
  { timeout: 15000 },
);
await page.waitForTimeout(900);
w = await widths(page);
console.log("FILES AFTER RELOAD", JSON.stringify(w));
check("files explorer width persists after reload", Math.abs(w.filesExplorer.w - filesAfter) <= 3, `explorer=${w.filesExplorer.w} vs ${filesAfter}`);
await shot(page, "1440-files-split");

// Files survives a workspace round trip without losing either width.
await page.locator('header a[href="/workspace/assistant"]').click();
await page.waitForTimeout(800);
await page.goBack();
await page.waitForFunction(
  () => !!document.querySelector('[data-testid="files-main"]'),
  null,
  { timeout: 15000 },
);
await page.waitForTimeout(1000);
w = await widths(page);
console.log("FILES BACK FROM WORKSPACE", JSON.stringify(w));
check("files explorer width restored after workspace", Math.abs(w.filesExplorer.w - filesAfter) <= 3, `explorer=${w.filesExplorer.w} vs ${filesAfter}`);
check("files shell right pane restored after workspace", Math.abs(w.right.w - rightBeforeFilesDrag) <= 2, `right=${w.right.w} vs ${rightBeforeFilesDrag}`);
check("files route has no full-width class", !w.bodyFull, `bodyFull=${w.bodyFull}`);

// 5. Mobile one-pane and left toggle.
await ctx.close();
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const m = await mobile.newPage();
const mobileIssues = [];
m.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") mobileIssues.push(`${msg.type()}: ${msg.text().slice(0, 200)}`);
});
m.on("pageerror", (e) => mobileIssues.push(`pageerror: ${e.message}`));
await go(m, convo);
let mw = await widths(m);
console.log("MOBILE INITIAL", JSON.stringify(mw));
check("mobile conversation list is auto-collapsed", mw.left.w === 0, `left=${mw.left.w}`);
check("mobile page has no horizontal overflow", mw.scrollW === mw.viewportW, `scroll=${mw.scrollW} viewport=${mw.viewportW}`);
await shot(m, "390-split-mobile-collapsed");
const toggle = m.getByRole("button", { name: "Show conversation list" });
const hasToggle = (await toggle.count()) > 0;
check("mobile list toggle exists", hasToggle, `count=${await toggle.count()}`);
if (hasToggle) {
  await toggle.first().click();
  await m.waitForTimeout(500);
  mw = await widths(m);
  console.log("MOBILE LIST EXPANDED", JSON.stringify(mw));
  check("mobile list toggle expands the list", mw.left.w > 200, `left=${mw.left.w}`);
  check("mobile expanded list hides the conversation pane", mw.convMain.w === 0, `convMain=${mw.convMain.w}`);
  check("mobile page still has no horizontal overflow", mw.scrollW === mw.viewportW, `scroll=${mw.scrollW}`);
  await shot(m, "390-split-mobile-expanded");
  await m.getByRole("button", { name: "Hide conversation list" }).first().click();
  await m.waitForTimeout(400);
  mw = await widths(m);
  check("mobile list toggle collapses again", mw.left.w === 0, `left=${mw.left.w}`);
}
await mobile.close();

const ignorable = (line) => /404 \(Not Found\).*(\.woff2|favicon)/.test(line);
const noisy = [...issues, ...mobileIssues].filter((line) => !ignorable(line));
check("no page errors or hydration warnings", noisy.length === 0, noisy.slice(0, 5).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED CHECKS:");
  for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
  process.exitCode = 1;
}
