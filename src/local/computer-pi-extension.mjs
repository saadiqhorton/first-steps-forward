// Pi extension exposing ADE's agent computer and the user's connectors. ADE
// loads it with `pi -e` and adds the computer tool names to Pi's --tools
// allowlist. Connectors are MCP servers registered with Pi's built-in MCP
// client (pi.registerMcpServer); secrets arrive only as env vars that the
// registered config references as ${NAME}. The computer tools reuse the MCP server's tool definitions and caller, so Codex, OpenCode,
// and Pi drive the computer through exactly the same ADE endpoints. Pi tool
// results use the same {type: "text"|"image"} content blocks as MCP.
import { createToolCaller, TOOLS } from "./computer-tools-defs.mjs";

export const PI_TOOL_NAMES = TOOLS.map((tool) => tool.name);

async function typebox() {
  for (const name of ["typebox", "@sinclair/typebox"]) {
    try {
      return (await import(name)).Type;
    } catch {}
  }
  return null;
}

/** Connector entries from ADE_CONNECTORS (references only, no secrets). */
export function connectorServers(raw = process.env.ADE_CONNECTORS) {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((item) => item && typeof item.name === "string") : [];
  } catch {
    return [];
  }
}

export function registerConnectors(pi, servers = connectorServers()) {
  if (typeof pi.registerMcpServer !== "function") return [];
  const registered = [];
  for (const { name, ...config } of servers) {
    try {
      // "direct": the tools are declared to the model, which --tools leaves alone for MCP.
      pi.registerMcpServer(name, { ...config, exposure: "direct", timeout: 300 });
      registered.push(name);
    } catch {}
  }
  return registered;
}

export default async function adeComputer(pi) {
  registerConnectors(pi);
  // Connectors-only turns carry no computer; its tools are registered only with one.
  if (!process.env.ADE_API) return;
  const Type = await typebox();
  const callTool = createToolCaller({
    api: (process.env.ADE_API ?? "").replace(/\/+$/, ""),
    projectId: process.env.ADE_PROJECT_ID ?? "",
    sessionId: process.env.ADE_SESSION_ID ?? "",
  });
  for (const tool of TOOLS) {
    pi.registerTool({
      name: tool.name,
      label: tool.name.replace(/_/g, " "),
      description: tool.description,
      // Type.Unsafe keeps the plain JSON Schema while satisfying TypeBox.
      parameters: Type ? Type.Unsafe(tool.inputSchema) : tool.inputSchema,
      async execute(_toolCallId, params) {
        const result = await callTool(tool.name, params ?? {});
        // Pi reports a tool failure when execute throws.
        if (result.isError) throw new Error(result.content.map((c) => c.text ?? "").join("\n"));
        return { content: result.content, details: {} };
      },
    });
  }
}
