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
  tools: "read, edit, write, grep, find, ls (no shell, no extensions)",
  /**
   * Enumerate the providers Pi actually has credentials for by reading the
   * keys of Pi's own credential store (values are never read or logged),
   * falling back to a fixed probe list when the store can't be read. Then
   * confirm readiness with `pi auth check` per provider. Probing a fixed
   * list alone wrongly reported "not signed in" for accounts authenticated
   * via other providers (e.g. `opencode-go`).
   */
  async detectAuth(run) {
    let candidates = ["openai-codex", "openai", "anthropic", "google", "opencode-go"];
    try {
      const store = JSON.parse(
        await fsp.readFile(path.join(os.homedir(), ".pi", "agent", "auth.json"), "utf8"),
      );
      const configured = Object.keys(store ?? {}).filter((key) => typeof key === "string" && key);
      if (configured.length) candidates = configured;
    } catch {}
    for (const provider of candidates) {
      const result = await run(
        "pi",
        ["auth", "check", "--provider", provider, "--json", "--no-refresh"],
        {
          timeout: 7000,
        },
      );
      try {
        if (JSON.parse(result.stdout).status === "ready")
          return { signedIn: true, account: `Pi · ${provider}`, provider };
      } catch {}
    }
    return { signedIn: false };
  },
  command({ prompt, session, continuing, dataDir, provider, model }) {
    const sessionFile = `${dataDir}/sessions/${session.id}.jsonl`;
    return [
      "pi",
      [
        "-p",
        "--mode",
        "json",
        "--no-extensions",
        "--tools",
        "read,edit,write,grep,find,ls",
        // A `provider/model` id embeds the provider, so --provider is omitted
        // when a model is chosen. Otherwise pass the detected provider so the
        // default stays explicit.
        ...(model ? ["--model", model] : provider ? ["--provider", provider] : []),
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
