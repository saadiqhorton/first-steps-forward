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
// Set to a speech WAV to drive the browser's real speech engine instead of the stub.
const realSpeechWav = process.env.ADE_REAL_SPEECH_WAV;
const screenshotDir = process.env.ADE_DICTATION_SCREENSHOT_DIR;

/**
 * Runs in the page before the app. Records getUserMedia constraints and chimes, and installs a
 * scriptable SpeechRecognition unless `window.__adeRealSpeech` was set first.
 */
function instrument() {
  window.__gum = [];
  const devices = navigator.mediaDevices;
  if (devices) {
    const getUserMedia = devices.getUserMedia.bind(devices);
    devices.getUserMedia = (constraints) => {
      window.__gum.push(JSON.parse(JSON.stringify(constraints)));
      return getUserMedia(constraints);
    };
  }
  window.__chimes = 0;
  const NativeAudioContext = window.AudioContext;
  if (NativeAudioContext)
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        window.__chimes++;
      }
    };
  if (new URL(location.href).searchParams.has("nospeech")) {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    return;
  }
  if (window.__adeRealSpeech) return;
  const speech = {
    instances: [],
    starts: [],
    tracks: [],
    current() {
      return this.instances[this.instances.length - 1];
    },
    result(list) {
      this.current().onresult?.({
        resultIndex: 0,
        results: list.map(([transcript, isFinal]) =>
          Object.assign([{ transcript, confidence: 1 }], { isFinal }),
        ),
      });
    },
    error(code) {
      const recognition = this.current();
      recognition.onerror?.({ error: code });
      setTimeout(() => recognition.onend?.(), 0);
    },
    end() {
      this.current().onend?.();
    },
  };
  class StubRecognition {
    constructor() {
      this.continuous = false;
      this.interimResults = false;
      this.lang = "";
      speech.instances.push(this);
    }
    start(track) {
      speech.tracks.push(track ?? null);
      speech.starts.push(
        track ? { id: track.id, deviceId: track.getSettings().deviceId, label: track.label } : null,
      );
      setTimeout(() => {
        this.onstart?.();
        this.onaudiostart?.();
      }, 0);
    }
    stop() {
      setTimeout(() => this.onend?.(), 0);
    }
    abort() {
      setTimeout(() => this.onend?.(), 0);
    }
  }
  window.__speech = speech;
  window.SpeechRecognition = StubRecognition;
  delete window.webkitSpeechRecognition;
}

async function startFixture(t, extraArgs = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ade-dictation-ui-"));
  const source = path.resolve("src");
  await symlink(path.resolve("node_modules"), path.join(root, "node_modules"));
  await writeFile(
    path.join(root, "store.js"),
    "export const useAdeState = (select) => select({agents:[]});",
  );
  await writeFile(
    path.join(root, "agent.jsx"),
    'export const AgentPicker = () => null; export const agentChipLabel = () => ({title:"Codex",subtitle:"gpt · high"});',
  );
  await writeFile(
    path.join(root, "index.html"),
    '<div id="root" style="padding:16px"></div><script type="module" src="/fixture.jsx"></script>',
  );
  await writeFile(
    path.join(root, "fixture.jsx"),
    `
    import React from "react";
    import {createRoot} from "react-dom/client";
    import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
    import {Composer} from "@/components/ade/Composer";
    import "@/styles.css";
    window.sent = [];
    const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
    createRoot(document.getElementById("root")).render(
      <QueryClientProvider client={client}>
        <Composer projectId="p1" compact mode="new" selection={{agentId:"codex",model:"",effort:"",speed:"",permission:"build"}} onSelectionChange={()=>{}} branch="main" placeholder="Describe a change" sending={false} onSend={async (text)=>{window.sent.push(text); return true;}} />
      </QueryClientProvider>,
    );
  `,
  );
  const server = await createServer({
    configFile: false,
    root,
    cacheDir: path.join(root, ".vite-cache"),
    logLevel: "silent",
    plugins: [react(), (await import("@tailwindcss/vite")).default()],
    resolve: {
      alias: [
        { find: "@/lib/ade/store", replacement: path.join(root, "store.js") },
        { find: "@/components/ade/AgentPicker", replacement: path.join(root, "agent.jsx") },
        { find: "@", replacement: source },
      ],
      dedupe: ["react", "react-dom"],
    },
    server: {
      host: "127.0.0.1",
      port: 0,
      fs: { allow: [source, root, path.resolve("node_modules")] },
    },
  });
  await server.listen();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      ...extraArgs,
    ],
  });
  t.after(async () => {
    await browser.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 760 } });
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/workspace/voice")
      return route.fulfill({ json: { voice: { chimeDuringDictation: true } } });
    return route.fulfill({ status: 404, json: {} });
  });
  return { page, url: server.resolvedUrls.local[0] };
}

