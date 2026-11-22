import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

// Regression: agent replies rendered with plain CommonMark, so GFM tables
// showed up as a paragraph of literal pipes.
test("agent messages and Markdown documents render GitHub-flavored Markdown", async (t) => {
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    plugins: [react()],
    resolve: { alias: { "@": path.resolve("src") } },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  t.after(() => server.close());
  const { SessionMessage } = await server.ssrLoadModule("/src/components/ade/SessionMessage.tsx");
  const { MarkdownDocument } = await server.ssrLoadModule(
    "/src/components/ade/files/MarkdownDocument.tsx",
  );

  const text = [
    "**How it compares:**",
    "",
    "| | InsForge | Supabase |",
    "|---|---|---|",
    "| DB | Postgres | Postgres |",
    "",
    "- [x] done",
    "- [ ] todo",
    "",
    "~~old~~ and https://example.com",
  ].join("\n");

  for (const html of [
    renderToStaticMarkup(
      createElement(SessionMessage, {
        message: { id: "m1", role: "agent", text, at: 0 },
        agentName: "Pi",
      }),
    ),
    renderToStaticMarkup(createElement(MarkdownDocument, { content: text })),
  ]) {
    assert.match(html, /<table>/);
    assert.match(html, /<th>InsForge<\/th>/);
    assert.match(html, /<td>Postgres<\/td>/);
    assert.doesNotMatch(html, /\|---\|/);
    assert.match(html, /class="contains-task-list"/);
    assert.match(html, /<input type="checkbox" disabled="" checked=""\/>/);
    assert.match(html, /<del>old<\/del>/);
    assert.match(html, /<a href="https:\/\/example.com">/);
  }
});
