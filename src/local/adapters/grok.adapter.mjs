// Grok Build speaks ACP itself; no bridge or shell is needed. This module is
// kept out of automatic registration until ADE supports Grok's ACP model
// dialect (its model list is in initialize._meta.modelState).
import { defineAcpAgent } from "./kit.mjs";
import { acpComputerServers } from "./computer-tools.mjs";
import { MODEL_ID } from "../models.mjs";

// Grok's public source prints these exact banners in `grok models`:
// https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/src/models.rs
export function grokAuthenticated(output) {
  return /^(?:You are logged in with .+\.|You are using XAI_API_KEY\.|You are authenticated via deployment key\.|Model '.+' is using its own API key\.)\s*$/m.test(
    output ?? "",
  );
}

export function parseGrokModels(output) {
  const lines = String(output ?? "").split(/\r?\n/);
  const index = lines.findIndex((line) => /^Available models:\s*$/.test(line));
  if (index < 0) return null;
  const models = [];
  for (const line of lines.slice(index + 1)) {
    const match = /^\s+[*-]\s+(\S+)(?:\s+\(default\))?\s*$/.exec(line);
    if (!match) {
      if (line.trim()) break;
      continue;
    }
    if (MODEL_ID.test(match[1])) models.push({ id: match[1] });
  }
  return models;
}

const agent = defineAcpAgent({
  id: "grok",
  name: "Grok Build",
  short: "Grok",
  bin: "grok",
  order: 3,
  signIn: {
    note: "Grok Build signs in through its own browser or device flow. Credentials stay with Grok.",
    command: "grok login",
    device: ["grok", ["login", "--device-auth"]],
    waiting: "Waiting for Grok device sign-in… finish in your browser.",
  },
  harness: {
    pkg: "@xai-official/grok",
    install: ["npm", ["install", "-g", "@xai-official/grok"]],
    update: ["npm", ["install", "-g", "@xai-official/grok@latest"]],
    selfUpdates: true,
  },
  permissionNotes: {
    build: "Grok runs with its configured permissions and asks about actions in ADE.",
    plan: "Grok plans without making changes; ADE declines edit and command requests.",
  },
  authMethod: "Grok account or xAI API key",
  authNote: "Grok uses its own sign-in or XAI_API_KEY. ADE does not collect credentials.",
  installHint: "Install Grok Build from https://docs.x.ai/build/overview",
  tools: "Grok Build tools and ADE's agent computer tools",
  modes: { build: ["default"], plan: ["plan"] },
  // Grok supports session/set_mode but does not consistently advertise modes.
  // A rejected call aborts the turn before the prompt.
  unadvertisedModes: true,
  acpAuth: () => ({
    methods: process.env.XAI_API_KEY ? ["xai.api_key", "cached_token"] : ["cached_token"],
    meta: { headless: true },
    missingMessage: "Run `grok login` first, or set XAI_API_KEY.",
  }),
  wireComputer(computer) {
    return { mcpServers: acpComputerServers(computer) };
  },
  async detectAuth(run) {
    let result = await run("grok", ["models"], { timeout: 15000 });
    // Grok prints this status before its model fetch refreshes expired tokens.
    // A second probe observes a successful refresh without reading credentials.
    if (result.code === 0 && /^You are not authenticated\./m.test(result.stdout ?? ""))
      result = await run("grok", ["models"], { timeout: 15000 });
    const signedIn = result.code === 0 && grokAuthenticated(result.stdout);
    return { signedIn, ...(signedIn ? { account: "Grok account" } : {}) };
  },
  command() {
    return ["grok", ["agent", "stdio"]];
  },
});

export const grok = agent;