const textarea = (page) => page.getByLabel("Describe a change");
const valueIs = (page, expected) =>
  page.waitForFunction((want) => document.querySelector("textarea")?.value === want, expected, {
    timeout: 5000,
  });

test(
  "dictation records from the chosen mic and writes speech at the caret",
  { skip: !existsSync(executablePath) || !!realSpeechWav },
  async (t) => {
    const { page, url } = await startFixture(t);
    await page.addInitScript(instrument);
    await page.goto(url);

    const mic = page.getByRole("button", { name: "Start dictation" });
    await mic.waitFor();
    assert.equal(await mic.getAttribute("aria-pressed"), "false");
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - window.innerWidth,
      footer: [...document.querySelectorAll(".card-panel div")].some(
        (el) => el.scrollWidth > el.clientWidth + 1,
      ),
    }));
    assert.ok(overflow.page <= 0, `page overflows by ${overflow.page}px at 390px`);
    assert.equal(overflow.footer, false, "a composer row overflows at 390px");

    // Mic names appear once permission is granted; the fake device gives several mics.
    await page.getByRole("button", { name: "Choose microphone" }).click();
    const allow = page.getByRole("menuitem", { name: "Allow microphone access" });
    if (await allow.count()) {
      await allow.click();
      await page.getByRole("menuitemradio", { name: "Fake Audio Input 2" }).waitFor();
    }
    const radios = await page.getByRole("menuitemradio").allTextContents();
    assert.equal(radios[0], "System default");
    assert.ok(radios.includes("Fake Audio Input 1") && radios.includes("Fake Audio Input 2"));
    if (screenshotDir)
      await page.screenshot({ path: path.join(screenshotDir, "dictation-menu-390.png") });
    await page.getByRole("menuitemradio", { name: "Fake Audio Input 2" }).click();
    const chosen = await page.evaluate(async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.find((d) => d.kind === "audioinput" && d.label === "Fake Audio Input 2")
        .deviceId;
    });
    assert.equal(await page.evaluate(() => localStorage.getItem("ade:dictation-mic")), chosen);

    // The chosen device reaches getUserMedia, and its track reaches recognition.start().
    await textarea(page).fill("Hello world");
    await page.evaluate(() => document.querySelector("textarea").setSelectionRange(5, 5));
    await mic.click();
    await page.waitForFunction(() => window.__speech.starts.length === 1);
    const stop = page.getByRole("button", { name: "Stop dictation" });
    assert.equal(await stop.getAttribute("aria-pressed"), "true");
    const gum = await page.evaluate(() => window.__gum.at(-1));
    assert.deepEqual(gum, { audio: { deviceId: { exact: chosen } } });
    const firstStart = await page.evaluate(() => window.__speech.starts[0]);
    assert.equal(firstStart.deviceId, chosen);
    const recognition = await page.evaluate(() => {
      const r = window.__speech.current();
      return { continuous: r.continuous, interimResults: r.interimResults, lang: r.lang };
    });
    assert.deepEqual(recognition, {
      continuous: true,
      interimResults: true,
      lang: await page.evaluate(() => navigator.language),
    });
    await page.getByRole("status").filter({ hasText: "Listening on Fake Audio Input 2" }).waitFor();
    assert.equal(await textarea(page).getAttribute("readonly"), "");
    await page.waitForFunction(() => window.__chimes === 1);

    // Interim text shows at the caret, then a final result replaces it.
    await page.evaluate(() => window.__speech.result([["big", false]]));
    await valueIs(page, "Hello big world");
    await page.evaluate(() => window.__speech.result([["big blue", true]]));
    await valueIs(page, "Hello big blue world");
    if (screenshotDir)
      await page.screenshot({ path: path.join(screenshotDir, "dictation-listening-390.png") });

    // The browser ending a continuous session restarts it on the same track, without a chime.
    await page.evaluate(() => window.__speech.end());
    await page.waitForFunction(() => window.__speech.starts.length === 2);
    const secondStart = await page.evaluate(() => window.__speech.starts[1]);
    assert.equal(secondStart.id, firstStart.id);
    await page.evaluate(() => window.__speech.result([["again", false]]));
    await valueIs(page, "Hello big blue again world");
    assert.equal(await page.evaluate(() => window.__chimes), 1);

    // Stopping keeps what was shown, releases the mic, and makes the text editable again.
    await stop.click();
    await mic.waitFor();
    await valueIs(page, "Hello big blue again world");
    assert.equal(await textarea(page).getAttribute("readonly"), null);
    assert.equal(await page.evaluate(() => window.__speech.tracks[0].readyState), "ended");
    assert.equal(await page.getByRole("status").count(), 0);

    // Escape stops dictation.
    await mic.click();
    await page.waitForFunction(() => window.__speech.starts.length === 3);
    await stop.waitFor();
    await page.keyboard.press("Escape");
    await mic.waitFor();

    // A recognition error shows its plain message and ends dictation.
    await mic.click();
    await page.waitForFunction(() => window.__speech.starts.length === 4);
    await page.evaluate(() => window.__speech.error("not-allowed"));
    await page.getByRole("alert").filter({ hasText: "blocked for this site" }).waitFor();
    await mic.waitFor();
    assert.equal(await textarea(page).getAttribute("readonly"), null);

    // Restarting dismisses the error; sending mid-dictation sends what was heard and stops.
    await textarea(page).fill("");
    await mic.click();
    await page.waitForFunction(() => window.__speech.starts.length === 5);
    assert.equal(await page.getByRole("alert").count(), 0);
    await page.evaluate(() =>
      window.__speech.result([
        ["ship it", true],
        ["now", false],
      ]),
    );
    await valueIs(page, "ship it now");
    await page.getByRole("button", { name: "Send" }).click();
    await page.waitForFunction(() => window.sent.length === 1);
    assert.equal(await page.evaluate(() => window.sent[0]), "ship it now");
    await mic.waitFor();
    await valueIs(page, "");

    // A saved mic that is no longer connected falls back to the system default, and says so.
    await page.evaluate(() => localStorage.setItem("ade:dictation-mic", "unplugged-mic"));
    await page.reload();
    await mic.click();
    await page.waitForFunction(() => window.__speech?.starts.length === 1);
    await page.getByRole("status").filter({ hasText: "isn't connected" }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__gum.at(-1)), { audio: true });
    await page.getByRole("button", { name: "Stop dictation" }).click();
    await mic.waitFor();

    // Without speech recognition the button still shows and explains why.
    await page.goto(`${url}?nospeech`);
    await mic.click();
    await page
      .getByRole("alert")
      .filter({ hasText: "no built-in speech recognition. Use Chrome, Edge or Safari." })
      .waitFor();
    assert.equal(await page.getByRole("button", { name: "Choose microphone" }).count(), 0);
  },
);

test(
  "dictation transcribes a speech WAV with the browser's real engine",
  { skip: !realSpeechWav || !existsSync(executablePath) },
  async (t) => {
    const { page, url } = await startFixture(t, [
      `--use-file-for-fake-audio-capture=${realSpeechWav}`,
    ]);
    await page.addInitScript(() => {
      window.__adeRealSpeech = true;
    });
    await page.addInitScript(instrument);
    await page.goto(url);
    await page.getByRole("button", { name: "Start dictation" }).click();
    // A real phrase, not just the first interim word.
    await page.waitForFunction(
      () => (document.querySelector("textarea")?.value.trim().split(/\s+/).length ?? 0) >= 5,
      null,
      { timeout: 30_000 },
    );
    const heard = await textarea(page).inputValue();
    t.diagnostic(`heard: ${heard}`);
    assert.ok(heard.trim().split(/\s+/).length >= 5, heard);
    await page.getByRole("button", { name: "Stop dictation" }).click();
  },
);
