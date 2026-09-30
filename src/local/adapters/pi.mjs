import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";

export const pi = {
  id: "pi",
  name: "Pi Agent",
  short: "Pi",
  bin: "pi",
  authMethod: "Pi's /login command",
  authNote:
    "Pi provides /login inside its interactive TUI; it does not expose a supported browser/device login command for this UI. Sign in with `pi`, then choose /login.",
  installHint: "Install from https://pi.dev/",
  tools: "read, edit, write, grep, find, ls (no shell)",
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
  command({ prompt, session, continuing, dataDir, providers, model, effort, permission }) {
    const sessionFile = `${dataDir}/sessions/${session.id}.jsonl`;
    const tools = permission === "plan" ? "read,grep,find,ls" : "read,edit,write,grep,find,ls";
    return [
      "pi",
      [
        "-p",
        "--mode",
        "json",
        // Extensions stay enabled so package-registered providers (e.g.
        // ollama-cloud via pi-ollama-cloud) resolve for a picked model. The
        // --tools allowlist below still sandboxes the run: extension tools
        // (web search, subagents, shell) are never granted.
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
        prompt,
      ],
    ];
  },
  parse(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return { text: line };
    }
    if (event.type === "text" && event.text) return { text: event.text };
    if (event.type === "message_end" && event.message?.content) {
      const text = event.message.content
        .filter?.((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      return { text: text ?? "" };
    }
    return {};
  },
};
