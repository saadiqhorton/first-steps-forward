import { codexComputerArgs } from "./computer-tools.mjs";
import { codexConnectorWiring } from "./connector-wiring.mjs";
import { runCodexAppServerTurn, AppServerUnavailable } from "./codex-app-server.mjs";
import { defineCliAgent } from "./kit.mjs";
import { MANUAL_HINT } from "../models.mjs";

/** @param {import("./kit.mjs").ComputerContext | null} computer */
function wireComputer(computer, workspaceAssistant = null) {
  return { args: codexComputerArgs(computer, workspaceAssistant) };
}

/** Parse `codex debug models` JSON. Only visibility === "list" is offered. */
export function parseCodexModels(stdout) {
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return null;
  }
  const list = Array.isArray(payload?.models) ? payload.models : null;
  if (!list) return null;
  return list
    .filter((m) => m?.visibility === "list" && typeof m.slug === "string" && m.slug)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
    .map((m) => {
      const row = { id: m.slug, ...(m.display_name ? { label: m.display_name } : {}) };
      if (Array.isArray(m.supported_reasoning_levels)) {
        const efforts = m.supported_reasoning_levels
          .map((level) => level?.effort)
          .filter((effort) => typeof effort === "string" && effort);
        if (efforts.length) row.efforts = efforts;
      }
      if (typeof m.default_reasoning_level === "string" && m.default_reasoning_level) {
        row.defaultEffort = m.default_reasoning_level;
      }
      if (Array.isArray(m.additional_speed_tiers) && m.additional_speed_tiers.length) {
        row.speeds = m.additional_speed_tiers.filter((tier) => typeof tier === "string" && tier);
      }
      return row;
    });
}

/** Codex versions whose app server could not take a turn; they are not asked again. */
const withoutAppServer = new Set();

