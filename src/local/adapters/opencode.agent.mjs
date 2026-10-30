import { opencodeComputerEnv } from "./computer-tools.mjs";
import { defineCliAgent } from "./kit.mjs";
import { MANUAL_HINT } from "../models.mjs";

/** Parse `opencode models` plain lines of `provider/model`. */
export function parseOpencodeModels(stdout) {
  const ids = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/\s/.test(line) && line.includes("/"));
  return ids.length ? ids.map((id) => ({ id })) : [];
}

/**
 * Parse `opencode models --verbose`: each `provider/model` line followed by a
 * JSON object. Returns null when the stream cannot be parsed as that shape.
 */
export function parseOpencodeVerboseModels(stdout) {
  if (typeof stdout !== "string" || !stdout.trim()) return null;
  const lines = stdout.split(/\r?\n/);
  const models = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    i += 1;
    if (!line) continue;
    if (/\s/.test(line) || !line.includes("/")) return null;
    while (i < lines.length && !lines[i].trim()) i += 1;
    if (i >= lines.length || lines[i].trim()[0] !== "{") return null;
    let depth = 0;
    let json = "";
    for (; i < lines.length; i += 1) {
      const raw = lines[i];
      json += (json ? "\n" : "") + raw;
      for (const ch of raw) {
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
      }
      if (depth === 0) {
        i += 1;
        break;
      }
    }
    if (depth !== 0) return null;
    let meta;
    try {
      meta = JSON.parse(json);
    } catch {
      return null;
    }
    const variants = meta?.variants;
    const efforts =
      variants && typeof variants === "object" && !Array.isArray(variants)
        ? Object.keys(variants)
        : [];
    models.push({ id: line, efforts });
  }
  return models.length ? models : null;
}

