#!/usr/bin/env node
/* Customize ADE still renderer: drives the REAL app (built, served by bin/ade.mjs)
 * with a scripted fake `codex`, so every change state comes from real checks.
 *
 *   node cook/tools/stills.mjs --round 02 [--fresh] [--no-build] [--only S01,S02]
 *
 * Harness HOME  /var/tmp/ade-cook-home   (persistent; never the real ~)
 * Shims         /var/tmp/ade-cook-bin    (codex -> cook/tools/fake-agent.mjs)
 * Snapshot      /var/tmp/ade-cook-home/.cook-snapshot  (taken after setup; each scenario
 *               restores it, so the first run does setup (minutes) and later runs skip it)
 * --fresh       delete the harness HOME and redo setup.
 * Output        cook/stills/rNN/*.png and cook/compare/rNN/all.jpg
 */
import { chromium } from "playwright-core";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOME = "/var/tmp/ade-cook-home";
const EMPTY_HOME = "/var/tmp/ade-cook-home-empty";
const BIN = "/var/tmp/ade-cook-bin";
const SNAP = path.join(HOME, ".cook-snapshot");
const SCENARIO = path.join(HOME, ".cook-scenario");
const PORT = 3210;
const EMPTY_PORT = 3211;
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => argv[argv.indexOf(`--${name}`) + 1];
const round = opt("round");
if (!/^\d\d$/.test(round ?? ""))
  throw new Error("usage: stills.mjs --round NN [--fresh] [--no-build] [--only S01,S02]");
const only = flag("only") ? new Set(opt("only").split(",")) : null;
const want = (id) => !only || only.has(id);
const outDir = path.join(ROOT, "cook/stills", `r${round}`);
const cmpDir = path.join(ROOT, "cook/compare", `r${round}`);
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(cmpDir, { recursive: true });
const notes = [];
const note = (text) => (console.log(`NOTE ${text}`), notes.push(text));
const log = (text) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${text}`);
const t0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { stdio: "inherit", ...opts });

// ---- processes in the harness (only ones this run started are ever stopped) ----
function harnessProcesses() {
  const found = new Map();
  for (const name of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    try {
      const cwd = fs.readlinkSync(`/proc/${name}/cwd`);
      const cmd = fs.readFileSync(`/proc/${name}/cmdline`, "utf8").split("\0").join(" ").trim();
      if (cwd.startsWith(HOME) || cmd.includes(HOME))
        found.set(Number(name), `${cmd.slice(0, 160)} (cwd ${cwd})`);
    } catch {}
  }
  return found;
}
const before = harnessProcesses();

// ---- fake agent + seeding -------------------------------------------------
function installShims() {
  fs.mkdirSync(BIN, { recursive: true });
  const shim = path.join(BIN, "codex");
  fs.writeFileSync(
    shim,
    `#!/bin/sh\nexport COOK_SCENARIO_FILE="${SCENARIO}"\nexec "${process.execPath}" "${ROOT}/cook/tools/fake-agent.mjs" codex "$@"\n`,
    { mode: 0o755 },
  );
}
function seedHome(home) {
  fs.mkdirSync(path.join(home, ".ade"), { recursive: true, mode: 0o700 });
  const status = path.join(home, ".ade/agents-status.json");
  if (fs.existsSync(status)) return;
  const row = {
    id: "codex",
    name: "OpenAI Codex",
    short: "Codex",
    tools: "Codex tools",
    authMethod: "x",
    authNote: "x",
    installHint: "x",
    installed: true,
    version: "0.158.0",
    signedIn: true,
    carriesConversation: true,
    installMethod: "npm",
    harness: { install: "x", update: "x" },
  };
  fs.writeFileSync(status, JSON.stringify({ fetchedAt: Date.now(), agents: [row] }));
}

