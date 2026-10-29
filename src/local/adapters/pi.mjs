import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMPUTER_TOOL_NAMES } from "./computer-tools.mjs";
import { defineCliAgent } from "./kit.mjs";

export const pi = defineCliAgent({
  id: "pi",
  name: "Pi Agent",
  short: "Pi",
  bin: "pi",
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
    const sessionFile = `${dataDir}/sessions/${session.id}.jsonl`;
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
