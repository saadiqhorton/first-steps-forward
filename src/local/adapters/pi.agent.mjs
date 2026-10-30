import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMPUTER_TOOL_NAMES } from "./computer-tools.mjs";
import { defineCliAgent } from "./kit.mjs";
import { MANUAL_HINT } from "../models.mjs";

/** Thinking levels Pi accepts via `--thinking` (clamped per model by Pi itself). */
export const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Parse the `pi --list-models` fixed-width table.
 * Pi extensions may print banner lines before the header, so we skip until a
 * header row containing both "provider" and "model" and only then read rows
 * of 5-6 whitespace-separated columns.
 */
export function parsePiModels(stdout) {
  const lines = stdout.split(/\r?\n/);
  let headerSeen = false;
  const models = [];
  for (const line of lines) {
    const cols = line.trim().split(/\s+/).filter(Boolean);
    if (!headerSeen) {
      if (cols.includes("provider") && cols.includes("model")) headerSeen = true;
      continue;
    }
    if (cols.length < 5 || cols.length > 6) continue;
    const [provider, model, context, maxOut] = cols;
    if (!provider || !model) continue;
    const thinking = cols[4];
    const meta = [context ? `context ${context}` : "", maxOut ? `max-out ${maxOut}` : ""]
      .filter(Boolean)
      .join(" · ");
    models.push({
      id: `${provider}/${model}`,
      label: model,
      ...(meta ? { meta } : {}),
      ...(thinking === "yes" ? { efforts: [...PI_THINKING_LEVELS] } : {}),
    });
  }
  return models;
}

