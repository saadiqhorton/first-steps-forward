// @ts-check
// One adapter shape for every agent. An agent file (adapters/<id>.agent.mjs)
// describes its agent with defineCliAgent (a CLI that prints JSON lines) or
// defineAcpAgent (an agent that speaks the Agent Client Protocol). Either way
// the rest of ADE sees the same adapter:
//
// - its profile (see AgentProfile), which the UI renders as-is;
// - detectAuth(run): whether the user is signed in;
// - listModels(context): the agent's model listing;
// - runTurn(input, io): one turn, reported as session events and how it ended.
//
// Nothing here touches a session.
//
// Activity logging for a new agent. The Activity pane reads every agent's log lines through one
// event model (ActivityEvent in src/lib/ade/formatLogs.mjs), so it costs an agent little:
// - An ACP agent needs nothing. runAcpTurn (../acp.mjs) logs each tool call as
//   {type:"tool_call", callId, toolName, kind?, title?, input} and its result as
//   {type:"tool_result", callId, toolName, kind?, isError?, summary?, additions?, deletions?,
//   files?}, from the agent's own toolCallId, kind and title. `kind` (ACP's read, edit, search,
//   execute, fetch, ...) is what classifies the step, and `callId` pairs a call with its result.
//   A call is logged again as the agent refines it, and a result again with `amends: true` when
//   the real diff comes after it; the pane folds each into the one step.
// - A CLI that prints JSON lines needs one small decoder in formatLogs.mjs: map each raw event
//   to an ActivityEvent (a tool_call and, later, a tool_result with the same callId; plus the
//   odd message, plan or error), and add it to DECODERS. Then add a short fixture log under
//   src/lib/ade/fixtures/activity/ and a row to src/lib/ade/activityConformance.test.mjs.
// - Never log file contents or diffs. A result carries a few plain words (`summary`: "95
//   lines", a command's last output line, an error's first line), changed line counts and paths.
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { commandLine } from "../harness.mjs";
import { acpConnectorServers } from "./connector-wiring.mjs";
import { listAcpModels, runAcpTurn } from "../acp.mjs";
import { acpBridge } from "../acp-bridge.mjs";
import { acpModelListing, cliModelListing, MANUAL_HINT, rememberAcpModels } from "../models.mjs";
import { findOnPath, runCommand, spawnCommand, stopProcess } from "../spawn.mjs";

