import { acpComputerServers, opencodeComputerEnv } from "./computer-tools.mjs";
import { defineAcpAgent, defineCliAgent } from "./kit.mjs";
import { MANUAL_HINT } from "../models.mjs";

/** @param {import("./kit.mjs").ComputerContext | null} computer */
function wireComputer(computer, workspaceAssistant = null, connectors = []) {
  return { env: opencodeComputerEnv(computer, undefined, workspaceAssistant, connectors) };
}

/**
 * Parse `opencode auth list --format json` (OpenCode 2.x): the integrations
 * configured in its store, each with its connections. Returns null when the
 * stream is not that shape, so the caller can fall back to the text table.
 * Credential values are never present in this output and are never read here.
 */
export function parseOpencodeAuthJson(stdout) {
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const entries = data.filter(
    (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
  );
  if (entries.length !== data.length) return null;
  // A store entry only counts when it actually carries a connection; an
  // integration listed with an empty `connections` array is not signed in.
  const reportsConnections = entries.some((entry) => Array.isArray(entry.connections));
  if (!reportsConnections) return { signedIn: entries.length > 0, providers: [] };
  const providers = [];
  for (const entry of entries) {
    if (!Array.isArray(entry.connections) || entry.connections.length === 0) continue;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (id) providers.push(id);
  }
  return { signedIn: providers.length > 0, providers };
}

/**
 * Parse the human-readable `opencode auth list` table. Handles the 2.x rows
 * (`Provider  Connection  stored`) and the 1.x box (`● Anthropic oauth`,
 * `└ 2 credentials`). The footer's own count is authoritative when present so
 * a header that merely says "Credentials" is never read as a sign-in.
 */
export function parseOpencodeAuthText(stdout) {
  const text = typeof stdout === "string" ? stdout : "";
  if (/no authenticated integrations/i.test(text)) return false;
  const counts = [...text.matchAll(/\b(\d+)\s+credentials?\b/gi)].map((match) => Number(match[1]));
  if (counts.length) return counts.some((count) => count > 0);
  if (/^\s*\S.*\s{2,}stored\s*$/im.test(text)) return true;
  return /^\s*[\u25cf\u25c6\u25aa\u2022]\s*\S/m.test(text);
}

/** Provider ids stay readable in the UI; odd ones are labelled, never echoed raw. */
function providerLabel(id) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id) ? id : "(unusual provider name)";
}

/** @param {{ signedIn: boolean, providers: string[] }} parsed */
function authResult(parsed) {
  if (!parsed.signedIn) return { signedIn: false };
  const providers = parsed.providers.filter(Boolean).slice(0, 50);
  if (!providers.length) return { signedIn: true, account: "Configured in OpenCode" };
  return {
    signedIn: true,
    providers,
    account: `${providers.length} ${providers.length === 1 ? "provider" : "providers"}: ${providers.map(providerLabel).join(", ")}`,
  };
}

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

const run = defineCliAgent({
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
    update: ["npm", ["install", "-g", "opencode-ai@latest"]],
    brews: [{ kind: "formula", name: "opencode" }],
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
  wireComputer,
  async detectAuth(run) {
    // 2.x offers a machine-readable listing; 1.x rejects the flag, so fall
    // back to its table. Both are the CLI's own supported read-only flow, and
    // neither prints a credential value.
    const json = await run("opencode", ["auth", "list", "--format", "json"], {
      timeout: 10000,
    });
    if (json.code === 0) {
      const parsed = parseOpencodeAuthJson(json.stdout);
      if (parsed) return authResult(parsed);
    }
    const result = await run("opencode", ["auth", "list"], { timeout: 10000 });
    const signedIn = result.code === 0 && parseOpencodeAuthText(result.stdout);
    return signedIn ? { signedIn: true, account: "Configured in OpenCode" } : { signedIn: false };
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
    version,
    permission,
    attachments,
    computer,
    workspaceAssistant,
    connectors,
  }) {
    // Third element: extra environment (the agent computer's MCP server).
    const fileArgs = (attachments ?? []).flatMap((a) => ["--file", a.path]);
    const { env: computerEnv = {} } = wireComputer(computer, workspaceAssistant, connectors);
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
        ...(model
          ? ["-m", effort && Number.parseInt(version, 10) >= 2 ? `${model}#${effort}` : model]
          : []),
        ...(effort && !(Number.parseInt(version, 10) >= 2) ? ["--variant", effort] : []),
        // Build is OpenCode's default primary agent; only pass --agent for plan.
        ...(permission === "plan" ? ["--agent", "plan"] : []),
        ...(continuing && session.agentSessionId ? ["--session", session.agentSessionId] : []),
        ...fileArgs,
        prompt,
      ],
      computerEnv,
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

/** OpenCode versions whose ACP server could not take a turn; they are not asked again. */
const withoutAcp = new Set();

const rejectionNotice = (what) =>
  `OpenCode requested permission for ${what}; ADE's OpenCode runs are non-interactive, so it was rejected. ADE did not approve or run that action.`;

const acp = defineAcpAgent({
  ...run,
  command: () => ["opencode", ["acp"]],
  wireComputer: (computer) => ({ mcpServers: acpComputerServers(computer) }),
  modes: { build: ["build"], plan: ["plan"] },
  // Build is whichever agent the user's own configuration starts; only leave plan for it.
  keepMode: (current, permission) => permission !== "plan" && current !== "plan",
  // The model list comes from `opencode models`.
  rememberModels: false,
  // As with `opencode run`: nothing is approved on the user's behalf, and they are told.
  answer(request, io) {
    io.emit({ type: "notice", text: rejectionNotice(request.title) });
    const reject =
      request.options.find((option) => option.kind === "reject_once") ??
      request.options.find((option) => option.kind === "reject_always");
    return reject ? { outcome: "selected", optionId: reject.optionId } : { outcome: "cancelled" };
  },
  fallback(input, io, error) {
    // Method not found, or it exited instead of answering: this version has no such server.
    if (error?.code === -32601 || /exited|failed to start/.test(error?.message ?? ""))
      withoutAcp.add(input.version);
    io.emit({
      type: "log",
      line: `OpenCode's ACP server could not take this turn (${error?.message ?? error}); running opencode run, which shows the reply when it is finished.`,
    });
    return run.runTurn(input, io);
  },
});

export const opencode = {
  ...run,
  /**
   * OpenCode 2 streams its reply over ACP. `opencode run` prints it once it is finished.
   * Files other than images have a native form only there.
   * @param {import("./kit.mjs").TurnInput} input @param {import("./kit.mjs").TurnIO} io
   */
  runTurn(input, io) {
    const streams =
      Number.parseInt(input.version, 10) >= 2 &&
      !withoutAcp.has(input.version) &&
      input.attachments.every((file) => file.kind === "image");
    return streams ? acp.runTurn(input, io) : run.runTurn(input, io);
  },
};