export const pi = defineCliAgent({
  id: "pi",
  name: "Pi Agent",
  short: "Pi",
  bin: "pi",
  order: 3,
  signIn: {
    note: "Pi currently exposes sign-in through /login in its interactive TUI; it has no supported device-login command for ADE to launch. ADE does not collect or store provider credentials.",
    command: "pi  →  /login",
  },
  harness: {
    pkg: "@earendil-works/pi-coding-agent",
    install: ["npm", ["install", "-g", "--ignore-scripts", "@earendil-works/pi-coding-agent"]],
    update: ["pi", ["update", "--self"]],
  },
  permissionNotes: {
    build: "Pi tools: read, edit, write, grep, find, ls (no shell).",
    plan: "Pi read-only tools: read, grep, find, ls.",
  },
  notes: { effort: "Pi clamps the level to what the model supports." },
  authMethod: "Pi's /login command",
  authNote:
    "Pi provides /login inside its interactive TUI; it does not expose a supported browser/device login command for this UI. Sign in with `pi`, then choose /login.",
  installHint: "Install from https://pi.dev/",
  tools: "read, edit, write, grep, find, ls (no shell), plus ADE's agent computer tools",
  /**
   * Pi is multi-provider. Probe credential-store provider names (never
   * inspect or log credential values), falling back to known names when the
   * store is unavailable. Only `pi auth check` confirms READY status; the
   * model catalog is separate and can list providers without ready auth.
   */
  async detectAuth(run) {
    let candidates = ["openai-codex", "openai", "anthropic", "google", "opencode-go"];
    try {
      const store = JSON.parse(
        await fsp.readFile(path.join(os.homedir(), ".pi", "agent", "auth.json"), "utf8"),
      );
      const configured = Object.keys(store ?? {}).filter(Boolean);
      if (configured.length) candidates = configured;
    } catch {}
    const ready = [];
    await Promise.all(
      candidates.map(async (provider) => {
        const result = await run(
          "pi",
          ["auth", "check", "--provider", provider, "--json", "--no-refresh"],
          {
            timeout: 7000,
          },
        );
        try {
          if (JSON.parse(result.stdout).status === "ready") ready.push(provider);
        } catch {}
      }),
    );
    ready.sort();
    if (!ready.length) return { signedIn: false };
    return {
      signedIn: true,
      providers: ready,
      // Keep original provider IDs for Pi's CLI, but never put control
      // characters or arbitrarily long store keys into the manifest/UI.
      account: `${ready.length} READY ${ready.length === 1 ? "provider" : "providers"}: ${ready.map((name) => (/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name) ? name : "(unusual provider name)")).join(", ")}`,
    };
  },
  /** The CLI's own cached model listing; never a network refresh, never quota. */
  async probeModels(run) {
    // Extensions stay enabled: providers can be registered by packages
    // (e.g. pi-ollama-cloud registers the ollama-cloud provider), so
    // stripping them here would hide models the agent can actually use.
    // --offline only blocks forced network refreshes, matching the other
    // CLI probes.
    const result = await run("pi", ["--offline", "--list-models"], {
      timeout: 20000,
    });
    if (result.code === 127)
      return { available: false, reason: "not-installed", hint: MANUAL_HINT };
    if (result.code !== 0) return { available: false, reason: "cli-failed", hint: MANUAL_HINT };
    const models = parsePiModels(result.stdout);
    if (!models.length)
      return {
        available: false,
        reason: "no-providers-configured",
        hint:
          "Pi's cached model catalog has no models to list. This does not indicate whether any provider is READY. " +
          MANUAL_HINT.toLowerCase(),
      };
    return {
      available: true,
      models,
      source: "live",
      command: "pi --offline --list-models",
      note: "Pi's cached model catalog (no quota used) can list models from providers that are not READY for Pi. The READY provider count shown by ADE comes from Pi's auth check, not this model list. A listed model is not a guarantee of entitlement.",
    };
  },
  // Pi keeps each conversation in a session file under ADE's data folder.
  async prepare({ dataDir }) {
    await fsp.mkdir(path.join(dataDir, "sessions"), { recursive: true, mode: 0o700 });
  },
  command({
    prompt,
    session,
    continuing,
    dataDir,
    providers,
    model,
    effort,
    permission,
    attachments,
    computer,
  }) {
    const sessionFile = `${dataDir}/sessions/${session.agentSessionKey ?? session.id}.jsonl`;
    const fileTools = permission === "plan" ? "read,grep,find,ls" : "read,edit,write,grep,find,ls";
    // Pi has no MCP client: ADE's agent computer arrives as a Pi extension
    // (-e) with its tool names added to the allowlist.
    const tools = [fileTools, ...(computer ? COMPUTER_TOOL_NAMES : [])].join(",");
    return [
      "pi",
      [
        "-p",
        "--mode",
        "json",
        ...(computer ? ["-e", computer.piExtension] : []),
        // Extensions stay enabled so package-registered providers (e.g.
        // ollama-cloud via pi-ollama-cloud) resolve for a picked model. The
        // --tools allowlist below still sandboxes the run: other extension
        // tools (web search, subagents, shell) are never granted.
        "--tools",
        tools,
        // A `provider/model` id embeds the provider, so --model wins outright.
        // With exactly one ready provider, pin it so Pi's own default can't
        // resolve to something unauthenticated. With several, stay out of the
        // way: Pi resolves its own default across the providers the user set
        // up, and the model picker can always name an explicit provider/model.
        ...(model
          ? ["--model", model]
          : providers?.length === 1
            ? ["--provider", providers[0]]
            : []),
        ...(effort ? ["--thinking", effort] : []),
        "--session",
        sessionFile,
        ...(continuing ? ["--continue"] : []),
        ...(attachments ?? []).map((a) => `@${a.path}`),
        prompt,
      ],
      computer ? computer.env : {},
    ];
  },
  parse(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return [{ type: "text", text: line }];
    }
    if (event.type === "text" && event.text) return [{ type: "text", text: event.text }];
    // Pi emits message_end for the system preamble and the user's own prompt
    // too. Only assistant messages are agent output — reporting the prompt
    // back would fabricate a reply the agent never produced.
    if (event.type === "message_end" && event.message?.role === "assistant") {
      const text = (event.message.content ?? [])
        .filter?.((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      return [{ type: "text", text: text ?? "" }];
    }
    // Print mode's JSON path always exits 0, even when every retry failed and
    // the run produced no answer. `agent_end` with willRetry === false is the
    // settled point, so the last assistant message's error is the only
    // failure signal ADE gets. A fatal error makes the turn end blocked
    // instead of "ready to review" with no work done.
    if (event.type === "agent_end" && event.willRetry === false) {
      const last = [...(event.messages ?? [])].reverse().find((m) => m.role === "assistant");
      if (last?.stopReason === "error")
        return [
          {
            type: "error",
            text: last.errorMessage || "Pi reported an error and stopped.",
            fatal: true,
          },
        ];
    }
    return [];
  },
});
