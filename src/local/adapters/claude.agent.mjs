// Claude Code over ACP. The user's own `claude` is what ADE detects, signs in
// with and runs; ACP comes from @agentclientprotocol/claude-agent-acp (the
// renamed @zed-industries/claude-code-acp), a bridge ADE sets up itself (see
// ../acp-bridge.mjs). The turn itself runs in ../acp.mjs; this preset only
// says how to launch it and what to ask for.
import { acpComputerServers } from "./computer-tools.mjs";
import { defineAcpAgent } from "./kit.mjs";

/** @param {import("./kit.mjs").ComputerContext | null} computer */
function wireComputer(computer) {
  return { mcpServers: acpComputerServers(computer) };
}

export const claude = defineAcpAgent({
  id: "claude",
  name: "Claude Code",
  short: "Claude",
  bin: "claude",
  order: 4,
  wireComputer,
  signIn: {
    note: "Claude Code signs in through its own CLI, which opens a browser. Run this in a terminal; if you already use Claude Code here, you are probably signed in already. Credentials stay in Claude Code's own store.",
    command: "claude auth login",
  },
  // Claude Code's documented npm update is a reinstall at @latest. Its
  // native installer updates itself, so ADE flags no update for it
  // (selfUpdates); the ACP bridge is ADE's own (acp-bridge.mjs).
  harness: {
    pkg: "@anthropic-ai/claude-code",
    install: ["npm", ["install", "-g", "@anthropic-ai/claude-code"]],
    update: ["npm", ["install", "-g", "@anthropic-ai/claude-code@latest"]],
    selfUpdates: true,
  },
  permissionNotes: {
    build: "Claude Code accepts file edits; shell commands and other actions ask you in ADE first.",
    plan: "Claude Code plan mode: reads and plans, no edits. ADE declines any request to edit, run commands, or leave plan mode.",
  },
  // ADE installs this pinned version under ~/.ade the first time Claude runs.
  bridge: {
    pkg: "@agentclientprotocol/claude-agent-acp",
    version: "0.99.0",
    bin: "claude-agent-acp",
    entry: "dist/index.js",
  },
  authMethod: "Claude subscription or API key, through Claude Code's own sign-in",
  authNote:
    "ADE runs your installed Claude Code (through its ACP bridge, claude-agent-acp, which ADE sets up on first use), so your existing Claude Code sign-in is used. Sign in with `claude auth login` in a terminal; ADE never collects tokens.",
  installHint: "Install Claude Code from https://code.claude.com/docs/en/setup",
  tools:
    "Claude Code tools: Build accepts file edits and asks you in ADE before shell commands and other actions; Plan is read-only. Plus ADE's agent computer tools",
  // ADE permission → Claude Code permission modes, first one offered wins.
  modes: { build: ["acceptEdits"], plan: ["plan"] },
  async detectAuth(run) {
    const result = await run("claude", ["auth", "status", "--json"], { timeout: 10000 });
    let status;
    try {
      status = JSON.parse(result.stdout);
    } catch {
      return { signedIn: false };
    }
    if (status?.loggedIn !== true) return { signedIn: false };
    const method =
      typeof status.authMethod === "string" && /^[A-Za-z0-9._ -]{1,40}$/.test(status.authMethod)
        ? ` (${status.authMethod})`
        : "";
    return { signedIn: true, account: `Claude Code account${method}` };
  },
  /**
   * `bridge` is the resolved [bin, args] for claude-agent-acp, `executable`
   * the user's `claude`. Everything per turn (cwd, MCP servers, mode, model,
   * prompt) goes over ACP.
   */
  command({ bridge, executable }) {
    // Without this the bridge would run the Claude Code binary it bundles.
    return [bridge[0], bridge[1], { CLAUDE_CODE_EXECUTABLE: executable }];
  },
  /**
   * `_meta.claudeCode.options` on session/new and resume: Claude Agent SDK
   * options. `ephemeral` is the model-list session, which is never prompted:
   * it leaves no transcript or memory folder under ~/.claude/projects.
   */
  sessionMeta({ computer, ephemeral = false }) {
    return {
      claudeCode: {
        options: {
          // Never offer the mode that skips every approval.
          allowDangerouslySkipPermissions: false,
          // ADE's own browser tools run without a prompt, like Codex's
          // default_tools_approval_mode="approve" for that one server.
          ...(computer ? { allowedTools: ["mcp__ade_computer"] } : {}),
          ...(ephemeral ? { persistSession: false, settings: { autoMemoryEnabled: false } } : {}),
        },
      },
    };
  },
});
