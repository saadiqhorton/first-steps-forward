import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const executablePath = process.env.ADE_TEST_CHROMIUM || "/usr/bin/chromium";

async function startFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ade-session-thread-"));
  const source = path.resolve("src");
  await symlink(path.resolve("node_modules"), path.join(root, "node_modules"));
  await writeFile(
    path.join(root, "index.html"),
    '<div id="root"></div><script type="module" src="/fixture.jsx"></script>',
  );
  await writeFile(
    path.join(root, "fixture.jsx"),
    `
    import React, {useState} from "react";
    import {createRoot} from "react-dom/client";
    import {SessionThread} from "@/components/ade/SessionThread";
    import "@/styles.css";
    const all = (n) => Array.from({length:n}, (_, i) => ({id:"m"+i, role:i%2?"agent":"user", at:i, text:"Message "+i+" of the conversation"}));
    function App() {
      const [messages, setMessages] = useState(() => all(window.__count));
      const [running, setRunning] = useState(false);
      window.__set = setMessages; window.__running = setRunning;
      return <div id="scroller" className="space-y-3" style={{height:500, overflowY:"auto"}}>
        <SessionThread messages={messages} agentName="Codex" projectId="p" running={running} />
      </div>;
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
      fs: { allow: [source, root, path.resolve("node_modules")] },
    },
  });
  await server.listen();
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  return async (count) => {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((value) => (window.__count = value), count);
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByText(`Message ${count - 1} of`).waitFor();
    const shown = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("#scroller > div")]
          .map((row) => /Message (\d+) of/.exec(row.textContent)?.[1])
          .filter((value) => value !== undefined)
          .map(Number),
      );
    const toEnd = () =>
      page.evaluate(() => {
        const el = document.getElementById("scroller");
        el.scrollTop = el.scrollHeight;
      });
    const settled = async (length) => {
      for (let i = 0; i < 60; i++) {
        if ((await shown()).length >= length) return;
        await page.waitForTimeout(50);
      }
      assert.fail(`only ${(await shown()).length} of ${length} messages`);
    };
    return { page, shown, toEnd, settled, errors };
  };
}

test(
  "a conversation opens on its newest messages and no message is out of reach",
  {
    skip: !existsSync(executablePath),
  },
  async (t) => {
    const open = await startFixture(t);
    const { page, shown, toEnd, settled, errors } = await open(300);
    await toEnd();
    await page.waitForTimeout(300);
    const first = await shown();
    assert.ok(first.length < 200, `${first.length} messages rendered at once`);
    assert.equal(first.at(-1), 299);

    // Scrolling up reaches the very first message, in order, with nothing missing.
    for (let i = 0; i < 40 && (await shown())[0] !== 0; i++) {
      await page.evaluate(() => (document.getElementById("scroller").scrollTop = 0));
      await page.waitForTimeout(80);
    }
    assert.deepEqual(
      await shown(),
      Array.from({ length: 300 }, (_, i) => i),
    );
    assert.deepEqual(errors, []);

    // A conversation that fits is whole from the start.
    const short = await open(12);
    await short.settled(12);
    assert.deepEqual(
      await short.shown(),
      Array.from({ length: 12 }, (_, i) => i),
    );
  },
);

test(
  "adding older messages does not move what is being read",
  {
    skip: !existsSync(executablePath),
  },
  async (t) => {
    const open = await startFixture(t);
    const { page, shown, toEnd } = await open(300);
    await toEnd();
    await page.waitForTimeout(300);
    const before = (await shown()).length;
    const moved = await page.evaluate(async () => {
      const el = document.getElementById("scroller");
      el.scrollTop = 900;
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const box = el.getBoundingClientRect();
      const row = [...el.children].find((r) => r.getBoundingClientRect().top >= box.top);
      const text = row.textContent;
      const top = row.getBoundingClientRect().top;
      for (let i = 0; i < 20; i++) await frame();
      const same = [...el.children].find((r) => r.textContent === text);
      return Math.abs(same.getBoundingClientRect().top - top);
    });
    assert.ok((await shown()).length > before, "older messages were added");
    assert.ok(moved < 2, `the text being read moved ${moved}px`);
  },
);

test(
  "find in page has every message to look in",
  { skip: !existsSync(executablePath) },
  async (t) => {
    const open = await startFixture(t);
    const { page, shown, toEnd } = await open(300);
    await toEnd();
    await page.waitForTimeout(200);
    await page.evaluate(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }),
      ),
    );
    assert.equal((await shown()).length, 300);
  },
);

test(
  "a streamed reply shows as it grows, reads the same when finished, and is not lost",
  {
    skip: !existsSync(executablePath),
  },
  async (t) => {
    const open = await startFixture(t);
    const { page, errors } = await open(60);
    const text =
      "Intro\n\n- one\n\n- two\n\n```ts\nconst a = 1;\n\nlet b;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nEnd";
    const html = () =>
      page.evaluate(() =>
        [...document.querySelectorAll(".ade-markdown")]
          .at(-1)
          .innerHTML.replace(/>\s+</g, "><")
          .trim(),
      );
    await page.evaluate(() => window.__running(true));
    for (let end = 1; end <= text.length; end += 3) {
      await page.evaluate(
        (value) =>
          window.__set((list) => [
            ...list.filter((m) => m.id !== "new"),
            { id: "new", role: "agent", at: 99, text: value },
          ]),
        text.slice(0, end),
      );
    }
    await page.evaluate(
      (value) =>
        window.__set((list) => list.map((m) => (m.id === "new" ? { ...m, text: value } : m))),
      text,
    );
    await page.getByText("End", { exact: true }).waitFor();
    const streamed = await html();
    await page.evaluate(() => window.__running(false));
    await page.waitForTimeout(100);
    assert.equal(await html(), streamed);
    assert.match(streamed, /<table>/);
    assert.deepEqual(errors, []);
  },
);
