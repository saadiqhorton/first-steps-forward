import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createToolCaller, handleMessage, TOOLS } from "./computer-tools-defs.mjs";

const fakeFetch =
  (routes) =>
  async (url, init = {}) => {
    const key = `${init.method ?? "GET"} ${new URL(url).pathname}`;
    const [status, payload] = routes[key] ?? [404, { error: "nope" }];
    return { status, json: async () => payload };
  };

test("initialize negotiates a supported protocol and advertises tools", async () => {
  const init = await handleMessage(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
    async () => ({}),
  );
  assert.equal(init.result.protocolVersion, "2025-03-26");
  assert.deepEqual(init.result.capabilities, { tools: {} });
  const unknown = await handleMessage(
    { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } },
    async () => ({}),
  );
  assert.equal(unknown.result.protocolVersion, "2025-06-18");
  assert.equal(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  const list = await handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" });
  assert.deepEqual(
    list.result.tools.map((t) => t.name),
    TOOLS.map((t) => t.name),
  );
  const missing = await handleMessage({ jsonrpc: "2.0", id: 4, method: "resources/list" });
  assert.equal(missing.error.code, -32601);
});

test("computer tools post the action to ADE and return the screenshot as an image", async () => {
  const callTool = createToolCaller({
    api: "http://127.0.0.1:3000",
    projectId: "p1",
    fetchImpl: async (url, init) => {
      assert.equal(url, "http://127.0.0.1:3000/api/projects/p1/computer/action");
      assert.deepEqual(JSON.parse(init.body), { action: "click", x: 10, y: 20, button: "left" });
      return {
        status: 200,
        json: async () => ({
          screenshot: "SU1H",
          width: 1280,
          height: 800,
          cursor: { x: 10, y: 20 },
        }),
      };
    },
  });
  const result = await callTool("computer_click", { x: 10, y: 20 });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /Mouse at \(10, 20\)/);
  assert.deepEqual(result.content[1], { type: "image", data: "SU1H", mimeType: "image/png" });
});

test("browser tools route to the browser action endpoint and return screenshots as images", async () => {
  const names = TOOLS.map((t) => t.name);
  for (const name of ["browser_status", "browser_snapshot", "browser_click", "browser_screenshot"])
    assert.ok(names.includes(name), `${name} is advertised`);
  const calls = [];
  const callTool = createToolCaller({
    api: "http://127.0.0.1:3000",
    projectId: "p1",
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      if (calls.length === 1) return { status: 200, json: async () => ({ text: "Clicked e5." }) };
      return {
        status: 200,
        json: async () => ({ text: "Screenshot.", image: "QjE=", mimeType: "image/png" }),
      };
    },
  });
  const clicked = await callTool("browser_click", { ref: "e5" });
  assert.equal(calls[0].url, "http://127.0.0.1:3000/api/projects/p1/browser/action");
  assert.deepEqual(calls[0].body, { action: "click", ref: "e5" });
  assert.equal(clicked.content[0].text, "Clicked e5.");
  const shot = await callTool("browser_screenshot");
  assert.deepEqual(calls[1].body, { action: "screenshot" });
  assert.deepEqual(shot.content[1], { type: "image", data: "QjE=", mimeType: "image/png" });
});

test("browser_scroll applies its default deltaY when no delta is given", async () => {
  const bodies = [];
  const callTool = createToolCaller({
    api: "http://127.0.0.1:3000",
    projectId: "p1",
    fetchImpl: async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return { status: 200, json: async () => ({ text: "Scrolled." }) };
    },
  });
  await callTool("browser_scroll", {});
  await callTool("browser_scroll", { deltaX: 0 });
  assert.equal(bodies[0].deltaY, 400);
  assert.equal(bodies[1].deltaY, undefined);
});

