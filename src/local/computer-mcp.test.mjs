import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

test("the stdio server answers newline-delimited JSON-RPC", async () => {
  const script = fileURLToPath(new URL("./computer-mcp.mjs", import.meta.url));
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, ADE_API: "http://127.0.0.1:1", ADE_PROJECT_ID: "p1" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const responses = [];
  let buffer = "";
  const done = new Promise((resolve) => {
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
  assert.equal(responses[0].result.serverInfo.name, "ade-computer");
  assert.equal(responses[1].result.tools.length, TOOLS.length);
});
