#!/usr/bin/env node
// stdio MCP server entry for ADE's agent computer: screenshots, mouse,
// keyboard, a browser, and the project's dev server. Spawned by Codex and
// OpenCode with ADE_API (the serving ADE instance's loopback base URL) and
// ADE_PROJECT_ID in the environment. Tool definitions and call logic live
// in computer-tools-defs.mjs (shebang-free so Vite SSR can import them).
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { createToolCaller, handleMessage } from "./computer-tools-defs.mjs";

async function main() {
  const callTool = createToolCaller({
    api: (process.env.ADE_API ?? "").replace(/\/+$/, ""),
    projectId: process.env.ADE_PROJECT_ID ?? "",
  });
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`,
      );
      continue;
    }
    // Requests are answered as they finish; tool calls may run concurrently.
    handleMessage(message, callTool).then((response) => {
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
