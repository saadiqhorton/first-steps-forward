import { chromium } from "/home/dezignerdrugz/Work/first-steps-forward/node_modules/playwright-core/index.mjs";

process.env.TMPDIR = "/home/dezignerdrugz/tmp";
process.env.TMP = process.env.TMPDIR;
process.env.TEMP = process.env.TMPDIR;
const BASE = "http://127.0.0.1:4321";
const OUT = "/home/dezignerdrugz/Work/first-steps-forward/artifacts/shell-regression";
const boot = await (await fetch(`${BASE}/api/bootstrap`)).json();
const project = boot.projects[0];
const other = boot.projects[1];
const sessionId = "session-shell-fixture";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true });

async function snapshot(page, tag, viewport) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.screenshot({ path: `${OUT}/${viewport.width}-${tag}.png`, timeout: 20000 });
      return;
    } catch (error) {
      if (attempt === 2) console.log(`screenshot ${tag} failed: ${error.message}`);
      await page.waitForTimeout(400);
    }
  }
}

async function pane(page) {
  return page.evaluate(() => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        display: cs.display,
      };
    };
    const right = document.querySelector('[data-testid="shell-right"]');
    return {
      bodyClass: document.body.classList.contains("shell-full-width"),
      url: location.pathname,
      right: rect(right),
      seam: rect(document.querySelector('[data-testid="seam-shell-right"]')),
      mainPanel: rect(document.querySelector('[data-testid="shell-main"]')),
      main: rect(document.querySelector("main")),
      viewportW: innerWidth,
      scrollW: document.documentElement.scrollWidth,
      tabsHidden: !document.querySelector('nav[aria-label="Project sections"]'),
      rail: !!document.querySelector('button[aria-label="Show right panel"]'),
      terminalPanel: rect(document.querySelector("#right-terminal-panel")),
      terminalTab: document.querySelector("#right-terminal-tab")?.getAttribute("aria-selected"),
      computerPanel: rect(document.querySelector("#right-computer-panel")),
      activityPanel: rect(document.querySelector("#right-session-panel")),
    };
  });
}

async function go(page, path) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: 15000 });
  await page.waitForTimeout(500);
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleIssues = [];
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning")
    consoleIssues.push(`${msg.type()}: ${msg.text().slice(0, 220)}`);
});
page.on("pageerror", (err) => consoleIssues.push(`pageerror: ${err.message}`));

// ---------- Direct deep loads: full-width pages ----------
for (const [slug, path] of [
  ["root", "/"],
  ["workflows", `/p/${project.id}/workflows`],
  ["skills", `/p/${project.id}/skills`],
  ["processes", `/p/${project.id}/processes`],
  ["workspace", "/workspace"],
  ["inbox", "/workspace/inbox"],
  ["assistant", "/workspace/assistant"],
  ["settings", "/workspace/settings"],
]) {
  await go(page, path);
  const p = await pane(page);
  check(
    `desktop direct ${slug} takes the full window`,
    p.right?.display === "none" &&
      p.mainPanel?.w === 1440 &&
      p.main?.w === 1440 &&
      p.bodyClass,
    JSON.stringify(p),
  );
  await snapshot(page, `direct-${slug}`, { width: 1440, height: 900 });
}

// ---------- Empty workspace shell ----------
for (const path of ["/agents"]) {
  await go(page, path);
  const p = await pane(page);
  check(
    `desktop ${path} keeps the project split`,
    p.right?.display !== "none" && p.mainPanel?.w === 806 && p.scrollW === p.viewportW,
    JSON.stringify(p),
  );
  await snapshot(page, path === "/" ? "direct-root" : "direct-agents", { width: 1440, height: 900 });
}

// ---------- Conversation direct load ----------
await go(page, `/p/${project.id}/conversations`);
let p = await pane(page);
check(
  "desktop conversations keeps the right pane",
  p.right?.display === "flex" && p.mainPanel?.w === 806 && !p.bodyClass,
  JSON.stringify(p),
);
check("desktop section tabs on conversations", !p.tabsHidden);
await snapshot(page, "direct-conversations", { width: 1440, height: 900 });

await go(page, `/p/${project.id}/conversations/${sessionId}`);
p = await pane(page);
const convoText = await page.locator("body").innerText();
check(
  "conversation detail loads with its messages",
  p.right?.display === "flex" && /Verify the shell layout/.test(convoText),
  convoText.slice(0, 80),
);
await snapshot(page, "direct-conversation-detail", { width: 1440, height: 900 });