// ---- server ---------------------------------------------------------------
function startServer(home, port, extraEnv = {}) {
  seedHome(home);
  const child = spawn(process.execPath, ["bin/ade.mjs", "--port", String(port)], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      PATH: `${BIN}:${process.env.PATH}`,
      COOK_SCENARIO_FILE: SCENARIO,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logFile = fs.createWriteStream(path.join(outDir, `server-${port}.log`), { flags: "a" });
  child.stdout.on("data", (d) => logFile.write(d));
  child.stderr.on("data", (d) => (logFile.write(d), process.stderr.write(`[ade:${port}] ${d}`)));
  child.on("exit", (code, signal) => {
    logFile.write(`\n[exit ${code} ${signal}]\n`);
    console.log(`[ade:${port}] exited code=${code} signal=${signal}`);
  });
  return child;
}
async function waitUp(port, child) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`ADE on ${port} exited`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/bootstrap`)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`ADE on ${port} did not come up`);
}
async function stop(child) {
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  if (!child || exited()) return;
  child.kill("SIGTERM");
  for (let i = 0; i < 40 && !exited(); i++) await sleep(250);
  if (!exited()) child.kill("SIGKILL");
  // The server can launch helpers in the fixture home which exit just after it.
  // Give those helpers time to finish; never signal a process merely by name.
  for (let i = 0; i < 40 && [...harnessProcesses().keys()].some((pid) => !before.has(pid)); i++)
    await sleep(250);
}
const api = async (p, init) => {
  const res = await fetch(`http://127.0.0.1:${PORT}${p}`, {
    ...init,
    headers: { "content-type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${p} -> ${res.status} ${JSON.stringify(body)}`);
  return body;
};
const state = () => api("/api/customize");
async function until(label, pick, timeout = 15 * 60_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await state();
    const hit = pick(last);
    if (hit) return hit;
    await sleep(2000);
  }
  throw new Error(
    `timed out waiting for ${label}; last: ${JSON.stringify(last?.changes?.[0]?.status ?? last?.setup)}`,
  );
}

// ---- snapshot (restore = stop server, reset git + state files) --------------
const source = path.join(HOME, ".ade/self/source");
const git = (...a) =>
  spawnSync("git", ["-c", "user.name=cook", "-c", "user.email=cook@localhost", ...a], {
    cwd: source,
    encoding: "utf8",
  });
const sourceRevision = () =>
  spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
function takeSnapshot() {
  fs.rmSync(SNAP, { recursive: true, force: true });
  fs.mkdirSync(SNAP, { recursive: true });
  for (const f of ["self/state.json", "workspace.json"]) {
    const from = path.join(HOME, ".ade", f);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(SNAP, f.replace("/", "_")));
  }
  fs.writeFileSync(path.join(SNAP, "mine"), git("rev-parse", "mine").stdout.trim());
  fs.writeFileSync(path.join(SNAP, "source-revision"), sourceRevision());
}
function restoreSnapshot() {
  const mine = fs.readFileSync(path.join(SNAP, "mine"), "utf8").trim();
  git("checkout", "-f", "mine");
  git("reset", "--hard", mine);
  git("clean", "-fd");
  for (const b of git("for-each-ref", "--format=%(refname:short)", "refs/heads/change/")
    .stdout.split("\n")
    .filter(Boolean))
    git("branch", "-D", b);
  // An ADE update (S05) leaves a working folder (a git worktree) and two branches behind.
  git("worktree", "remove", "--force", path.join(HOME, ".ade/self/update/work"));
  fs.rmSync(path.join(HOME, ".ade/self/update"), { recursive: true, force: true });
  git("worktree", "prune");
  for (const b of ["update-work", "update-import"]) git("branch", "-D", b);
  fs.copyFileSync(path.join(SNAP, "self_state.json"), path.join(HOME, ".ade/self/state.json"));
  // A kept change leaves the launcher pointing at its build; the next start would run that
  // build (no source, so "not available"). The snapshot predates any kept version.
  fs.rmSync(path.join(HOME, ".ade/self/current.json"), { force: true });
  fs.rmSync(path.join(HOME, ".ade/self/builds"), { recursive: true, force: true });
  fs.copyFileSync(path.join(SNAP, "workspace.json"), path.join(HOME, ".ade/workspace.json"));
}

// ---- browser ---------------------------------------------------------------
const chromePath = [
  "chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell",
  "chromium-1254/chrome-linux64/chrome",
]
  .map((p) => path.join(os.homedir(), ".cache/ms-playwright", p))
  .find((p) => fs.existsSync(p));
