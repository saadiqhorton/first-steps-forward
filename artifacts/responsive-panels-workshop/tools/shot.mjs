import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
const dir = process.argv[2], out = process.argv[3], hashes = process.argv.slice(4);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const srv = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p === "/") p = "/index.html";
    const body = await readFile(join(dir, p));
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = srv.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
for (const h of hashes) {
  const [hash, extra] = h.split("@");
  await page.goto(`http://127.0.0.1:${port}/index.html${hash}`);
  await page.waitForTimeout(400);
  if (extra) for (const step of extra.split(",")) {
    const [k, v] = step.split("=");
    if (k === "w") { await page.fill("#ctl-width", v); await page.dispatchEvent("#ctl-width", "input"); }
    if (k === "vp") await page.click(`#ctl-viewport button[data-v="${v}"]`);
    if (k === "c") await page.click(`#ctl-computer button[data-v="${v}"]`);
    if (k === "th") await page.click(`#ctl-theme button[data-v="${v}"]`);
  }
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${(hash || "#overview").slice(1)}${extra ? "_" + extra.replace(/[,=]/g, "-") : ""}.png`, fullPage: true });
}
console.log("errors:", errors.filter(e => !/is not defined|404/.test(e)).join("\n") || "none");
await browser.close(); srv.close();
