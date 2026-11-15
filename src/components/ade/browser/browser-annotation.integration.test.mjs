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

test(
  "annotation keeps multiple targets, supports erasing, and produces an image and element context",
  { skip: !existsSync(executablePath) },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ade-annotation-ui-"));
    const source = path.resolve("src");
    await symlink(path.resolve("node_modules"), path.join(root, "node_modules"));
    await writeFile(
      path.join(root, "store.js"),
      'export const useAde = () => ({ steer: async () => {}, state: { sessions: [] } }); export const useAdeState = (selector) => selector({ agents: [] }); export const uploadAttachment = async () => ({ id: "attachment" });',
    );
    await writeFile(
      path.join(root, "agent.jsx"),
      'export const AgentPicker = () => null; export const agentChipLabel = () => ({title:"Agent",subtitle:"Model"});',
    );
    await writeFile(
      path.join(root, "notice.js"),
      "export const warnUser = async (message) => { window.lastWarning = message; };",
    );
    await writeFile(
      path.join(root, "index.html"),
      '<div id="root"></div><script type="module" src="/fixture.jsx"></script>',
    );
    await writeFile(
      path.join(root, "fixture.jsx"),
      `
    import React, {useCallback, useState} from "react";
    import {createRoot} from "react-dom/client";
    import {BrowserSurface} from "@/components/ade/browser/BrowserSurface";
    import {BrowserPreviewStateContext, BrowserPreviewFrameContext} from "@/components/ade/browser/browserPreviewContext";
    import {peekBrowserFeedback, takeBrowserFeedback, ensureBrowserFeedbackLoaded} from "@/lib/ade/browser/composerFeedback";
    import "./fixture.css";
    function App() {
      const [annotationMode,setAnnotationMode] = useState("element");
      const [probe,setProbe] = useState(null);
      window.setProbe = setProbe;
      window.setAnnotationMode = setAnnotationMode;
      const attachCanvas = useCallback((canvas) => { canvas.width=1280; canvas.height=800; const ctx=canvas.getContext("2d"); ctx.fillStyle="white"; ctx.fillRect(0,0,1280,800); }, []);
      const releaseCanvas = useCallback(() => {}, []);
      window.feedback = () => peekBrowserFeedback('["project","session"]')[0];
      window.clearFeedback = async () => { await ensureBrowserFeedbackLoaded('["project","session"]'); takeBrowserFeedback('["project","session"]', 100); };
      window.inputLog = [];
      const state = {projectId:"project",sessionId:"session",downloads:[], status:{available:true}, streamStatus:"open", streamError:null, nav:{url:"http://example.test/"}, control:{controller:"you",dialog:null,fileChooser:null}, send:(message)=>{window.inputLog.push(message); return true;}, changeControl:async()=>true, answerFileChooser:async()=>true, reconnect:()=>{}, annotationMode, setAnnotationMode, annotationOrigin:{projectId:"project",sessionId:"session",tabId:null,pageUrl:"http://example.test/"}, addPendingAnnotation:(draft)=>{window.result=draft;}, capture:{recordPointer:()=>{}}};
      const frame = {attachCanvas,releaseCanvas,viewport:{width:1280,height:800},hasFrame:true,pointer:null,probe};
      return <BrowserPreviewStateContext.Provider value={state}><BrowserPreviewFrameContext.Provider value={frame}><BrowserSurface mode="dock" /></BrowserPreviewFrameContext.Provider></BrowserPreviewStateContext.Provider>;
    }
    createRoot(document.getElementById("root")).render(<App/>);
  `,
    );
    await writeFile(
      path.join(root, "fixture.css"),
      `
    body{margin:0}
    [data-browser-surface]{position:relative;width:800px;height:500px;overflow:hidden;background:white}
    canvas,svg{position:absolute;inset:0;width:100%;height:100%} svg{pointer-events:none}
    [role=toolbar]{position:absolute;z-index:20;top:0;left:0;background:white;display:flex}
    [data-annotation-style]{position:absolute;z-index:21;top:55px;left:8px;background:white;display:grid}
    .pointer-events-none{pointer-events:none} .absolute{position:absolute}
  `,
    );
    await writeFile(
      path.join(root, "capture.html"),
      '<div id="root"></div><script type="module" src="/capture.jsx"></script>',
    );
    await writeFile(
      path.join(root, "capture.jsx"),
      `
    import React, {useEffect, useRef, useState} from "react";
    import {createRoot} from "react-dom/client";
    import {useBrowserCapture} from "@/components/ade/browser/useBrowserCapture";
    import {recordingAttachmentUrl} from "@/lib/ade/browser/recordingUpload";
    function App() {
      const ref=useRef(null); const [ready,setReady]=useState(false); const [show,setShow]=useState(true);
      const capture=useBrowserCapture("project","session",ref); window.captureResult=capture.drafts[0] ?? null; window.captureDrafts=capture.drafts; window.recordingUrl=recordingAttachmentUrl;
      useEffect(()=>{ const canvas=document.createElement("canvas"); canvas.width=640; canvas.height=400; const ctx=canvas.getContext("2d"); ctx.fillStyle="white"; ctx.fillRect(0,0,640,400); let disposed=false;
        const draw=()=>createImageBitmap(canvas).then(bitmap=>{if(disposed){bitmap.close();return;} const previous=ref.current; ref.current=bitmap; capture.paintCaptureFrame(bitmap); previous?.close(); setReady(true);});
        draw(); const timer=setInterval(draw,200); return ()=>{disposed=true;clearInterval(timer);ref.current?.close();}; },[capture.paintCaptureFrame]);
      return <><button disabled={!ready} onClick={()=>capture.startRecording("session","http://example.test/",undefined,"tab-1")}>Record</button><button onClick={()=>capture.startRecording("session","http://example.test/second",undefined,"tab-2")}>Record second</button><button onClick={()=>setShow(!show)}>Toggle toolbar</button>{show?<div data-toolbar>Toolbar</div>:null}<button onClick={()=>capture.recordPointer({x:100,y:100,width:640,height:400,source:"human",tabId:"tab-1"})}>Pointer</button><button onClick={()=>capture.stopRecording("tab-1")}>Stop</button><button onClick={()=>capture.stopRecording("tab-2")}>Stop second</button><output>{capture.recordingTabs.length}</output></>;
    } createRoot(document.getElementById("root")).render(<App/>);
  `,
    );
    await writeFile(
      path.join(root, "composer.html"),
      '<div id="root"></div><script type="module" src="/composer.jsx"></script>',
    );
    await writeFile(
      path.join(root, "composer.jsx"),
      `
      import React from "react";
      import {createRoot} from "react-dom/client";
      import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
      import {Composer} from "@/components/ade/Composer";
      import {addBrowserFeedback} from "@/lib/ade/browser/composerFeedback";
      import {loadFeedbackDraft} from "@/lib/ade/browser/feedbackPersistence";
      import {recordingAttachment, restoreRecordingAttachment} from "@/lib/ade/browser/recordingUpload";
      window.readDraft = () => loadFeedbackDraft('composer:["project","session"]');
      window.readQueue = () => loadFeedbackDraft('composer-feedback-queue:["project","session"]');
      window.enqueue = (id) => {
        const video = restoreRecordingAttachment({ id, name:"browser-recording.webm", mime:"video/webm", size:123456, kind:"file" });
        const images = Array.from({length:5}, (_,index) => new File(["image"], id+"-"+index+".png", {type:"image/png"}));
        addBrowserFeedback('["project","session"]', { text:"Feedback "+id, files:[video,...images] });
      };
      window.sent = [];
      createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient()}><Composer mode="follow-up" sessionId="session" draftStorageKey={'["project","session"]'} selection={{agentId:"codex",model:"",effort:"",speed:"",permission:"build"}} onSelectionChange={()=>{}} branch="main" placeholder="Message" sending={false} onSend={async (text,files)=>{window.sent.push({text,files:files.map(file=>({name:file.name,recording:recordingAttachment(file)}))});return true;}} /></QueryClientProvider>);
    `,
    );
    await writeFile(
      path.join(root, "isolation.html"),
      '<div id="root"></div><script type="module" src="/isolation.jsx"></script>',
    );
    await writeFile(
      path.join(root, "isolation.jsx"),
      `
      import React, {useState} from "react";
      import {createRoot} from "react-dom/client";
      import {feedbackScope, usePersistentFeedbackList, usePersistentFeedbackNotes} from "@/components/ade/browser/usePersistentFeedbackList";
      import {loadFeedbackDraft} from "@/lib/ade/browser/feedbackPersistence";
      const scopeA=feedbackScope("project-a","session");
      const scopeB=feedbackScope("project-b","session");
      const scopeOf=(item)=>item.scope; const identity=(item)=>item;
      function App() {
        const [scope,setScope]=useState(scopeA);
        const [items,setItems]=usePersistentFeedbackList("isolation",scope,scopeOf,identity,identity);
        const [notes,setNotes]=usePersistentFeedbackNotes("notes:"+scope);
        window.scopeItems=items.filter((item)=>item.scope===scope);
        window.scopeNotes=notes; window.readScope=(which)=>loadFeedbackDraft("isolation:"+(which==="a"?scopeA:scopeB));
        return <><button onClick={()=>setScope(scopeA)}>Scope A</button><button onClick={()=>setScope(scopeB)}>Scope B</button><button onClick={()=>setItems((current)=>[...current,{id:scope,scope}])}>Add</button><button onClick={()=>setNotes({text:scope})}>Note</button></>;
      }
      createRoot(document.getElementById("root")).render(<App/>);
    `,
    );
    const server = await createServer({
      configFile: false,
      root,
      cacheDir: path.join(root, ".vite-cache"),
      logLevel: "silent",
      plugins: [react()],
      resolve: {
        alias: [
          { find: "@/lib/ade/store", replacement: path.join(root, "store.js") },
          { find: "@/components/ade/AgentPicker", replacement: path.join(root, "agent.jsx") },
          { find: "@/lib/ade/userNotices", replacement: path.join(root, "notice.js") },
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
      args: ["--no-sandbox"],
    });
    t.after(async () => {
      await browser.close();
      await server.close();
      await rm(root, { recursive: true, force: true });
    });
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.setDefaultTimeout(5000);
    page.on("pageerror", (error) => console.error("Fixture page error:", error));
    page.on("console", (message) => {
      if (message.type() === "error") console.error("Fixture console:", message.text());
    });
    const pngData = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 800;
      return canvas.toDataURL("image/png").split(",")[1];
    });
    let restores = 0;
    await page.route(/\/api\/projects\/[^/]+\/browser\/capture(?:\?|$)/, (route) =>
      route.fulfill({ contentType: "image/png", body: Buffer.from(pngData, "base64") }),
    );
    await page.route("**/browser/annotation-style**", (route) => {
      const input = route.request().postDataJSON();
      if (input.action === "restore") {
        restores++;
        return route.fulfill({ json: { result: null } });
      }
      return route.fulfill({
        json: {
          result: {
            selector: input.selector,
            property: input.property,
            value: input.value,
            previousValue: "black",
            rect: { x: 160, y: 256, width: 100, height: 70 },
          },
        },
      });
    });
    await page.route("**/browser/annotation-rects**", (route) =>
      route.fulfill({
        json: {
          rects: route
            .request()
            .postDataJSON()
            .selectors.map(() => ({ x: 160, y: 256, width: 100, height: 70 })),
        },
      }),
    );
    await page.route("**/browser/inspect-region**", (route) =>
      route.fulfill({ json: { elements: [] } }),
    );
    await page.route("**/browser/inspect-element**", (route) =>
      route.fulfill({
        json: {
          element: {
            pageUrl: "http://example.test/",
            pageTitle: "Example",
            tagName: "button",
            selector: "#save",
            htmlPreview: "<button id=save>Save</button>",
            styles: "color: red",
            rect: { x: 160, y: 256, width: 100, height: 70 },
          },
        },
      }),
    );
    await page.goto(server.resolvedUrls.local[0]);
    await page.locator('canvas[aria-label="Browser page"]').waitFor();
    await page.mouse.click(100, 160);
    await page.getByText("Annotation · 1 target · drag to move").waitFor();
    await page.getByRole("button", { name: "Style", exact: true }).click();
    await page.getByLabel("Padding", { exact: true }).fill("5px");
    await page.getByLabel("Padding", { exact: true }).blur();
    await page.getByRole("button", { name: "Style", exact: true }).click();
    await page.getByRole("button", { name: "Region" }).click();
    await page.mouse.move(300, 240);
    await page.mouse.down();
    await page.mouse.move(450, 350);
    await page.mouse.up();
    await page.getByText("Annotation · 2 targets · drag to move").waitFor();
    await page.getByRole("button", { name: "Draw" }).click();
    await page.mouse.move(500, 200);
    await page.mouse.down();
    await page.mouse.move(600, 250, { steps: 5 });
    await page.mouse.up();
    await page.getByText("Annotation · 3 targets · drag to move").waitFor();
    await page.getByRole("button", { name: "Erase" }).click();
    await page.mouse.click(350, 300);
    await page.getByText("Annotation · 2 targets · drag to move").waitFor();
    await page.getByRole("textbox", { name: "Annotation feedback" }).fill("Move this button");
    await page.getByRole("button", { name: "Attach", exact: true }).click();
    await page.waitForFunction(() => window.feedback()?.files.length);
    const result = await page.evaluate(async () => ({
      name: window.feedback().files[0].name,
      type: window.feedback().files[0].type,
      size: window.feedback().files[0].size,
      detail: window.feedback().files[1]?.name,
      text: window.feedback().text,
    }));
    assert.equal(result.name, "browser-annotation.png");
    assert.equal(result.type, "image/png");
    assert.equal(result.detail, "browser-annotation-detail.png");
    assert.ok(result.size > 0);
    assert.match(result.text, /Selected element: #save/);
    assert.match(result.text, /Move this button/);
    assert.match(result.text, /element/);
    assert.match(result.text, /draw/);
    assert.doesNotMatch(result.text, /Target \d+: region/);
    assert.match(result.text, /padding from black to 5px/);
    assert.equal(restores, 1);

    // Keyboard input goes to the page, not this document: typed keys, paste, IME composition,
    // copy, and touch probes that decide whether a mobile keyboard should open.
    await page.evaluate(() => {
      window.setAnnotationMode("off");
      window.inputLog.length = 0;
    });
    await page.getByText(/Annotation · /).waitFor({ state: "detached" });
    await page.mouse.click(100, 300);
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("aria-label") === "Browser page keyboard input",
    );
    await page.keyboard.type("hi");
    await page.waitForFunction(
      () => window.inputLog.filter((message) => message.type === "key").length >= 4,
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.inputLog
          .filter((message) => message.type === "key" && message.action === "down" && message.text)
          .map((message) => message.text),
      ),
      ["h", "i"],
    );
    assert.equal(
      await page.evaluate(
        () => window.inputLog.filter((message) => message.type === "text").length,
      ),
      0,
    );
    await page.keyboard.press("Backspace");
    await page.waitForFunction(() =>
      window.inputLog.some(
        (message) =>
          message.type === "key" && message.key === "Backspace" && message.action === "down",
      ),
    );
    await page.keyboard.press("Control+c");
    await page.waitForFunction(() =>
      window.inputLog.some(
        (message) =>
          message.type === "key" &&
          message.key === "c" &&
          message.action === "down" &&
          message.modifiers === 2,
      ),
    );
    await page.evaluate(() => {
      const textarea = document.querySelector('textarea[aria-label="Browser page keyboard input"]');
      const data = new DataTransfer();
      data.setData("text/plain", "pasted text");
      textarea.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
      textarea.dispatchEvent(
        new CompositionEvent("compositionend", { data: "日本", bubbles: true }),
      );
    });
    await page.waitForFunction(
      () =>
        window.inputLog.some(
          (message) => message.type === "text" && message.text === "pasted text",
        ) && window.inputLog.some((message) => message.type === "text" && message.text === "日本"),
    );

    await page.evaluate(() => {
      window.inputLog.length = 0;
      document.activeElement?.blur();
    });
    const surfaceBox = await page.locator('canvas[aria-label="Browser page"]').boundingBox();
    await page.evaluate(
      ({ x, y }) => {
        window.touch = (clientX, clientY, type, extra) => {
          const canvas = document.querySelector('canvas[aria-label="Browser page"]');
          canvas.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 7,
              pointerType: "touch",
              isPrimary: true,
              clientX,
              clientY,
              ...extra,
            }),
          );
        };
        window.touch(x, y, "pointerdown", { button: 0, buttons: 1 });
        window.touch(x, y, "pointerup", { button: 0, buttons: 0 });
      },
      { x: surfaceBox.x + 100, y: surfaceBox.y + 160 },
    );
    const probePoint = await page.waitForFunction(() =>
      window.inputLog.find((message) => message.type === "probe"),
    );
    const probed = await probePoint.jsonValue();
    assert.equal(
      await page.evaluate(
        () =>
          window.inputLog.filter((message) => message.type === "mouse" && message.action === "down")
            .length,
      ),
      1,
    );
    assert.equal(
      await page.evaluate(
        () => document.activeElement?.getAttribute("aria-label") === "Browser page keyboard input",
      ),
      false,
    );
    await page.evaluate(({ x, y }) => window.setProbe({ x, y, editable: true }), {
      x: probed.x,
      y: probed.y,
    });
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("aria-label") === "Browser page keyboard input",
    );
    await page.evaluate(() => {
      window.inputLog.length = 0;
    });
    await page.evaluate(
      ({ x, y }) => {
        window.touch(x, y, "pointerdown", { button: 0, buttons: 1 });
        window.touch(x, y + 60, "pointermove", { buttons: 1 });
        window.touch(x, y + 60, "pointerup", { button: 0, buttons: 0 });
      },
      { x: surfaceBox.x + 200, y: surfaceBox.y + 260 },
    );
    const wheel = await page.waitForFunction(() =>
      window.inputLog.find((message) => message.type === "wheel"),
    );
    assert.notEqual((await wheel.jsonValue()).deltaY, 0);
    assert.equal(
      await page.evaluate(
        () => window.inputLog.filter((message) => message.type === "mouse").length,
      ),
      0,
    );
    await page.evaluate(() => window.clearFeedback());

    let nextRecordingId = 0;
    const recordings = new Map();
    await page.route("**/api/attachments/**", async (route) => {
      const address = new URL(route.request().url());
      const parts = address.pathname.split("/").filter(Boolean);
      if (address.pathname === "/api/attachments/recording/start") {
        const id = `recording-${++nextRecordingId}`;
        recordings.set(id, []);
        return route.fulfill({ json: { id } });
      }
      if (parts[2] === "recording" && parts[4] === "chunk") {
        recordings.get(parts[3]).push(route.request().postDataBuffer());
        return route.fulfill({ json: { ok: true } });
      }
      if (parts[2] === "recording" && parts[4] === "finish") {
        const bytes = Buffer.concat(recordings.get(parts[3]));
        return route.fulfill({
          json: {
            id: parts[3],
            name: "browser-recording.webm",
            mime: "video/webm",
            size: bytes.length,
            kind: "file",
            recording: true,
          },
        });
      }
      if (parts.length === 3 && recordings.has(parts[2]))
        return route.fulfill({
          contentType: "video/webm",
          body: Buffer.concat(recordings.get(parts[2])),
        });
      return route.abort();
    });
    await page.goto(new URL("capture.html", server.resolvedUrls.local[0]).href);
    await page.getByRole("button", { name: "Record", exact: true }).waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector("button").disabled);
    await page.getByRole("button", { name: "Record", exact: true }).click();
    await page.getByText("1", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Record second" }).click();
    await page.getByText("2", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Pointer" }).click();
    await page.getByRole("button", { name: "Toggle toolbar" }).click();
    await page.waitForTimeout(1200);
    assert.equal(await page.locator("[data-toolbar]").count(), 0);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.waitForFunction(() => window.captureResult?.files.length >= 4);
    await page.getByText("1", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Stop second" }).click();
    await page.waitForFunction(() => window.captureDrafts.length === 2);
    const recording = await page.evaluate(async () => {
      const [video, sheet] = window.captureResult.files;
      const element = document.createElement("video");
      const url = window.recordingUrl(video);
      element.src = url;
      element.muted = true;
      await new Promise((resolve, reject) => {
        element.onloadeddata = resolve;
        element.onerror = reject;
      });
      const size = { width: element.videoWidth, height: element.videoHeight };
      return {
        videoType: video.type,
        videoSize: Number(element.duration > 0),
        sheetType: sheet.type,
        sheetSize: sheet.size,
        images: window.captureResult.files.slice(1).map((file) => file.name),
        ...size,
      };
    });
    assert.equal(recording.videoType, "video/webm");
    assert.ok(recording.videoSize > 0 && recording.sheetSize > 0);
    assert.equal(recording.sheetType, "image/jpeg");
    assert.ok(recording.images.some((name) => name.startsWith("browser-recording-frame-")));
    assert.ok(recording.images.some((name) => name.startsWith("browser-recording-final-frame.")));
    assert.deepEqual([recording.width, recording.height], [640, 400]);
    await page.waitForFunction(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("ade-feedback-drafts", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return await new Promise((resolve) => {
        const request = db
          .transaction("drafts")
          .objectStore("drafts")
          .get('capture-review:["project","session"]');
        request.onsuccess = () => resolve(request.result?.length === 2);
      });
    });
    await page.reload();
    await page.waitForFunction(() => window.captureDrafts?.length === 2);
    assert.equal(
      await page.evaluate(() => window.recordingUrl(window.captureDrafts[0].files[0])),
      "/api/attachments/recording-1",
    );

    await page.goto(new URL("composer.html", server.resolvedUrls.local[0]).href);
    await page.waitForFunction(() => typeof window.enqueue === "function");
    await page.evaluate(() => {
      window.enqueue("first");
      window.enqueue("second");
    });
    await page.waitForFunction(
      () => document.querySelectorAll('[aria-label^="Remove "]').length === 6,
    );
    await page.waitForFunction(async () => (await window.readDraft())?.files.length === 6);
    const handedOff = await page.evaluate(async () => ({
      draft: (await window.readDraft())?.files.length,
      queue: (await window.readQueue())?.length,
    }));
    assert.deepEqual(handedOff, { draft: 6, queue: 1 });
    await page.reload();
    await page.waitForFunction(
      () => document.querySelectorAll('[aria-label^="Remove "]').length === 6,
    );
    assert.match(
      await page.getByRole("textbox", { name: "Follow-up message" }).inputValue(),
      /Feedback first/,
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForFunction(
      () =>
        window.sent.length === 1 &&
        document.querySelector("textarea")?.value.includes("Feedback second"),
    );
    const sent = await page.evaluate(() => window.sent[0]);
    assert.equal(sent.files[0].recording.id, "first");
    assert.equal(sent.files[0].recording.size, 123456);
    await page.waitForFunction(async () =>
      (await window.readDraft())?.text.includes("Feedback second"),
    );
    await page.reload();
    await page.waitForFunction(() =>
      document.querySelector("textarea")?.value.includes("Feedback second"),
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForFunction(async () => !(await window.readDraft()));

    await page.goto(new URL("isolation.html", server.resolvedUrls.local[0]).href);
    await page.getByRole("button", { name: "Add" }).click();
    await page.getByRole("button", { name: "Note" }).click();
    await page.waitForFunction(async () => (await window.readScope("a"))?.length === 1);
    await page.getByRole("button", { name: "Scope B" }).click();
    await page.getByRole("button", { name: "Add" }).click();
    await page.getByRole("button", { name: "Note" }).click();
    await page.waitForFunction(async () => (await window.readScope("b"))?.length === 1);
    await page.reload();
    await page.waitForFunction(
      () => window.scopeItems?.length === 1 && window.scopeNotes?.text?.includes("project-a"),
    );
    await page.getByRole("button", { name: "Scope B" }).click();
    await page.waitForFunction(
      () => window.scopeItems?.length === 1 && window.scopeNotes?.text?.includes("project-b"),
    );
    assert.ok((await page.evaluate(() => window.readScope("a")))[0].id.includes("project-a"));
    assert.ok((await page.evaluate(() => window.readScope("b")))[0].id.includes("project-b"));

    const interruptedContext = await browser.newContext({
      viewport: { width: 1000, height: 700 },
    });
    await interruptedContext.addInitScript(() => {
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (window.failComposerSave && typeof key === "string" && key.startsWith("composer:")) {
          throw new DOMException("Simulated quota failure", "QuotaExceededError");
        }
        return originalPut.call(this, value, key);
      };
    });
    const interrupted = await interruptedContext.newPage();
    interrupted.setDefaultTimeout(5000);
    try {
      await interrupted.goto(new URL("composer.html", server.resolvedUrls.local[0]).href);
      await interrupted.waitForFunction(() => typeof window.enqueue === "function");
      await interrupted.waitForFunction(() => {
        const composer = document.querySelector("textarea");
        return composer && !composer.disabled;
      });
      await interrupted.evaluate(() => {
        window.failComposerSave = true;
        window.enqueue("interrupted");
      });
      await interrupted.waitForFunction(() =>
        /could not be saved|storage is unavailable/i.test(window.lastWarning ?? ""),
      );
      const preserved = await interrupted.evaluate(async () => ({
        draft: (await window.readDraft())?.text ?? "",
        queue: (await window.readQueue())?.length ?? 0,
      }));
      assert.doesNotMatch(preserved.draft, /Feedback interrupted/);
      assert.equal(preserved.queue, 1);
      await interrupted.evaluate(() => {
        window.failComposerSave = false;
        location.reload();
      });
      await interrupted.waitForFunction(
        () =>
          document.querySelector("textarea")?.value.includes("Feedback interrupted") &&
          document.querySelectorAll('[aria-label^="Remove "]').length === 6,
      );
      await interrupted.waitForFunction(async () => (await window.readQueue()) === undefined);
    } finally {
      await interruptedContext.close();
    }

    const withoutStorage = await browser.newPage();
    await withoutStorage.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", {
        get() {
          throw new Error("storage unavailable");
        },
      });
    });
    await withoutStorage.goto(new URL("composer.html", server.resolvedUrls.local[0]).href);
    await withoutStorage.waitForFunction(() => typeof window.enqueue === "function");
    await withoutStorage.evaluate(() => window.enqueue("in-memory"));
    await withoutStorage.waitForFunction(() =>
      document.querySelector("textarea")?.value.includes("Feedback in-memory"),
    );
    assert.match(
      await withoutStorage.evaluate(() => window.lastWarning),
      /could not be saved|storage is unavailable/i,
    );
    await withoutStorage.getByRole("button", { name: "Send", exact: true }).click();
    await withoutStorage.waitForFunction(() => window.sent.length === 1);
    assert.equal(
      await withoutStorage.evaluate(() => window.sent[0].files[0].recording.id),
      "in-memory",
    );
    await withoutStorage.close();
  },
);
