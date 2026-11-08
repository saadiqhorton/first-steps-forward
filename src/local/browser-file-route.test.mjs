import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { browser as browserRoute } from "./routes/browser.mjs";

/** Serves the browser route the way ADE does, over a real HTTP server. */
function serve(t, projectPath) {
  const server = createServer((req, res) => {
    const parts = new URL(req.url, "http://localhost").pathname.split("/").filter(Boolean);
    void browserRoute({
      req,
      res,
      parts,
      state: { projects: [{ id: "project", path: projectPath }], sessions: [] },
      json: (response, code, value) => {
        response.writeHead(code, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
        return true;
      },
    })
      .then((handled) => {
        if (handled || res.writableEnded) return;
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Not found." }));
      })
      .catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      t.after(() => new Promise((done) => server.close(done)));
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

test("a workspace page opens in the browser with its assets, but project secrets do not", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ade-preview-file-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "ade-preview-outside-"));
  await mkdir(path.join(root, "docs"));
  await writeFile(
    path.join(root, "docs", "index.html"),
    '<title>Report</title><link rel="stylesheet" href="style.css"><p>Hello</p>',
  );
  await writeFile(path.join(root, "docs", "style.css"), "p { color: red }");
  await writeFile(path.join(root, "docs", "brief.pdf"), "%PDF-1.4 brief");
  await writeFile(path.join(root, "docs", "data.json"), '{"ok":true}');
  await writeFile(path.join(root, "docs", "photo.png"), "png");
  await writeFile(path.join(root, "docs", "notes.yml"), "secret: true");
  await writeFile(path.join(root, ".env"), "TOKEN=secret");
  await writeFile(path.join(outside, "secret.html"), "<p>secret</p>");
  t.after(() =>
    Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]),
  );
  const base = await serve(t, root);

  const page = await fetch(`${base}/projects/project/browser/files/docs/index.html`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.match(await page.text(), /<title>Report<\/title>/);

  // The page's own stylesheet resolves against the same route, so it renders completely.
  const style = await fetch(`${base}/projects/project/browser/files/docs/style.css`);
  assert.equal(style.status, 200);
  assert.match(style.headers.get("content-type") ?? "", /text\/css/);
  assert.equal(await style.text(), "p { color: red }");

  const pdf = await fetch(`${base}/projects/project/browser/files/docs/brief.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(await pdf.text(), "%PDF-1.4 brief");

  const data = await fetch(`${base}/projects/project/browser/files/docs/data.json`);
  assert.equal(data.status, 200);

  const unlisted = await fetch(`${base}/projects/project/browser/files/docs/notes.yml`);
  assert.equal(unlisted.status, 400);

  const dotfile = await fetch(`${base}/projects/project/browser/files/.env`);
  assert.equal(dotfile.status, 403);

  const escaped = await fetch(
    `${base}/projects/project/browser/files/${encodeURIComponent(`../${path.basename(outside)}/secret.html`)}`,
  );
  assert.equal(escaped.status, 403);

  const absoluteInside = await fetch(
    `${base}/projects/project/browser/files/${encodeURIComponent(path.join(root, "docs", "index.html"))}`,
  );
  assert.equal(absoluteInside.status, 200);

  const absoluteEscape = await fetch(
    `${base}/projects/project/browser/files/${encodeURIComponent(path.join(outside, "secret.html"))}`,
  );
  assert.equal(absoluteEscape.status, 403);

  const missing = await fetch(`${base}/projects/project/browser/files/docs/missing.html`);
  assert.equal(missing.status, 404);
});
