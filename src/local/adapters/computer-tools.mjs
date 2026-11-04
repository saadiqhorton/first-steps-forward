// How each CLI receives ADE's agent-computer tools for one turn. `computer`
// is { node, mcpScript, piExtension, env: { ADE_API, ADE_PROJECT_ID, ADE_SESSION_ID } } or
// null when the computer can't be offered (then nothing is added).
import { TOOLS } from "../computer-tools-defs.mjs";

export const COMPUTER_TOOL_NAMES = TOOLS.map((tool) => tool.name);
const SERVER = "mcp_servers.ade_computer";

/** Codex: `-c` overrides parsed as TOML (JSON strings/arrays are valid TOML). */
export function codexComputerArgs(computer) {
  if (!computer) return [];
  const env = Object.entries(computer.env)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(",");
  return [
    "-c",
    `${SERVER}.command=${JSON.stringify(computer.node)}`,
    "-c",
    `${SERVER}.args=${JSON.stringify([computer.mcpScript])}`,
    "-c",
    `${SERVER}.env={${env}}`,
    // `codex exec` runs with approval policy "never", which denies every MCP
    // tool call that would need a prompt. Pre-approve only this server's
    // tools; Codex's global approval policy and shell sandbox are unchanged.
    "-c",
    `${SERVER}.default_tools_approval_mode="approve"`,
    "-c",
    `${SERVER}.startup_timeout_sec=30`,
    // The first call may download the browser and launch it.
    "-c",
    `${SERVER}.tool_timeout_sec=900`,
  ];
}

/** ACP agents: a stdio server in session/new `mcpServers` (env as name/value pairs). */
export function acpComputerServers(computer) {
  if (!computer) return [];
  return [
    {
      name: "ade_computer",
      command: computer.node,
      args: [computer.mcpScript],
      env: Object.entries(computer.env).map(([name, value]) => ({ name, value })),
    },
  ];
}

/** OpenCode: an inline config layered on the user's own (OPENCODE_CONFIG_CONTENT). */
export function opencodeComputerEnv(computer, existing = process.env.OPENCODE_CONFIG_CONTENT) {
  if (!computer) return {};
  let base = {};
  try {
    const parsed = existing ? JSON.parse(existing) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) base = parsed;
  } catch {}
  const config = {
    ...base,
    mcp: {
      ...(base.mcp ?? {}),
      ade_computer: {
        type: "local",
        command: [computer.node, computer.mcpScript],
        environment: computer.env,
        enabled: true,
      },
    },
  };
  return { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) };
}