// ---------- Client-side navigation: conversations -> full width -> back ----------
await go(page, `/p/${project.id}/conversations`);
await page.locator('nav[aria-label="Project sections"] a', { hasText: "Workflows" }).click();
await page.waitForTimeout(900);
p = await pane(page);
check(
  "client nav conversations -> workflows hides pane",
  p.url.endsWith("/workflows") && p.right?.display === "none" && p.mainPanel?.w === 1440 && p.bodyClass,
  JSON.stringify(p),
);
await page.locator('nav[aria-label="Project sections"] a', { hasText: "Skills" }).click();
await page.waitForTimeout(700);
p = await pane(page);
check("client nav workflows -> skills stays full width", p.right?.display === "none" && p.mainPanel?.w === 1440, JSON.stringify(p));
await page.locator('nav[aria-label="Project sections"] a', { hasText: "Processes" }).click();
await page.waitForTimeout(700);
p = await pane(page);
check("client nav skills -> processes stays full width", p.right?.display === "none" && p.mainPanel?.w === 1440, JSON.stringify(p));

await page.locator('nav[aria-label="Project sections"] a', { hasText: "Conversations" }).click();
await page.waitForTimeout(900);
p = await pane(page);
check(
  "client nav processes -> conversations restores the pane",
  p.url.endsWith("/conversations") &&
    p.right?.display === "flex" &&
    p.mainPanel?.w === 806 &&
    !p.bodyClass,
  JSON.stringify(p),
);
await snapshot(page, "client-back-conversations", { width: 1440, height: 900 });

// ---------- Right pane collapse / expand, rail, tabs ----------
await page.getByRole("button", { name: "Collapse right panel" }).click();
await page.waitForTimeout(500);
p = await pane(page);
check(
  "collapse right pane leaves the rail",
  p.right?.w === 40 && p.rail,
  JSON.stringify(p),
);
await page.getByRole("button", { name: "Show right panel" }).click();
await page.waitForTimeout(500);
p = await pane(page);
check("rail expands the pane again", p.right?.w > 500 && !p.rail, JSON.stringify(p));

// A deliberate collapse must survive a trip through a full-window page.
await page.getByRole("button", { name: "Collapse right panel" }).click();
await page.waitForTimeout(400);
await page.locator('header a[aria-label="ADE home"]').click();
await page.waitForTimeout(800);
await page.locator(`header a[href="/p/${project.id}/conversations"]`).click();
await page.waitForTimeout(1000);
p = await pane(page);
check(
  "a deliberate collapse survives a workspace round trip",
  p.right?.w === 40 && p.rail,
  JSON.stringify(p),
);
await page.getByRole("button", { name: "Show right panel" }).click();
await page.waitForTimeout(600);

for (const tab of ["Activity", "Diff", "Browser", "Processes"]) {
  await page.getByRole("tab", { name: tab, exact: true }).click();
  await page.waitForTimeout(450);
  const selected = await page.evaluate(() => {
    const t = document.querySelector('[role="tab"][aria-selected="true"]');
    return t?.textContent?.trim() ?? null;
  });
  check(`right pane tab ${tab} selects`, selected === tab, String(selected));
}

// Terminal opens, survives full-width navigation, and is still there on return.
await page.getByRole("tab", { name: "Terminal", exact: true }).click();
await page.waitForTimeout(1200);
p = await pane(page);
check("terminal tab opens a live panel", p.terminalTab === "true" && p.terminalPanel?.h > 100, JSON.stringify(p));
const terminalNodesBefore = await page.locator("#right-terminal-panel .xterm").count();
await snapshot(page, "terminal-open", { width: 1440, height: 900 });

await page.locator('nav[aria-label="Project sections"] a', { hasText: "Workflows" }).click();
await page.waitForTimeout(700);
p = await pane(page);
check("terminal survives navigation into full-width workflows", p.right?.display === "none", JSON.stringify(p));
await page.locator('nav[aria-label="Project sections"] a', { hasText: "Conversations" }).click();
await page.waitForTimeout(900);
p = await pane(page);
const terminalNodesAfter = await page.locator("#right-terminal-panel .xterm").count();
check(
  "terminal survives returning to the project",
  p.terminalTab === "true" && terminalNodesAfter > 0 && terminalNodesAfter >= terminalNodesBefore,
  `before=${terminalNodesBefore} after=${terminalNodesAfter} pane=${JSON.stringify(p)}`,
);
await snapshot(page, "terminal-survived", { width: 1440, height: 900 });

// Browser pane survives the same round trip.
await page.getByRole("tab", { name: "Browser", exact: true }).click();
await page.waitForTimeout(600);
await page.locator('nav[aria-label="Project sections"] a', { hasText: "Skills" }).click();
await page.waitForTimeout(700);
await page.locator('nav[aria-label="Project sections"] a', { hasText: "Conversations" }).click();
await page.waitForTimeout(900);
p = await pane(page);
check("browser pane survives the full-width round trip", p.computerPanel?.h > 100, JSON.stringify(p));

// ---------- Global shortcuts and return path ----------
await go(page, `/p/${project.id}/conversations`);
await page.keyboard.press("Control+j");
await page.waitForTimeout(800);
check("Ctrl+J opens Luna from a project", (await pane(page)).url === "/workspace/assistant", (await pane(page)).url);
await snapshot(page, "assistant-from-project", { width: 1440, height: 900 });
await page.keyboard.press("Escape");
await page.waitForTimeout(900);
p = await pane(page);
check("Escape returns to the project page", p.url === `/p/${project.id}/conversations`, p.url);