const exec = defineCliAgent({
  id: "codex",
  name: "OpenAI Codex",
  short: "Codex",
  bin: "codex",
  order: 1,
  signIn: {
    note: "Codex signs in with your ChatGPT account through its own device flow, which ADE can start for you.",
    device: ["codex", ["login", "--device-auth"]],
    waiting: "Waiting for Codex device sign-in… finish in the browser opened by Codex.",
  },
  harness: {
    pkg: "@openai/codex",
    install: ["npm", ["install", "-g", "@openai/codex"]],
    update: ["npm", ["install", "-g", "@openai/codex@latest"]],
    brews: [{ kind: "cask", name: "codex" }],
  },
  // Four permission choices, matching the reference surface. `build` stays
  // the default so existing sessions and presets keep their meaning.
  permissions: ["plan", "build", "approve", "full"],
  permissionLabels: {
    plan: "Read-only",
    build: "Ask for approval",
    approve: "Approve for me",
    full: "Full access",
  },
  permissionNotes: {
    plan: "Codex read-only sandbox: reads and answers, cannot edit files.",
    build:
      "Codex workspace-write sandbox; approval requests follow Codex's non-interactive policy.",
    approve:
      "Codex routes approval requests through automatic review in its workspace-write sandbox.",
    full: "Codex runs with no sandbox and no approval prompts. Only choose this in a project you trust.",
  },
  authMethod: "ChatGPT sign-in (browser or device code)",
  authNote:
    "Codex CLI supports ChatGPT sign-in, including a device flow. Credentials remain in Codex's user-level auth store.",
  installHint: "Install Codex CLI from https://developers.openai.com/codex/cli/",
  tools: "Codex CLI tools under its workspace-write sandbox",
  wireComputer,
  async detectAuth(run) {
    const result = await run("codex", ["login", "status"], { timeout: 5000 });
    const signedIn =
      result.code === 0 && /logged in|signed in/i.test(result.stdout + result.stderr);
    return { signedIn, ...(signedIn ? { account: "Codex account" } : {}) };
  },
  /** The CLI's own cached model listing; never a network refresh, never quota. */
  async probeModels(run) {
    let result = await run("codex", ["debug", "models"], { timeout: 15000 });
    let source = "live";
    let command = "codex debug models";
    if (result.code === 127)
      return { available: false, reason: "not-installed", hint: MANUAL_HINT };
    if (result.code !== 0) {
      result = await run("codex", ["debug", "models", "--bundled"], { timeout: 15000 });
      source = "bundled";
      command = "codex debug models --bundled";
      if (result.code !== 0) return { available: false, reason: "cli-failed", hint: MANUAL_HINT };
    }
    const models = parseCodexModels(result.stdout);
    if (models === null) return { available: false, reason: "cli-failed", hint: MANUAL_HINT };
    if (!models.length) return { available: false, reason: "empty", hint: MANUAL_HINT };
    return { available: true, models, source, command };
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
    workspaceAssistant,
    connectors,
  }) {
    // `-m` is valid for both `codex exec` and `codex exec resume`; omit it when
    // no model was chosen so the CLI keeps its own configured default.
    const modelArgs = model ? ["-m", model] : [];
    const optionArgs = [
      ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
      ...(speed ? ["-c", `service_tier="${speed}"`] : []),
    ];
    // The agent computer's MCP server, configured per turn (resume too).
    const { args: computerArgs = [] } = wireComputer(computer, workspaceAssistant);
    // The user's connectors: secrets only in the spawn env, never in argv.
    const { args: connectorArgs, env: connectorEnv } = codexConnectorWiring(connectors);
    const mcpArgs = [...computerArgs, ...connectorArgs];
    const spawnEnv = Object.keys(connectorEnv).length ? [connectorEnv] : [];
    const plan = permission === "plan";
    const fullAccess = permission === "full";
    const approveForMe = permission === "approve";
    // exec has one-shot flags; resume takes the same settings as -c values
    // (it does not accept --sandbox or --approve-for-me after `resume`).
    const permissionArgs = fullAccess
      ? ["--dangerously-bypass-approvals-and-sandbox"]
      : approveForMe
        ? ["--approve-for-me"]
        : ["--sandbox", plan ? "read-only" : "workspace-write"];
    const resumePermissionArgs = fullAccess
      ? ["--dangerously-bypass-approvals-and-sandbox"]
      : approveForMe
        ? [
            "-c",
            'approval_policy="on-request"',
            "-c",
            'approvals_reviewer="auto_review"',
            "-c",
            'sandbox_mode="workspace-write"',
          ]
        : ["-c", plan ? 'sandbox_mode="read-only"' : 'sandbox_mode="workspace-write"'];
    const imageArgs = (attachments ?? [])
      .filter((a) => a.kind === "image")
      .flatMap((a) => ["--image", a.path]);
    // Codex's --image is greedy (num_args = 1..) on current CLIs, so without
    // `--` it swallows the positional prompt and then fails on closed stdin:
    // "No prompt provided via stdin."
    const promptArgs = imageArgs.length ? ["--", prompt] : [prompt];
    // Codex refuses folders outside a Git repository unless told otherwise
    // ("Not inside a trusted directory"). ADE runs it only in the project the
    // user chose, which need not use Git, and tracks the turn's changes itself.
    const trustArgs = ["--skip-git-repo-check"];
    return continuing && session.agentSessionId
      ? [
          "codex",
          [
            "exec",
            "resume",
            "--json",
            ...trustArgs,
            ...modelArgs,
            ...optionArgs,
            ...mcpArgs,
            ...resumePermissionArgs,
            session.agentSessionId,
            ...imageArgs,
            ...promptArgs,
          ],
          ...spawnEnv,
        ]
      : [
          "codex",
          [
            "exec",
            "--json",
            ...trustArgs,
            ...modelArgs,
            ...optionArgs,
            ...mcpArgs,
            "--cd",
            projectPath,
            ...permissionArgs,
            ...imageArgs,
            ...promptArgs,
          ],
          ...spawnEnv,
        ];
  },
  parse(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return [];
    }
    if (event.type === "thread.started") return [{ type: "conversation", id: event.thread_id }];
    if (event.type === "item.completed" && event.item?.type === "agent_message")
      return [{ type: "text", text: event.item.text ?? "" }];
    if (event.type === "error")
      return [{ type: "error", text: event.message ?? "Codex reported an error." }];
    return [];
  },
});

export const codex = {
  ...exec,
  /**
   * The app server streams the reply. A Codex whose app server cannot open the conversation
   * runs the turn with `codex exec` instead; nothing has been sent to the model by then.
   * @param {import("./kit.mjs").TurnInput} input @param {import("./kit.mjs").TurnIO} io
   */
  async runTurn(input, io) {
    if (withoutAppServer.has(input.version)) return exec.runTurn(input, io);
    const { args: computerArgs = [] } = wireComputer(
      input.computer,
      /** @type {any} */ (input.workspaceAssistant),
    );
    const { args: connectorArgs, env } = codexConnectorWiring(
      /** @type {any} */ (input.connectors),
    );
    const args = [
      ...(input.effort ? ["-c", `model_reasoning_effort="${input.effort}"`] : []),
      ...(input.speed ? ["-c", `service_tier="${input.speed}"`] : []),
      ...computerArgs,
      ...connectorArgs,
    ];
    try {
      return await runCodexAppServerTurn(input, io, { args, env });
    } catch (error) {
      if (!(error instanceof AppServerUnavailable)) throw error;
      if (error.unsupported) withoutAppServer.add(input.version);
      io.emit({
        type: "log",
        line: `Codex's app server could not take this turn (${error.message}); running codex exec, which shows the reply when it is finished.`,
      });
      return exec.runTurn(input, io);
    }
  },
};
