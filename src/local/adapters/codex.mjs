import { codexComputerArgs } from "./computer-tools.mjs";

export const codex = {
  id: "codex",
  name: "OpenAI Codex",
  short: "Codex",
  bin: "codex",
  authMethod: "ChatGPT sign-in (browser or device code)",
  authNote:
    "Codex CLI supports ChatGPT sign-in, including a device flow. Credentials remain in Codex's user-level auth store.",
  installHint: "Install Codex CLI from https://developers.openai.com/codex/cli/",
  tools: "Codex CLI tools under its workspace-write sandbox",
  async detectAuth(run) {
    const result = await run("codex", ["login", "status"], { timeout: 5000 });
    const signedIn =
      result.code === 0 && /logged in|signed in/i.test(result.stdout + result.stderr);
    return { signedIn, ...(signedIn ? { account: "Codex account" } : {}) };
  },
  command({
    projectPath,
    prompt,
    session,
    continuing,
    model,
    effort,
    speed,
    permission,
    attachments,
    computer,
  }) {
    // `-m` is valid for both `codex exec` and `codex exec resume`; omit it when
    // no model was chosen so the CLI keeps its own configured default.
    const modelArgs = model ? ["-m", model] : [];
    const optionArgs = [
      ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
      ...(speed ? ["-c", `service_tier="${speed}"`] : []),
    ];
    // The agent computer's MCP server, configured per turn (resume too).
    const computerArgs = codexComputerArgs(computer);
    const plan = permission === "plan";
    const imageArgs = (attachments ?? [])
      .filter((a) => a.kind === "image")
      .flatMap((a) => ["--image", a.path]);
    // Codex's --image is greedy (num_args = 1..) on current CLIs, so without
    // `--` it swallows the positional prompt and then fails on closed stdin:
    // "No prompt provided via stdin."
    const promptArgs = imageArgs.length ? ["--", prompt] : [prompt];
    return continuing && session.agentSessionId
      ? [
          "codex",
          [
            "exec",
            "resume",
            "--json",
            ...modelArgs,
            ...optionArgs,
            ...computerArgs,
            ...(plan ? ["-c", 'sandbox_mode="read-only"'] : []),
            session.agentSessionId,
            ...imageArgs,
            ...promptArgs,
          ],
        ]
      : [
          "codex",
          [
            "exec",
            "--json",
            ...modelArgs,
            ...optionArgs,
            ...computerArgs,
            "--cd",
            projectPath,
            "--sandbox",
            plan ? "read-only" : "workspace-write",
            ...imageArgs,
            ...promptArgs,
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
    if (event.type === "thread.started") session.agentSessionId = event.thread_id;
    if (event.type === "item.completed" && event.item?.type === "agent_message")
      return { text: event.item.text ?? "" };
    if (event.type === "error") return { error: event.message ?? "Codex reported an error." };
    return {};
  },
};