/**
 * One thing that happened during a turn.
 * A `text` that `continues` is the next piece of the reply the last one began.
 * @typedef {{ type: "text", text: string, continues?: boolean }
 *   | { type: "log", line: string }
 *   | { type: "notice", text: string }
 *   | { type: "error", text: string, fatal?: boolean }
 *   | { type: "conversation", id: string }
 *   | { type: "default-model", id: string }} SessionEvent
 *
 * How a turn ended. `reported`: the agent itself said the turn failed;
 * `unfinished`: an ACP agent stopped before finishing; `exit`: the process
 * exited non-zero; `spawn`: the process never started.
 * @typedef {{ ok: true }
 *   | { ok: false, reason: "reported" | "unfinished" | "spawn" }
 *   | { ok: false, reason: "exit", exit: { code: number | null, signal: string | null } }} TurnEnd
 *
 * @typedef {{ kind: string, path: string, mime: string, name?: string }} Attachment
 * Shared turn context for the agent computer. Script paths (MCP vs Pi) are
 * resolved inside each adapter's `wireComputer`, not carried here.
 * @typedef {{ node: string, env: Record<string, string> }} ComputerContext
 * @typedef {import("./computer-tools.mjs").ComputerWiring} ComputerWiring
 *
 * Everything an agent needs for one turn.
 * @typedef {object} TurnInput
 * @property {string} projectPath the project folder, also the working directory
 * @property {string} prompt the full prompt: safety preamble, context manifest and task
 * @property {{ id: string, agentSessionId?: string, agentSessionKey?: string }} session ADE's session id, the agent's own conversation id, and an optional provider-local session key
 * @property {boolean} continuing a follow-up in the same conversation
 * @property {string} dataDir ADE's data folder (~/.ade)
 * @property {string[]} [providers] providers the agent reported ready
 * @property {string} version the agent's version
 * @property {string} [model]
 * @property {string} [defaultModel] the default model an ACP agent reported last time
 * @property {string} [effort]
 * @property {string} [speed]
 * @property {"build" | "plan"} [permission]
 * @property {Attachment[]} attachments
 * @property {ComputerContext | null} computer how the agent reaches its browser tools
 * @property {import("../connectors.mjs").Connector[]} [connectors] connectors (secrets included) that apply to this turn
 * @property {{ url: string, token: string, threadId: string, node?: string }} [workspaceAssistant]
 *   a one-turn capability for the assistant's workspace tools (only for workspace chats)
 *
 * What the session turn module lends the agent for one turn.
 * @typedef {object} TurnIO
 * @property {(event: SessionEvent) => void} emit
 * @property {(request: object) => Promise<{ outcome: string, optionId?: string }>} ask
 *   a permission request; settles "cancelled" if the turn ends first
 * @property {(bin: string, args: string[], options?: { env?: Record<string, string>, stdin?: "pipe" | "ignore" }) => import("node:child_process").ChildProcess} spawn
 *   start the turn's process in the project; throws once the turn was interrupted
 * @property {AbortSignal} signal aborted when ADE stops the turn on purpose
 *
 * What ADE shows about an agent; plain data, served with each agent row.
 * @typedef {object} AgentProfile
 * @property {string} id
 * @property {string} name
 * @property {string} short
 * @property {string} bin the user's own CLI on PATH
 * @property {number} [order] position in agent lists (lower first)
 * @property {string} tools what the agent can do in a turn, in plain words
 * @property {string} authMethod
 * @property {string} authNote
 * @property {string} installHint
 * @property {{ note: string, command?: string, device?: [string, string[]], waiting?: string }} signIn
 *   how the user signs in: a `command` to run in a terminal, or a `device`
 *   flow ADE starts itself (showing `waiting` while it runs)
 * @property {{ pkg: string, install: [string, string[]], update: [string, string[]], selfUpdates?: boolean, brews?: { kind: "formula" | "cask", name: string }[] }} harness
 *   how ADE installs and updates the CLI; `selfUpdates` when it updates itself;
 *   `brews` lists the Homebrew formula/cask identities that install this binary,
 *   so a Homebrew-owned executable is updated by `brew upgrade` instead of npm
 * @property {{ build: string, plan: string }} permissionNotes what Build and Plan mean for this agent
 * @property {{ effort?: string, speed?: string }} [notes] caveats shown beside effort and speed
 *
 * Where a model listing comes from and how fresh it may be.
 * @typedef {{ run?: typeof runCommand, version?: string, cacheDir?: string, now?: number, canProbe?: boolean }} ListingContext
 */

/**
 * The agent row the UI renders, before detection adds what is installed
 * and signed in.
 * @param {AgentProfile} agent
 */
export function describeAgent(agent) {
  return {
    id: agent.id,
    name: agent.name,
    short: agent.short,
    tools: agent.tools,
    authMethod: agent.authMethod,
    authNote: agent.authNote,
    installHint: agent.installHint,
    signIn: {
      note: agent.signIn.note,
      ...(agent.signIn.command ? { command: agent.signIn.command } : {}),
      ...(agent.signIn.device ? { device: true, waiting: agent.signIn.waiting ?? "" } : {}),
    },
    harness: {
      install: commandLine(agent.harness.install),
      update: commandLine(agent.harness.update),
    },
  };
}

/** Calls `onLine` for each complete, non-blank line, buffering partial ones. */
export function lines(onLine) {
  let buffer = "";
  return {
    push(data) {
      buffer += data.toString();
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";
      for (const line of parts) if (line.trim()) onLine(line);
    },
    flush() {
      if (buffer.trim()) onLine(buffer);
      buffer = "";
    },
  };
}