test("a human-controlled computer or browser returns a readable tool error", async () => {
  const message =
    "The user has taken control of the agent computer. Wait for them to hand control back, then try again.";
  const callTool = createToolCaller({
    api: "http://127.0.0.1:3000",
    projectId: "p1",
    fetchImpl: fakeFetch({
      "POST /api/projects/p1/browser/action": [409, { error: message, code: "human_control" }],
      "POST /api/projects/p1/computer/action": [409, { error: message, code: "human_control" }],
    }),
  });
  for (const name of ["browser_navigate", "computer_click"]) {
    const result = await callTool(
      name,
      name === "browser_navigate" ? { url: "x" } : { x: 1, y: 1 },
    );
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, message);
  }
});

test("dev server tools report the URL to open, and failures are tool errors", async () => {
  const callTool = createToolCaller({
    api: "http://127.0.0.1:3000",
    projectId: "p1",
    fetchImpl: fakeFetch({
      "POST /api/projects/p1/dev/start": [200, { status: "running", port: 5173 }],
      "POST /api/projects/p1/computer/action": [503, { error: "Docker is not running" }],
    }),
  });
  const started = await callTool("dev_server_start");
  assert.match(started.content[0].text, /http:\/\/localhost:5173/);
  const failed = await callTool("computer_screenshot");
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /Docker is not running/);
  const unconnected = await createToolCaller({ api: "", projectId: "" })("computer_screenshot");
  assert.equal(unconnected.isError, true);
});

test("dev_server_start sends a proposed command with the session, and waiting is no error", async () => {
  const bodies = [];
  const callTool = createToolCaller({
    api: "http://127.0.0.1:3000",
    projectId: "p1",
    sessionId: "s1",
    fetchImpl: async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return {
        status: 202,
        json: async () => ({ status: "awaiting_approval", port: 0, message: "Still waiting" }),
      };
    },
  });
  const waiting = await callTool("dev_server_start", {
    command: "pyxplain-ui",
    cwd: "ui",
    port: 8000,
  });
  assert.deepEqual(bodies[0], { command: "pyxplain-ui", cwd: "ui", port: 8000, sessionId: "s1" });
  assert.equal(waiting.isError, undefined);
  assert.match(waiting.content[0].text, /^Waiting for the user to approve this dev command in ADE/);
  assert.match(waiting.content[0].text, /Still waiting/);
  await callTool("dev_server_start");
  assert.deepEqual(bodies[1], { sessionId: "s1" });
  const tools = Object.fromEntries(TOOLS.map((tool) => [tool.name, tool]));
  assert.deepEqual(Object.keys(tools.dev_server_start.inputSchema.properties), [
    "command",
    "cwd",
    "port",
  ]);
  assert.match(tools.dev_server_start.description, /ADE asks the user to approve/);
});

const SCRIPT = fileURLToPath(new URL("./computer-mcp.mjs", import.meta.url));

/** Runs the stdio server at `script` through initialize and tools/list. Stops early if it exits. */
async function handshake(script) {
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, ADE_API: "http://127.0.0.1:1", ADE_PROJECT_ID: "p1" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const responses = [];
  let buffer = "";
  const done = new Promise((resolve) => {
    child.once("exit", resolve);
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) if (line.trim()) responses.push(JSON.parse(line));
      if (responses.length >= 2) resolve();
    });
  });
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`,
  );
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
  await done;
  child.kill();
  return responses;
}

test("the stdio server answers newline-delimited JSON-RPC", async () => {
  const responses = await handshake(SCRIPT);
  assert.equal(responses[0].result.serverInfo.name, "ade-computer");
  assert.equal(responses[1].result.tools.length, TOOLS.length);
});

// A launch path that only reaches the file through a link (a symlinked install, a Windows
// junction or short name) must still start the server: Codex drops a server that exits silently.
test("the stdio server starts when launched through a symlinked path", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-mcp-link-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const link = path.join(dir, "local");
  try {
    symlinkSync(path.dirname(SCRIPT), link, "dir");
  } catch (error) {
    t.skip(`cannot create a symlink here: ${error.message}`);
    return;
  }
  const responses = await handshake(path.join(link, "computer-mcp.mjs"));
  assert.equal(responses[0]?.result.serverInfo.name, "ade-computer");
  assert.equal(responses[1]?.result.tools.length, TOOLS.length);
});
