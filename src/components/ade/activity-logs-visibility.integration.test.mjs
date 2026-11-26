import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const executablePath = process.env.ADE_TEST_CHROMIUM || "/usr/bin/chromium";
// Worktrees may lack a populated local node_modules; resolve the tree Node actually uses.
const modulesRoot = path.resolve(
  path.dirname(createRequire(import.meta.url).resolve("react/package.json")),
  "..",
);

const MANIFEST = "Context manifest: 12 candidate files, tools: read, edit";
const start = (id, toolName, args = {}) =>
  JSON.stringify({ type: "tool_execution_start", toolCallId: id, toolName, args });
const end = (id, toolName, text) =>
  JSON.stringify({
    type: "tool_execution_end",
    toolCallId: id,
    toolName,
    result: { content: [{ type: "text", text }] },
    isError: false,
  });

// An earlier turn is dropped while hidden so lineOffset must keep the Read turn's id stable.
const EARLY = [MANIFEST, start("z", "bash", { command: "echo early" }), end("z", "bash", "early")];
const READ_TURN = [MANIFEST, start("a", "read", { path: "a.ts" }), end("a", "read", "ok")];
const INITIAL = [...EARLY, ...READ_TURN];

/**
 * Activity stays mounted under Tailwind `hidden` when another right-pane tab is selected.
 * Formatting must freeze while the column has no box; logs + currentActivity must keep updating.
 */
test(
  "hidden activity column freezes formatted turns until it has a box",
  {
    skip: !existsSync(executablePath),
  },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ade-activity-logs-vis-"));
    const source = path.resolve("src");
    await symlink(modulesRoot, path.join(root, "node_modules"));
    await writeFile(
      path.join(root, "index.html"),
      '<div id="root"></div><script type="module" src="/fixture.jsx"></script>',
    );
    await writeFile(
      path.join(root, "fixture.jsx"),
      `
    import React, {useState} from "react";
    import {createRoot} from "react-dom/client";
    import {ActivityLogs} from "@/components/ade/ActivityLogs";
    import {currentActivity} from "@/lib/ade/formatLogs.mjs";
    import "@/styles.css";

    function App() {
      const [lines, setLines] = useState(() => window.__initial);
      const [hidden, setHidden] = useState(false);
      window.__setLines = setLines;
      window.__setHidden = setHidden;
      return (
        <div style={{width: 480, height: 600}}>
          <p id="status">{currentActivity(lines)}</p>
          <div id="column" className={hidden ? "hidden" : "flex flex-col"}>
            <div id="activity" className="min-h-0 flex-1 overflow-y-auto">
              <ActivityLogs lines={lines} live={false} />
            </div>
          </div>
        </div>
      );
    }
    createRoot(document.getElementById("root")).render(<App />);
  `,
    );
    const server = await createServer({
      configFile: false,
      root,
      cacheDir: path.join(root, ".vite-cache"),
      logLevel: "silent",
      plugins: [react(), (await import("@tailwindcss/vite")).default()],
      resolve: { alias: [{ find: "@", replacement: source }], dedupe: ["react", "react-dom"] },
      server: {
        host: "127.0.0.1",
        port: 0,
        fs: { allow: [source, root, modulesRoot] },
      },
    });
    await server.listen();
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox"],
    });
    t.after(async () => {
      await browser.close();
      await server.close();
      await rm(root, { recursive: true, force: true });
    });

    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((value) => {
      window.__initial = value;
    }, INITIAL);
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByText("Read 1 file", { exact: true }).waitFor();

    // Mark the Read turn node while it is visible (id turn-3 with the early turn ahead of it).
    const turnIdentity = await page.evaluate(() => {
      const activity = document.getElementById("activity");
      const turns = [...activity.querySelectorAll("[data-state]")];
      const read = turns.find((el) => el.textContent.includes("Read 1 file"));
      if (!read) throw new Error("expected Read turn");
      window.__readTurn = read;
      return { text: read.textContent, count: turns.length };
    });
    assert.match(turnIdentity.text, /Read 1 file/);
    assert.ok(turnIdentity.count >= 2);

    // Hide the column (same class SessionView uses when rightTab !== "activity").
    await page.evaluate(() => window.__setHidden(true));
    await page.waitForFunction(
      () => document.getElementById("column").getClientRects().length === 0,
    );
    // Let ResizeObserver + React commit the hasBox=false freeze before appending lines.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );

    const frozen = await page.evaluate(() => {
      const activity = document.getElementById("activity");
      return {
        text: activity.textContent,
        readSame: window.__readTurn.isConnected && activity.contains(window.__readTurn),
        turnCount: activity.querySelectorAll("[data-state]").length,
      };
    });
    assert.equal(frozen.readSame, true);

    // Drop the early turn (lineOffset += EARLY.length) and append an edit turn that would
    // create a new title. Without lineOffset the Read turn's id would shift.
    const nextLines = [
      ...READ_TURN,
      MANIFEST,
      start("b", "edit", { path: "b.ts" }),
      end("b", "edit", "ok"),
      start("c", "edit", { path: "c.ts" }),
    ];
    await page.evaluate((lines) => window.__setLines(lines), nextLines);

    // Parent status still tracks live logs while the column is hidden.
    await page.waitForFunction(() =>
      document.getElementById("status").textContent.includes("Updating"),
    );
    assert.match(await page.locator("#status").innerText(), /Updating c\.ts/);

    // Hidden tree must stay frozen: same text, same turn node, no new title yet.
    const stillFrozen = await page.evaluate(() => {
      const activity = document.getElementById("activity");
      const turns = [...activity.querySelectorAll("[data-state]")];
      const read = turns.find((el) => el.textContent.includes("Read 1 file"));
      return {
        text: activity.textContent,
        readSame: Object.is(window.__readTurn, read),
        hasEdited: activity.textContent.includes("Edited"),
        turnCount: turns.length,
      };
    });
    assert.equal(stillFrozen.text, frozen.text);
    assert.equal(stillFrozen.readSame, true);
    assert.equal(stillFrozen.hasEdited, false);
    assert.equal(stillFrozen.turnCount, frozen.turnCount);

    // Reveal the column — one format of the latest lines.
    await page.evaluate(() => window.__setHidden(false));
    await page.waitForFunction(() => document.getElementById("column").getClientRects().length > 0);
    await page.getByText("Edited 2 files").waitFor();

    const afterShow = await page.evaluate(() => {
      const activity = document.getElementById("activity");
      const turns = [...activity.querySelectorAll("[data-state]")];
      const read = turns.find((el) => el.textContent.includes("Read 1 file"));
      return {
        texts: turns.map((el) => el.textContent),
        // lineOffset survived: the pre-gap Read turn keeps its React key / same DOM node.
        readSame: Object.is(window.__readTurn, read),
      };
    });
    assert.ok(
      afterShow.texts.some((text) => /Edited \d+ files?/.test(text)),
      `missing Edited title in ${JSON.stringify(afterShow.texts)}`,
    );
    assert.ok(
      afterShow.texts.some((text) => text.includes("Read 1 file")),
      "pre-gap Read turn summary should still be present",
    );
    assert.equal(afterShow.readSame, true, "pre-gap turn DOM node should be reused via lineOffset");
    assert.deepEqual(errors, []);
  },
);
