import { chromium } from "@playwright/test";
const b = await chromium.launch();
for (const mode of ["direct", "click"]) {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errs = [];
  p.on("console", (m) => m.type() === "error" && errs.push(m.text().split("\n")[0]));
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://127.0.0.1:3100/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1000);
  if (mode === "direct") await p.goto(p.url().replace(/\/conversations.*$/, "/workflows"), { waitUntil: "networkidle" });
  else await p.getByRole("link", { name: "Workflows" }).click();
  await p.waitForTimeout(1500);
  console.log(mode, "->", p.url().split("/").pop(), "|", errs.join(" || ") || "no errors");
}
await b.close();