export const opencode = defineCliAgent({
  id: "opencode",
  name: "OpenCode",
  short: "OpenCode",
  bin: "opencode",
  order: 2,
  signIn: {
    note: "OpenCode's provider selector requires an interactive terminal. ADE cannot safely fake or capture its OAuth login; credentials are kept in OpenCode's user-level store.",
    command: "opencode auth login",
  },
  harness: {
    pkg: "opencode-ai",
    install: ["npm", ["install", "-g", "opencode-ai"]],
    update: ["opencode", ["upgrade", "--method", "npm"]],
  },
  permissionNotes: {
    build: "Make changes using your configured OpenCode permissions.",
    plan: "OpenCode plan agent: file edits and shell commands need approval, which ADE's non-interactive runs decline.",
  },
  notes: { speed: "OpenCode has no speed setting." },
  authMethod: "Provider sign-in through OpenCode CLI",
  authNote:
    "OpenCode stores provider credentials in its own user-level credential store. OAuth options depend on the provider; OpenCode Go may require its provider credential.",
  installHint: "Install from https://opencode.ai/download",
  tools: "OpenCode built-in tools; permission prompts are auto-rejected in non-interactive runs",
  async detectAuth(run) {
    const result = await run("opencode", ["auth", "list"], { timeout: 7000 });
    const signedIn =
      /credentials|credentials configured|\u25cf/i.test(result.stdout) &&
      !/0 credentials/i.test(result.stdout);
    return { signedIn, ...(signedIn ? { account: "Configured in OpenCode" } : {}) };
  },
  /** The CLI's own cached model listing; never a network refresh, never quota. */
  async probeModels(run) {
    // Never pass --refresh here: that is an opt-in network refresh elsewhere.
    // Prefer --verbose so variant keys become efforts; fall back to plain lines.
    // Large OpenRouter catalogs can take well over 20s; keep the budget generous
    // so a mid-list kill cannot stick a truncated catalog in the file cache.
    let result = await run("opencode", ["models", "--verbose"], { timeout: 60000 });
    if (result.code === 127)
      return { available: false, reason: "not-installed", hint: MANUAL_HINT };
    let verboseModels = null;
    if (result.code === 0) {
      verboseModels = parseOpencodeVerboseModels(result.stdout);
      if (verboseModels !== null && !verboseModels.length)
        return {
          available: false,
          reason: "no-providers-configured",
          hint:
            "OpenCode lists only models from providers configured in its own auth store. Run `opencode auth login` in a terminal, or " +
            MANUAL_HINT.toLowerCase(),
        };
    }
    result = await run("opencode", ["models"], { timeout: 60000 });
    if (result.code === 127)
      return { available: false, reason: "not-installed", hint: MANUAL_HINT };
    if (result.code !== 0) {
      if (verboseModels?.length)
        return {
          available: true,
          models: verboseModels,
          source: "live",
          command: "opencode models --verbose",
        };
      return { available: false, reason: "cli-failed", hint: MANUAL_HINT };
    }
    const plainModels = parseOpencodeModels(result.stdout);
    if (!plainModels.length && !verboseModels?.length)
      return {
        available: false,
        reason: "no-providers-configured",
        hint:
          "OpenCode lists only models from providers configured in its own auth store. Run `opencode auth login` in a terminal, or " +
          MANUAL_HINT.toLowerCase(),
      };
    // Cross-check: an incomplete verbose stream can still parse (exit 0 with a
    // short list). Prefer the complete plain id set and keep efforts from verbose.
    if (verboseModels?.length && verboseModels.length >= plainModels.length)
      return {
        available: true,
        models: verboseModels,
        source: "live",
        command: "opencode models --verbose",
      };
    if (verboseModels?.length) {
      const effortsById = new Map(verboseModels.map((m) => [m.id, m.efforts]));
      return {
        available: true,
        models: plainModels.map((m) => {
          const efforts = effortsById.get(m.id);
          return efforts ? { id: m.id, efforts } : m;
        }),
        source: "live",
        command: "opencode models",
      };
    }
    return { available: true, models: plainModels, source: "live", command: "opencode models" };
  },
  command({
    projectPath,
    prompt,
    session,
    continuing,
    model,
    effort,
    permission,
    attachments,
    computer,
  }) {
    // Third element: extra environment (the agent computer's MCP server).
    const fileArgs = (attachments ?? []).flatMap((a) => ["--file", a.path]);
    return [
      "opencode",
      [
        "run",
        "--format",
        "json",
        // `opencode run` has no --dir/--cwd option (only `attach` does), and
        // unknown flags make it print usage and exit 1 without sending the
        // prompt. The project is selected by the process working directory,
        // which ADE sets when it spawns the CLI.
        // `-m provider/model` also works with `--session` continuation.
        ...(model ? ["-m", model] : []),
        ...(effort ? ["--variant", effort] : []),
        // Build is OpenCode's default primary agent; only pass --agent for plan.
        ...(permission === "plan" ? ["--agent", "plan"] : []),
        ...(continuing && session.agentSessionId ? ["--session", session.agentSessionId] : []),
        ...fileArgs,
        prompt,
      ],
      opencodeComputerEnv(computer),
    ];
  },
  parse(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return [];
    }
    const events = event.sessionID ? [{ type: "conversation", id: event.sessionID }] : [];
    if (event.type === "text" && event.part?.text)
      events.push({ type: "text", text: event.part.text });
    if (event.type === "error")
      events.push({ type: "error", text: event.error?.message ?? "OpenCode reported an error." });
    return events;
  },
  // `opencode run` cannot ask: it rejects a permission request on its own
  // and says so on stderr. Tell the user what happened.
  stderr(line) {
    const permission = line.match(/permission requested: (.*?); auto-rejecting/i);
    return permission
      ? [
          {
            type: "notice",
            text: `OpenCode requested permission for ${permission[1]}; its non-interactive CLI rejected the request. ADE did not approve or run that action.`,
          },
        ]
      : [];
  },
});
