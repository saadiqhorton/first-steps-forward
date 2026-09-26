export const opencode = {
  id: "opencode",
  name: "OpenCode",
  short: "OpenCode",
  bin: "opencode",
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
  command({ projectPath, prompt, session, continuing, model }) {
    return [
      "opencode",
      [
        "run",
        "--format",
        "json",
        "--dir",
        projectPath,
        // `-m provider/model` also works with `--session` continuation.
        ...(model ? ["-m", model] : []),
        ...(continuing && session.agentSessionId ? ["--session", session.agentSessionId] : []),
        prompt,
      ],
    ];
  },
  parse(line, session) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return {};
    }
    if (event.sessionID) session.agentSessionId = event.sessionID;
    if (event.type === "text" && event.part?.text) return { text: event.part.text };
    if (event.type === "error")
      return { error: event.error?.message ?? "OpenCode reported an error." };
    return {};
  },
};
