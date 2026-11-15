// Muse's native ACP adapter. Kept out of adapter auto-discovery until ADE can
// represent its platform-specific, user-managed installation in the UI.
import os from "node:os";
import { createRpc } from "../acp.mjs";
import { spawnCommand } from "../spawn.mjs";
import { acpComputerServers } from "./computer-tools.mjs";
import { defineAcpAgent } from "./kit.mjs";

/**
 * Probe ACP itself, without starting login or sending a prompt. A successful
 * ephemeral session is the only reliable proof that this provider can open a
 * session: an API key accepted by MSP is not necessarily accepted by ACP.
 */
export async function probeMuseAuth(spawn = spawnCommand) {
  const child = spawn("muse", ["acp", "--no-session-log"], {
    cwd: os.tmpdir(),
    env: { ...process.env, MUSE_LOGIN: "0" },
    stdio: ["pipe", "pipe", "ignore"],
    shell: false,
  });
  const rpc = createRpc(child.stdout, child.stdin, {
    onRequest: async () => {
      throw new Error("Unexpected request");
    },
  });
  child.on("error", (err) => rpc.close(err));
  child.on("close", () => rpc.close(new Error("Muse exited")));
  const timer = setTimeout(() => rpc.close(new Error("Muse auth check timed out")), 10000);
  try {
    await rpc.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "ade", version: "1" },
    });
    await rpc.request("session/new", { cwd: os.tmpdir(), mcpServers: [] });
    return { signedIn: true, account: "Muse Code account" };
  } catch {
    return { signedIn: false };
  } finally {
    clearTimeout(timer);
    child.stdin.end();
    child.kill();
  }
}

/**
 * The host supplies install metadata once ADE supports a manual install link.
 * Never register this draft with an npm package or a pretend installer.
 */
export function createMuseAdapter(harness) {
  return defineAcpAgent({
    id: "muse",
    name: "Muse Code",
    short: "Muse",
    bin: "muse",
    order: 5,
    harness,
    signIn: { note: "Muse Code signs in in your terminal and browser.", command: "muse login" },
    authMethod: "Muse Code account",
    authNote: "Muse Code uses its own account login; ADE never collects credentials.",
    installHint: "Install Muse Code from https://dev.meta.ai/docs/muse-code",
    tools: "Muse Code tools under its own sandbox, with permission requests shown in ADE.",
    permissions: ["manual", "build", "deny"],
    permissionLabels: {
      manual: "Ask before unmatched actions",
      build: "Ask on request",
      deny: "Deny unmatched actions",
    },
    permissionNotes: {
      manual: "Muse asks before actions that do not match a permission rule.",
      build: "Muse asks when an action requires approval.",
      deny: "Muse refuses actions that do not match a permission rule.",
      plan: "Muse Code does not offer a read-only plan mode over ACP.",
    },
    modes: { manual: ["promptUnmatched"], build: ["onRequest"], deny: ["denyUnmatched"], plan: [] },
    wireComputer: (computer) => ({ mcpServers: acpComputerServers(computer) }),
    detectAuth() {
      return probeMuseAuth();
    },
    command({ ephemeral = false } = {}) {
      return ["muse", ["acp", ...(ephemeral ? ["--no-session-log"] : [])], { MUSE_LOGIN: "0" }];
    },
  });
}
