// Pi extension exposing ADE's agent computer. Pi has no MCP client, so ADE
// loads this with `pi -e` and adds the tool names to Pi's --tools allowlist.
// It reuses the MCP server's tool definitions and caller, so Codex, OpenCode,
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

export default async function adeComputer(pi) {
  const Type = await typebox();
  const callTool = createToolCaller({
    api: (process.env.ADE_API ?? "").replace(/\/+$/, ""),
    projectId: process.env.ADE_PROJECT_ID ?? "",
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