await go(page, `/p/${project.id}/workflows`);
await page.keyboard.press("Control+j");
await page.waitForTimeout(800);
await page.keyboard.press("Escape");
await page.waitForTimeout(900);
p = await pane(page);
check(
  "Escape returns to a deep-loaded full-width page (stale-path regression)",
  p.url === `/p/${project.id}/workflows` && p.right?.display === "none" && p.bodyClass,
  JSON.stringify(p),
);

// ---------- Workspace links and top bar ----------
await go(page, "/");
const lunaDot = await page.evaluate(() => {
  const dot = document.querySelector(".topbar-assistant-dot");
  return dot ? { cls: dot.className, label: dot.getAttribute("aria-label") } : null;
});
check("global Luna dot shows working/unread state", !!lunaDot, JSON.stringify(lunaDot));

const chips = await page.evaluate(() =>
  [...document.querySelectorAll('header a[href^="/p/"]')].map((a) => {
    const badge = a.querySelector("span");
    const cs = badge ? getComputedStyle(badge) : null;
    return {
      name: a.textContent?.trim(),
      color: badge?.style.color || cs?.color,
      bg: badge?.style.background || cs?.backgroundColor,
      current: a.getAttribute("aria-current"),
    };
  }),
);
check(
  "project chips render custom color/icon and fallback",
  chips.length === 2 && !!chips[0].bg && !!chips[1].bg,
  JSON.stringify(chips),
);

await page.locator('header a[href="/workspace/inbox"]').click();
await page.waitForTimeout(700);
check("Inbox link navigates", (await pane(page)).url === "/workspace/inbox");
await page.locator('header a[href="/workspace/assistant"]').click();
await page.waitForTimeout(700);
check("Luna link navigates", (await pane(page)).url === "/workspace/assistant");
await page.locator('header a[aria-label="ADE home"]').click();
await page.waitForTimeout(700);
check("ADE home lands on the workspace", (await pane(page)).url === "/workspace", (await pane(page)).url);

// Project chip from workspace restores the split.
await page.locator(`header a[href="/p/${other.id}/conversations"]`).click();
await page.waitForTimeout(900);
p = await pane(page);
check(
  "project chip from workspace enters the split project shell",
  p.url === `/p/${other.id}/conversations` &&
    p.right?.display === "flex" &&
    p.right?.w > 500 &&
    !p.bodyClass,
  JSON.stringify(p),
);

// ---------- First paint timing ----------
await context.close();

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const m = await mobile.newPage();
const mobileIssues = [];
m.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning")
    mobileIssues.push(`${msg.type()}: ${msg.text().slice(0, 220)}`);
});
m.on("pageerror", (err) => mobileIssues.push(`pageerror: ${err.message}`));

for (const [slug, path] of [
  ["root", "/"],
  ["agents", "/agents"],
  ["conversations", `/p/${project.id}/conversations`],
  ["workflows", `/p/${project.id}/workflows`],
  ["skills", `/p/${project.id}/skills`],
  ["processes", `/p/${project.id}/processes`],
  ["workspace", "/workspace"],
  ["inbox", "/workspace/inbox"],
  ["assistant", "/workspace/assistant"],
  ["settings", "/workspace/settings"],
]) {
  await go(m, path);
  const mp = await pane(m);
  const fullWidth = ["workflows", "skills", "processes", "root", "workspace", "inbox", "assistant", "settings"].includes(slug);
  if (fullWidth) {
    check(
      `mobile ${slug} is one full-width pane`,
      mp.right?.display === "none" && mp.mainPanel?.w === 390 && mp.scrollW === 390,
      JSON.stringify(mp),
    );
  } else {
    check(
      `mobile ${slug} stacks the pane below with no overflow`,
      mp.right?.display === "flex" &&
        mp.right?.y > 500 &&
        mp.right?.w === 390 &&
        mp.mainPanel?.w === 390 &&
        mp.scrollW === 390,
      JSON.stringify(mp),
    );
  }
  await snapshot(m, `mobile-${slug}`, { width: 390, height: 844 });
}

// Mobile shortcut round-trip from a deep full-width load.
await go(m, `/p/${project.id}/workflows`);
await m.keyboard.press("Control+j");
await m.waitForTimeout(800);
await m.keyboard.press("Escape");
await m.waitForTimeout(900);
let mp = await pane(m);
check(
  "mobile Escape returns to the deep-loaded workflows page",
  mp.url === `/p/${project.id}/workflows` && mp.right?.display === "none",
  JSON.stringify(mp),
);
await mobile.close();

// ---------- Console hygiene ----------
const ignorable = (line) => /402|404 \(Not Found\).*(\.woff2|favicon)/.test(line);
const noisy = [...consoleIssues, ...mobileIssues].filter((line) => !ignorable(line));
check("no hydration warnings or page errors", noisy.length === 0, noisy.slice(0, 6).join(" | "));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED CHECKS:");
  for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
  process.exitCode = 1;
}