let browser = await chromium.launch({ executablePath: chromePath });
const problems = [];
async function shot(id, name, { port = PORT, route, theme = "dark", phone = false, act }) {
  if (!want(id)) return;
  if (!browser.isConnected()) browser = await chromium.launch({ executablePath: chromePath });
  const ctx = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: phone ? 2 : 1,
  });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("ade-theme", t);
    } catch {}
  }, theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`${name}: pageerror ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  try {
    await act?.(page);
  } catch (e) {
    note(`${name}: ${e.message.split("\n")[0]}`);
  }
  await page.waitForTimeout(500);
  const file = `${name}.png`;
  await page.screenshot({ path: path.join(outDir, file) });
  log(`shot ${file}`);
  await ctx.close();
}
const click = async (page, role, name) => {
  const el = page.getByRole(role, { name }).first();
  if (await el.count()) {
    await el.click();
    return true;
  }
  return false;
};
const openTab = (name) => async (page) => {
  if (!(await click(page, "tab", name))) note(`no "${name}" tab on the page`);
};

// ---- S05: a newer ADE that the kept change no longer fits --------------------
const STOCK_NEXT = "/var/tmp/ade-cook-stock-next";
function stageNextStock() {
  fs.rmSync(STOCK_NEXT, { recursive: true, force: true });
  fs.mkdirSync(STOCK_NEXT, { recursive: true });
  const tar = path.join(STOCK_NEXT, "..", "ade-cook-stock-next.tar");
  const archived = git("archive", "--format=tar", "-o", tar, "stock");
  if (archived.status) throw new Error(`git archive stock: ${archived.stderr}`);
  const unpacked = spawnSync("tar", ["-xf", tar, "-C", STOCK_NEXT], { encoding: "utf8" });
  fs.rmSync(tar, { force: true });
  if (unpacked.status) throw new Error(`tar: ${unpacked.stderr}`);
  const bump = (file, edit) => {
    const target = path.join(STOCK_NEXT, file);
    if (!fs.existsSync(target)) return;
    const json = JSON.parse(fs.readFileSync(target, "utf8"));
    edit(json);
    fs.writeFileSync(target, `${JSON.stringify(json, null, 2)}\n`);
  };
  bump("package.json", (j) => (j.version = "0.1.16"));
  bump("package-lock.json", (j) => {
    j.version = "0.1.16";
    if (j.packages?.[""]) j.packages[""].version = "0.1.16";
  });
  // ADE 0.1.16 ships its own copyLog.mjs: the kept change adds the same file, so it conflicts.
  const file = path.join(STOCK_NEXT, "src/lib/ade/copyLog.mjs");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `// ADE 0.1.16: logs are copied through the session API in pages.
