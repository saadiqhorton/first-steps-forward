import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
const port = Number(process.env.COOK_PORT || 6198);
const round = process.env.COOK_ROUND || 'r01';
const outDir = process.env.COOK_STILLS || `cook/stills/${round}`;
if (!/^r\d+$/.test(round)) throw new Error('COOK_ROUND must look like r01');
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'cook-archive/2026-11-15-agent-selector/harness/vite.config.mjs', '--port', String(port)], { stdio: 'inherit' });
const url = `http://127.0.0.1:${port}/cook-archive/2026-11-15-agent-selector/harness/index.html`;
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(url)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Vite did not start');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    await mkdir(outDir, { recursive: true });
    for (const shot of [
      { file: 'R01', agent: 'claude', width: 1302, height: 489 },
      { file: 'R02', agent: 'codex', width: 1171, height: 535 },
      { file: 'R03', agent: 'opencode', width: 1060, height: 455 },
    ]) {
      const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: 1 });
      await page.goto(`${url}?agent=${shot.agent}`, { waitUntil: 'networkidle' });
      await page.getByRole('dialog', { name: 'Agent picker' }).waitFor();
      await page.getByPlaceholder('Search models').waitFor();
      await page.evaluate(() => document.fonts.ready);
      // Preserve the natural panel appearance where possible. If its height does
      // not fit, move it upward first, then uniformly scale only as a last resort.
      await page.evaluate(() => {
        const wrap = document.querySelector('.picker-wrap');
        const picker = wrap.querySelector('[role=dialog]');
        const available = innerHeight - 10;
        const height = picker.getBoundingClientRect().height;
        if (height > available) picker.style.zoom = String(available / height);
        const fittedHeight = picker.getBoundingClientRect().height;
        const currentTop = parseFloat(getComputedStyle(wrap).marginTop);
        wrap.style.marginTop = `${Math.max(5, Math.min(currentTop, innerHeight - fittedHeight - 5))}px`;
      });
      await page.screenshot({ path: `${outDir}/${shot.file}.png` });
      console.log(`captured ${shot.file}: ${shot.width}x${shot.height}`);
      await page.close();
    }
  } finally { await browser.close(); }
} finally { server.kill('SIGTERM'); }