/** Settles once the process has exited (`code`, `signal`) or could not start (`error`). */
export function exited(child) {
  return new Promise((resolve) => {
    child.once("error", (error) => resolve({ error }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

/**
 * An agent CLI that runs one turn per process and prints JSON lines.
 *
 * - `command(input)` → `[bin, args, env?]` for the turn.
 * - `wireComputer(computer)` (optional) → spawn extras (`args`, `env`, …) the
 *   agent's `command` merges in; harness-specific shape stays at the leaf.
 * - `parse(line, turn)` → the session events one stdout line carries; `turn` is an
 *   object of its own to remember things in until the process ends.
 * - `keepLog(line)` (optional) → whether the line belongs in the Activity log;
 *   return false for streaming deltas that would evict the steps around them.
 * - `stderr(line)` (optional) → session events a stderr line carries.
 * - `prepare(input)` (optional) runs before the process starts.
 * - `probeModels(run)` (optional) → the CLI's own model listing.
 * @template {{ command: (input: TurnInput) => any[], wireComputer?: (computer: ComputerContext | null) => ComputerWiring, parse: (line: string, turn?: any) => SessionEvent[], keepLog?: (line: string) => boolean, stderr?: (line: string) => SessionEvent[], prepare?: (input: TurnInput) => Promise<void> }} T
 * @param {T} spec
 */
export function defineCliAgent(spec) {
  return {
    ...spec,
    /** @param {ListingContext} context */
    listModels({ run = runCommand, version, cacheDir, now } = {}) {
      const probe = /** @type {any} */ (spec).probeModels;
      if (!probe)
        return Promise.resolve({ available: false, reason: "unsupported", hint: MANUAL_HINT });
      return cliModelListing(/** @type {any} */ (spec).id, () => probe(run), {
        version,
        cacheDir,
        now,
      });
    },
    /** @param {TurnInput} input @param {TurnIO} io @returns {Promise<TurnEnd>} */
    async runTurn(input, io) {
      await spec.prepare?.(input);
      const [bin, args, env = {}] = spec.command(input);
      const child = io.spawn(bin, args, { env, stdin: "ignore" });
      let fatal = false;
      /** What `parse` remembers between this turn's lines. */
      const turn = {};
      /** @param {SessionEvent[] | undefined} events */
      const forward = (events) => {
        for (const event of events ?? []) {
          if (event.type === "error" && event.fatal) fatal = true;
          io.emit(event);
        }
      };
      const stdout = lines((line) => {
        const events = spec.parse(line, turn);
        if (spec.keepLog?.(line) !== false) io.emit({ type: "log", line });
        forward(events);
      });
      const stderr = lines((line) => {
        io.emit({ type: "log", line });
        forward(spec.stderr?.(line));
      });
      child.stdout?.on("data", stdout.push);
      child.stderr?.on("data", stderr.push);
      const exit = await exited(child);
      stdout.flush();
      stderr.flush();
      if (exit.error) {
        io.emit({ type: "error", text: `${bin} failed to start: ${exit.error.message}` });
        return { ok: false, reason: "spawn" };
      }
      // Some CLIs (Pi print mode) exit 0 even when the provider rejected the
      // turn; their own settled failure is the only signal.
      if (fatal) return { ok: false, reason: "reported" };
      if (exit.code === 0) return { ok: true };
      return { ok: false, reason: "exit", exit: { code: exit.code, signal: exit.signal } };
    },
  };
}

/**
 * What an ACP agent's `command()` needs: its bridge's [bin, args] when it has
 * one (set up on first use, announced through `onInstall`), and the user's
 * own CLI on PATH.
 * @param {{ name: string, bin: string, installHint: string, bridge?: { pkg: string, version: string, bin: string, entry: string } }} spec
 * @param {{ dataDir: string, onInstall?: () => void }} options
 */
export async function acpLaunch(spec, { dataDir, onInstall }) {
  if (!spec.bridge) return {};
  const executable = await findOnPath(spec.bin);
  if (!executable)
    throw new Error(`${spec.name} is not on PATH (\`${spec.bin}\`). ${spec.installHint}.`);
  const bridge = await acpBridge(spec.bridge, {
    dataDir,
    which: findOnPath,
    run: runCommand,
    onInstall,
  });
  return { bridge, executable };
}

/**
 * An agent that speaks the Agent Client Protocol over stdin/stdout.
 *
 * - `command({ bridge, executable })` → `[bin, args, env?]`.
 * - `modes`: ADE permission → the agent's mode ids, first one offered wins.
 * - `bridge` (optional): an npm package that adapts the user's CLI to ACP.
 * - `wireComputer(computer)` (optional): spawn extras (`mcpServers`, …) for the turn.
 * - `sessionMeta({ computer, permission, ephemeral })` (optional): `_meta` for session/new.
 * - `keepMode(current, permission)` (optional): leave the agent in the mode it is in.
 * - `rememberModels: false` (optional): its models come from elsewhere; do not cache ACP's.
 * - `answer(request, io)` (optional): answers its permission requests instead of the user.
 * - `fallback(input, io, error)` (optional): runs the turn another way when ACP failed before
 *   the prompt was sent.
 * @template {{ id: string, name: string, bin: string, installHint: string, modes: { build: string[], plan: string[] }, command: (launch: any) => any[], bridge?: { pkg: string, version: string, bin: string, entry: string }, acpAuth?: () => {methods: string[], meta?: object, missingMessage?: string}, wireComputer?: (computer: ComputerContext | null) => ComputerWiring, sessionMeta?: (options: { computer: boolean, permission?: string, ephemeral?: boolean }) => object }} T
 * @param {T} spec
 */
export function defineAcpAgent(spec) {
  /** The agent's models, from a session it opens and is never prompted in. */
  async function probeModels(dataDir) {
    const [bin, args, env = {}] = spec.command({
      ...(await acpLaunch(spec, { dataDir })),
      ephemeral: true,
    });
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
    const child = spawnCommand(bin, args, {
      cwd: dataDir,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "ignore"],
      shell: false,
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), 30000);
    try {
      return await listAcpModels({
        child,
        name: spec.name,
        cwd: dataDir,
        sessionMeta: spec.sessionMeta?.({ computer: false, ephemeral: true }),
        acpAuth: spec.acpAuth?.(),
      });
    } finally {
      clearTimeout(timer);
      child.stdin?.end();
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      }, 3000).unref?.();
    }
  }
  return {
    ...spec,
    protocol: "acp",
    /**
     * The models the agent last reported for this version; with `canProbe`
     * (installed and signed in) it is asked when there is no list yet.
     * @param {ListingContext} context
     */
    listModels({ version, cacheDir = "", canProbe = false } = {}) {
      return acpModelListing(spec.id, spec.name, {
        version,
        cacheDir,
        ...(canProbe ? { probe: () => probeModels(cacheDir) } : {}),
      });
    },
    /** @param {TurnInput} input @param {TurnIO} io @returns {Promise<TurnEnd>} */
    async runTurn(input, io) {
      const launch = await acpLaunch(spec, {
        dataDir: input.dataDir,
        onInstall: () =>
          io.emit({
            type: "notice",
            text: `Setting up ${spec.name} for ADE, once: installing its ACP bridge (${spec.bridge?.pkg}@${spec.bridge?.version}) under ~/.ade/acp. Your own \`${spec.bin}\` stays the one that runs.`,
          }),
      });
      const [bin, args, env = {}] = spec.command(launch);
      // The agent takes the whole turn as JSON-RPC over stdin/stdout.
      const child = io.spawn(bin, args, { env, stdin: "pipe" });
      const stderr = lines((line) => io.emit({ type: "log", line }));
      child.stderr?.on("data", stderr.push);
      const done = exited(child);
      const start = { error: /** @type {Error | null} */ (null) };
      child.once("error", (error) => (start.error = error));
      /** @type {TurnEnd} */
      let end;
      let prompted = false;
      /** @type {unknown} */
      let failure;
      const fallsBack = () =>
        failure !== undefined &&
        !prompted &&
        !io.signal.aborted &&
        !!(/** @type {any} */ (spec).fallback);
      try {
        const { stopReason, declinedModeSwitch } = await runAcpTurn({
          child,
          name: spec.name,
          cwd: input.projectPath,
          prompt: input.prompt,
          images: input.attachments.filter((a) => a.kind === "image"),
          resumeId: input.continuing ? input.session.agentSessionId : undefined,
          permission: input.permission ?? "build",
          modes: spec.modes,
          unadvertisedModes: /** @type {any} */ (spec).unadvertisedModes,
          keepMode: /** @type {any} */ (spec).keepMode,
          model: input.model,
          defaultModel: input.defaultModel,
          effort: input.effort,
          acpAuth: spec.acpAuth?.(),
          mcpServers: [
            ...(spec.wireComputer?.(input.computer)?.mcpServers ?? []),
            ...(input.workspaceAssistant
              ? [
                  {
                    name: "ade_workspace",
                    command: process.execPath,
                    args: [fileURLToPath(new URL("../workspace-tools.mjs", import.meta.url))],
                    env: [
                      { name: "ADE_WORKSPACE_TOOL_URL", value: input.workspaceAssistant.url },
                      { name: "ADE_WORKSPACE_TOOL_TOKEN", value: input.workspaceAssistant.token },
                      { name: "ADE_WORKSPACE_THREAD_ID", value: input.workspaceAssistant.threadId },
                    ],
                  },
                ]
              : []),
            ...acpConnectorServers(input.connectors),
          ],
          sessionMeta: spec.sessionMeta?.({
            computer: !!input.computer,
            permission: input.permission,
          }),
          on: {
            sessionId: (id) => io.emit({ type: "conversation", id }),
            defaultModel: (id) => io.emit({ type: "default-model", id }),
            text: (text, continues) =>
              io.emit({ type: "text", text, ...(continues ? { continues: true } : {}) }),
            log: (line) => io.emit({ type: "log", line }),
            notice: (text) => io.emit({ type: "notice", text }),
            prompting: () => (prompted = true),
            models: (models) =>
              /** @type {any} */ (spec).rememberModels !== false &&
              void rememberAcpModels(input.dataDir, spec.id, input.version, models, {
                complete: false,
              }),
            permission: (request) =>
              /** @type {any} */ (spec).answer
                ? /** @type {any} */ (spec).answer(request, io)
                : io.ask(request),
          },
        });
        // Plan's own decline of "leave plan mode" ends Claude's turn as
        // cancelled; the plan was delivered, so that is a finished turn.
        const cancelled = stopReason === "cancelled" && !declinedModeSwitch;
        if (stopReason === "max_tokens" || stopReason === "max_turn_requests")
          io.emit({
            type: "notice",
            text: `${spec.name} stopped early: it reached its ${stopReason === "max_tokens" ? "output token" : "tool request"} limit for one turn. Send a follow-up to let it continue.`,
          });
        if (stopReason === "refusal")
          io.emit({ type: "notice", text: `${spec.name} refused to continue this request.` });
        if (cancelled)
          io.emit({ type: "notice", text: `${spec.name} cancelled the turn before finishing.` });
        end =
          stopReason !== "refusal" && !cancelled
            ? { ok: true }
            : { ok: false, reason: "unfinished" };
      } catch (error) {
        // ADE stopping the turn on purpose is not news, and a process that
        // never started is reported once, below.
        failure = error;
        if (!fallsBack() && child.pid && !start.error && !io.signal.aborted)
          io.emit({ type: "error", text: error instanceof Error ? error.message : String(error) });
        end = { ok: false, reason: "unfinished" };
      }
      // ADE ends the agent once the turn settles: close stdin, and SIGTERM
      // its group if it lingers.
      child.stdin?.end();
      const linger = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) stopProcess(child);
      }, 3000);
      linger.unref?.();
      await done;
      clearTimeout(linger);
      stderr.flush();
      if (fallsBack()) return /** @type {any} */ (spec).fallback(input, io, failure);
      if (start.error) {
        io.emit({ type: "error", text: `${bin} failed to start: ${start.error.message}` });
        return { ok: false, reason: "spawn" };
      }
      return end;
    },
  };
}
