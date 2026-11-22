// How each CLI receives ADE's agent-computer tools for one turn. `computer`
// is { node, env: { ADE_API, ADE_PROJECT_ID, ADE_SESSION_ID } } or null when
// the computer can't be offered (then nothing is added). Script paths are
// resolved here — adapters call `wireComputer` and never see mcp vs pi paths.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../computer-tool-schemas.mjs";
import { TOOLS as WORKSPACE_TOOLS } from "../workspace-tools.mjs";
import { opencodeConnectorServers, piConnectorWiring } from "./connector-wiring.mjs";

export const COMPUTER_TOOL_NAMES = TOOLS.map((tool) => tool.name);
export const WORKSPACE_TOOL_NAMES = WORKSPACE_TOOLS.map((tool) => tool.name);
const SERVER = "mcp_servers.ade_computer";
const LOCAL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Absolute path to the stdio MCP server script (Codex / OpenCode / ACP). */
export function computerMcpScript() {
  return path.join(LOCAL, "computer-mcp.mjs");
}

/** Absolute path to the Pi extension that registers computer_* tools. */
export function computerPiExtension() {
  return path.join(LOCAL, "computer-pi-extension.mjs");
}

/** Spawn extras for one turn's computer tools. @typedef {{ args?: string[], env?: Record<string, string>, mcpServers?: object[], toolNames?: string[] }} ComputerWiring */

/** Codex: `-c` overrides parsed as TOML (JSON strings/arrays are valid TOML). */
export function codexComputerArgs(computer, workspaceAssistant) {
  if (!computer && !workspaceAssistant) return [];
  const entries = computer
    ? [["ade_computer", computer.node, computerMcpScript(), computer.env]]
    : [];
  if (workspaceAssistant)
    entries.push([
      "ade_workspace",
      workspaceAssistant.node ?? process.execPath,
      path.join(LOCAL, "workspace-tools.mjs"),
      {
        ADE_WORKSPACE_TOOL_URL: workspaceAssistant.url,
        ADE_WORKSPACE_TOOL_TOKEN: workspaceAssistant.token,
        ADE_WORKSPACE_THREAD_ID: workspaceAssistant.threadId,
      },
    ]);
  return entries.flatMap(([name, node, script, serverEnv]) => {
    const server = `mcp_servers.${name}`;
    const env = Object.entries(serverEnv)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(",");
    return [
      "-c",
      `${server}.command=${JSON.stringify(node)}`,
      "-c",
      `${server}.args=${JSON.stringify([script])}`,
      "-c",
      `${server}.env={${env}}`,
      "-c",
      `${server}.default_tools_approval_mode="approve"`,
      "-c",
      `${server}.startup_timeout_sec=30`,
      "-c",
      `${server}.tool_timeout_sec=900`,
    ];
  });
}

/** ACP agents: a stdio server in session/new `mcpServers` (env as name/value pairs). */
export function acpComputerServers(computer) {
  if (!computer) return [];
  return [
    {
      name: "ade_computer",
      command: computer.node,
      args: [computerMcpScript()],
      env: Object.entries(computer.env).map(([name, value]) => ({ name, value })),
    },
  ];
}

/** OpenCode: an inline config layered on the user's own (OPENCODE_CONFIG_CONTENT). */
export function opencodeComputerEnv(
  computer,
  existing = process.env.OPENCODE_CONFIG_CONTENT,
  workspaceAssistant,
  connectors = [],
) {
  if (!computer && !workspaceAssistant && !connectors.length) return {};
  let base = {};
  try {
    const parsed = existing ? JSON.parse(existing) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) base = parsed;
  } catch {}
  const config = {
    ...base,
    mcp: {
      ...(base.mcp ?? {}),
      ...opencodeConnectorServers(connectors),
      ...(computer
        ? {
            ade_computer: {
              type: "local",
              command: [computer.node, computerMcpScript()],
              environment: computer.env,
              enabled: true,
            },
          }
        : {}),
      ...(workspaceAssistant
        ? {
            ade_workspace: {
              type: "local",
              command: [
                workspaceAssistant.node ?? process.execPath,
                path.join(LOCAL, "workspace-tools.mjs"),
              ],
              environment: {
                ADE_WORKSPACE_TOOL_URL: workspaceAssistant.url,
                ADE_WORKSPACE_TOOL_TOKEN: workspaceAssistant.token,
                ADE_WORKSPACE_THREAD_ID: workspaceAssistant.threadId,
              },
              enabled: true,
            },
          }
        : {}),
    },
  };
  return { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) };
}

/** Pi: extension path, allowlisted tool names, and env for the extension process. */
export function piComputerWiring(computer, workspaceAssistant, connectors = []) {
  if (!computer && !workspaceAssistant && !connectors.length)
    return { args: [], env: {}, toolNames: [] };
  // Connector secrets travel only as env vars the extension's config references.
  const connectorEnv = piConnectorWiring(connectors).env;
  const workspaceEnv = workspaceAssistant
    ? {
        ADE_WORKSPACE_TOOL_URL: workspaceAssistant.url,
        ADE_WORKSPACE_TOOL_TOKEN: workspaceAssistant.token,
        ADE_WORKSPACE_THREAD_ID: workspaceAssistant.threadId,
      }
    : {};
  return {
    args: ["-e", computerPiExtension()],
    env: { ...(computer?.env ?? {}), ...workspaceEnv, ...connectorEnv },
    toolNames: [
      ...(computer ? COMPUTER_TOOL_NAMES : []),
      ...(workspaceAssistant ? WORKSPACE_TOOL_NAMES : []),
    ],
  };
}