export async function copyWholeLog(session, write, { pageSize = 500 } = {}) {
  const lines = [];
  for (let page = 0; ; page++) {
    const chunk = await session.logPage(page, pageSize);
    lines.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  await write(lines.join("\\n"));
  return lines.length;
}
`,
  );
}
async function updateNeedsYou() {
  await stop(server);
  stageNextStock();
  // The kept build would start instead of this checkout; run this checkout's ADE.
  fs.rmSync(path.join(HOME, ".ade/self/current.json"), { force: true });
  fs.writeFileSync(SCENARIO, "reapply-fails\n");
  server = startServer(HOME, PORT, { ADE_SELF_STOCK_SOURCE: STOCK_NEXT });
  await waitUp(PORT, server);
  let s = await state();
  if (!s.update) {
    const check = await api("/api/customize/update/check", { method: "POST" }).catch((e) => ({
      error: e.message,
    }));
    log(`update check: ${JSON.stringify(check).slice(0, 200)}`);
    s = await state();
  }
  if (!s.update)
    return note(
      `S05: no update started (backend hook missing or refused); last update=${JSON.stringify(s.update)}`,
    );
  log(`update ${s.update.from} -> ${s.update.to}: ${s.update.status}`);
  await shot("S05", "S05b-update-applying-dark", { route: "/workspace/customize" });
  const u = await until(
    "update needs you",
    (x) => (x.update && x.update.status !== "applying" ? x.update : null),
    25 * 60_000,
  );
  log(`update ended ${u.status}: ${JSON.stringify(u.changes)}`);
  if (u.status !== "needs-you") note(`S05: the update ended ${u.status}, not needs-you`);
  await shot("S05", "S05-update-needs-you-dark", { route: "/workspace/customize" });
  await shot("S05", "S05-update-needs-you-light", {
    route: "/workspace/customize",
    theme: "light",
  });
  await shot("S05", "S05c-phone-update-dark", { route: "/workspace/customize", phone: true });
  // Leave nothing running: staying stops the update's agent and removes its working folder.
  await api("/api/customize/update/stay", { method: "POST" }).catch((e) =>
    note(`S05: stay failed: ${e.message}`),
  );
}

// ---- run -------------------------------------------------------------------
let server;
let empty;
try {
  if (!flag("fresh") && fs.existsSync(path.join(SNAP, "mine"))) {
    const revisionFile = path.join(SNAP, "source-revision");
    const savedRevision = fs.existsSync(revisionFile)
      ? fs.readFileSync(revisionFile, "utf8").trim()
      : "";
    if (savedRevision !== sourceRevision())
      throw new Error("Cook fixture is out of date; rerun with --fresh");
  }
  installShims();
  if (!flag("no-build")) {
    log("npm run build");
    const r = sh("npm", ["run", "build"], { cwd: ROOT });
    if (r.status) throw new Error("build failed");
    log("built");
  }

  // S06: a home that never ran setup.
  if (want("S06")) {
    fs.rmSync(EMPTY_HOME, { recursive: true, force: true });
    empty = startServer(EMPTY_HOME, EMPTY_PORT);
    await waitUp(EMPTY_PORT, empty);
    await shot("S06", "S06-first-visit-dark", { port: EMPTY_PORT, route: "/workspace/customize" });
    await stop(empty);
    empty = null;
  }

  if (flag("fresh")) fs.rmSync(HOME, { recursive: true, force: true });
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(SCENARIO, "copy-log\n");
  server = startServer(HOME, PORT);
  await waitUp(PORT, server);
  if (!fs.existsSync(path.join(SNAP, "mine"))) {
    const s = await state();
    if (!s.available) throw new Error(`customization unavailable: ${s.unavailableReason}`);
    if (s.setup.status !== "ready") {
      log("setup (copy + npm ci)");
      await api("/api/customize/setup", { method: "POST" });
      await until(
        "setup",
        (x) =>
          x.setup.status === "failed"
            ? (() => {
                throw new Error(`setup failed: ${x.setup.error}`);
              })()
            : x.setup.status === "ready",
        45 * 60_000,
      );
      log("setup ready");
    }
    await stop(server);
    takeSnapshot();
    server = startServer(HOME, PORT);
    await waitUp(PORT, server);
  }
  const reset = async (scenario) => {
    await stop(server);
    restoreSnapshot();
    fs.writeFileSync(SCENARIO, `${scenario}\n`);
    server = startServer(HOME, PORT);
    await waitUp(PORT, server);
  };
  const start = (request) =>
    api("/api/customize/changes", { method: "POST", body: { request, agentId: "codex" } }).then(
      (r) => r.change,
    );
  const find = (id) => state().then((s) => s.changes.find((c) => c.id === id));

  // S01 + S08 start screens
  await reset("copy-log");
  await shot("S01", "S01-start-dark", { route: "/workspace/customize" });
  await shot("S01", "S01-start-light", { route: "/workspace/customize", theme: "light" });
  await shot("S08", "S08-phone-details-dark", {
    route: "/workspace/customize",
    phone: true,
    act: async (page) => {
      await page.getByRole("tab", { name: "Details" }).click();
      await page.getByRole("heading", { name: "Your copy of ADE" }).waitFor({ timeout: 5000 });
    },
  });
  await shot("S08", "S08-phone-start-dark", {
    route: "/workspace/customize",
    phone: true,
    act: async (page) => {
      await page.getByRole("tab", { name: "Details" }).click();
      await page.getByRole("heading", { name: "Your copy of ADE" }).waitFor({ timeout: 5000 });
      await page.getByRole("tab", { name: "Conversation" }).click();
      if (!(await click(page, "button", /Copy a session's full log/i)))
        note("S08: sample idea was not available");
      await page.getByLabel("Insert workflow or skill").waitFor({ timeout: 5000 });
      await page.getByLabel("Reference a project file or folder").waitFor({ timeout: 5000 });
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.move(385, 170);
    },
  });

  // copy-log: S02, S07, S08, S04 (skipped when only the failing scenario is wanted)
  if (["S02", "S04", "S05", "S07", "S08"].some(want)) {
    const c1 = await start("Add a Copy log button next to Stop that copies the whole log");
    log(`change ${c1.id} started`);
    const ready = await until("ready", (x) => {
      const c = x.changes.find((i) => i.id === c1.id);
      return c?.status === "ready"
        ? c
        : ["failed", "needs-you"].includes(c?.status)
          ? (() => {
              throw new Error(`copy-log ended ${c.status}: ${c.reason}`);
            })()
          : null;
    });
    log(`ready after ${ready.checks.map((c) => `${c.id}:${c.durationMs ?? 0}ms`).join(" ")}`);
    const route = `/workspace/customize/${c1.id}`;
    const previewTab = async (page) => {
      const preview = page.locator('[role="tablist"][aria-label="Change details"] button').first();
      await preview.waitFor({ state: "visible", timeout: 10_000 });
      await preview.click();
    };
    // The running preview: click Try it, wait for the server to report it running, then for the
    // agent browser's address bar to show it and the page to paint.
    const waitPreview = async (page) => {
      await previewTab(page);
      const address = page.getByLabel("Preview address").first();
      await address.waitFor({ timeout: 90_000 });
      // The page paints once the browser opened it; "Opening your version…" goes away.
      const opening = page.getByText("Opening your version…").first();
      for (let i = 0; i < 120 && (await opening.isVisible().catch(() => false)); i++)
        await page.waitForTimeout(500);
      log(`preview address: ${await address.textContent().catch(() => "?")}`);
      await page.waitForTimeout(5000);
    };
    const expandPreview = async (page) => {
      await waitPreview(page);
      if (!(await click(page, "button", "Expand preview")))
        return note("S02: no Expand preview button");
      await page.waitForTimeout(4000); // the page re-lays out for the bigger pane
    };
    await shot("S02", "S02d-preview-not-tried-dark", { route, act: previewTab });
    if (want("S02") || want("S07")) {
      await shot("S02", "S02-ready-preview-dark", {
        route,
        act: async (page) => {
          await previewTab(page);
          const tryIt = page
            .getByRole("tabpanel")
            .getByRole("button", { name: /^try it$/i })
            .first();
          await tryIt.click();
          const running = await until(
            "preview running",
            (x) => {
              const p = x.changes.find((i) => i.id === c1.id)?.preview;
              return p?.status === "running"
                ? p
                : p?.status === "failed"
                  ? (() => {
                      throw new Error(`preview failed: ${p.error}`);
                    })()
                  : null;
            },
            6 * 60_000,
          );
          log(`preview running at ${running.url}`);
          await waitPreview(page);
        },
      });
    }
    await shot("S02", "S02e-preview-expanded-dark", { route, act: expandPreview });
    await shot("S07", "S07-ready-preview-light", { route, theme: "light", act: waitPreview });
    await shot("S08", "S08-phone-ready-dark", { route, phone: true });
    await shot("S08", "S08-phone-preview-dark", {
      route,
      phone: true,
      act: async (page) => {
        const tryIt = page.getByRole("button", { name: /^try it$/i }).last();
        await tryIt.waitFor({ timeout: 10_000 });
        await tryIt.click();
        await until(
          "phone preview running",
          (x) => {
            const preview = x.changes.find((item) => item.id === c1.id)?.preview;
            return preview?.status === "running" ? preview : null;
          },
          6 * 60_000,
        );
        await waitPreview(page);
        await page
          .locator('button[title^="Back to the change"]')
          .first()
          .waitFor({ state: "visible", timeout: 10_000 });
        await page.waitForTimeout(6000);
        for (const name of ["Back", "Forward", "Reload", "Back to the change"]) {
          const button = page.getByRole("button", { name, exact: true }).last();
          const box = await button.boundingBox();
          if (!box || box.width < 44 || box.height < 44)
            problems.push(`S08: ${name} touch target is smaller than 44px`);
        }
        if (!(await page.getByLabel("Preview address").textContent())?.includes("127.0.0.1:"))
          problems.push("S08: the preview address is not visible");
      },
    });
    await shot("S02", "S02b-ready-checks-dark", { route, act: openTab(/checks/i) });
    await shot("S02", "S02c-ready-changes-dark", { route, act: openTab(/changes/i) });
    await api(`/api/customize/changes/${c1.id}/keep`, { method: "POST" });
    await until("kept", (x) => x.changes.find((i) => i.id === c1.id)?.status === "kept");
    // Keeping builds the kept version first ("preparing"); shoot once the Restart card is final.
    const sw = await until(
      "switch settled",
      (x) => (x.switch.status === "preparing" ? null : x.switch),
      12 * 60_000,
    );
    log(`switch after keep: ${JSON.stringify(sw)}`);
    if (!sw.launcher)
      note(
        `S04: no launcher in this run (switch ${sw.status}); the card shows the restart command instead of Restart ADE`,
      );
    await shot("S04", "S04-kept-dark", { route });
    await shot("S04", "S04-kept-light", { route, theme: "light" });
    await shot("S04", "S04b-kept-list-dark", { route: "/workspace/customize" });
    await shot("S08", "S08-phone-kept-dark", { route, phone: true });

    // S05: ADE 0.1.16 arrives with its own copyLog.mjs, the agent can't fit the kept change.
    if (want("S05")) await updateNeedsYou();
  }

  // copy-log-failing: S03
  if (want("S03")) {
    await reset("copy-log-failing");
    const c2 = await start("Add a Copy log button next to Stop that copies the whole log");
    await until("failed", (x) => {
      const c = x.changes.find((i) => i.id === c2.id);
      return c?.status === "failed"
        ? c
        : c?.status === "ready"
          ? (() => {
              throw new Error("failing scenario passed its checks");
            })()
          : null;
    });
    const failed = await find(c2.id);
    log(
      `failed after ${failed.fixAttempts} fix attempt(s): ${failed.checks.filter((c) => c.status === "failed").map((c) => c.id)}`,
    );
    await shot("S03", "S03-check-fails-dark", {
      route: `/workspace/customize/${c2.id}`,
      act: openTab(/checks/i),
    });
    await shot("S03", "S03-check-fails-light", {
      route: `/workspace/customize/${c2.id}`,
      theme: "light",
      act: openTab(/checks/i),
    });
    await shot("S03", "S08-phone-failed-dark", {
      route: `/workspace/customize/${c2.id}`,
      phone: true,
    });
  }

  // no-change: needs-you
  if (want("S09")) {
    await reset("no-change");
    const c3 = await start("Make the sidebar remember its width");
    await until("needs-you", (x) => x.changes.find((i) => i.id === c3.id)?.status === "needs-you");
    await shot("S09", "S09-needs-you-dark", { route: `/workspace/customize/${c3.id}` });
  }

  await reset("copy-log"); // leave the harness clean
} finally {
  await browser?.close().catch(() => {});
  await stop(server);
  await stop(empty);
}

// ---- compare ---------------------------------------------------------------
const pairs = [
  ["W01-start-dark", "S01-start-dark"],
  ["W02-ready-preview-dark", "S02-ready-preview-dark"],
  ["W03-check-fails-dark", "S03-check-fails-dark"],
  ["W04-kept-changes-dark", "S04-kept-dark"],
  ["W05-update-needs-you-dark", "S05-update-needs-you-dark"],
  ["W02-ready-preview-dark", "S02d-preview-not-tried-dark"],
  ["W06-first-visit-dark", "S06-first-visit-dark"],
  ["W07-ready-preview-light", "S07-ready-preview-light"],
  ["W08-phone-dark", "S08-phone-ready-dark"],
  ["W08-phone-dark", "S08-phone-start-dark"],
].filter(([, s]) => fs.existsSync(path.join(outDir, `${s}.png`)));
if (pairs.length) {
  const r = sh("node", [
    path.join(ROOT, "cook/skill/scripts/side-by-side.mjs"),
    "--out",
    path.join(cmpDir, "all.jpg"),
    ...pairs.flatMap(([w, s]) => [
      path.join(ROOT, "cook/refs", `${w}.png`),
      path.join(outDir, `${s}.png`),
    ]),
  ]);
  if (r.status) note("side-by-side failed");
}
// Anything still running in the harness that was not there before this run started.
await sleep(2000);
const left = [...harnessProcesses()].filter(([pid]) => !before.has(pid));
for (const [pid, what] of left) console.log(`LEFT pid ${pid}: ${what}`);
if (!left.length) log("no harness processes left from this run");
log(`done. stills: ${fs.readdirSync(outDir).length}, problems: ${problems.length}`);
for (const p of problems) console.log(`PROBLEM ${p}`);
