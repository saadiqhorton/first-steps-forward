// @ts-check
// The two ways an agent runs a turn, behind one adapter shape. An agent file
// describes its agent with defineCliAgent (a CLI that prints JSON lines) or
// defineAcpAgent (an agent that speaks the Agent Client Protocol); either way
// the session turn module only ever calls `runTurn(input, io)` and hears back
// session events and how the turn ended. Nothing here touches a session.
import { runAcpTurn } from "../acp.mjs";
import { acpBridge } from "../acp-bridge.mjs";
import { rememberAcpModels } from "../models.mjs";
import { findOnPath, runCommand, stopProcess } from "../spawn.mjs";
import { acpComputerServers } from "./computer-tools.mjs";

/**
 * One thing that happened during a turn.
 * @typedef {{ type: "text", text: string }
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
 * @typedef {{ node: string, mcpScript: string, piExtension: string, env: Record<string, string> }} ComputerContext
 *
 * Everything an agent needs for one turn.
 * @typedef {object} TurnInput
 * @property {string} projectPath the project folder, also the working directory
 * @property {string} prompt the full prompt: safety preamble, context manifest and task
 * @property {{ id: string, agentSessionId?: string }} session ADE's session id, and the agent's own conversation id
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
 *
 * What the session turn module lends the agent for one turn.
 * @typedef {object} TurnIO
 * @property {(event: SessionEvent) => void} emit
 * @property {(request: object) => Promise<{ outcome: string, optionId?: string }>} ask
 *   a permission request; settles "cancelled" if the turn ends first
 * @property {(bin: string, args: string[], options?: { env?: Record<string, string>, stdin?: "pipe" | "ignore" }) => import("node:child_process").ChildProcess} spawn
 *   start the turn's process in the project; throws once the turn was interrupted
 * @property {AbortSignal} signal aborted when ADE stops the turn on purpose
 */

/** Calls `onLine` for each complete, non-blank line, buffering partial ones. */
function lines(onLine) {
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
function exited(child) {
  return new Promise((resolve) => {
    child.once("error", (error) => resolve({ error }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

/**
 * An agent CLI that runs one turn per process and prints JSON lines.
 *
 * - `command(input)` → `[bin, args, env?]` for the turn.
 * - `parse(line)` → the session events one stdout line carries.
 * - `stderr(line)` (optional) → session events a stderr line carries.
 * - `prepare(input)` (optional) runs before the process starts.
 * @template {{ command: (input: TurnInput) => any[], parse: (line: string) => SessionEvent[], stderr?: (line: string) => SessionEvent[], prepare?: (input: TurnInput) => Promise<void> }} T
 * @param {T} spec
 */
export function defineCliAgent(spec) {
  return {
    ...spec,
    /** @param {TurnInput} input @param {TurnIO} io @returns {Promise<TurnEnd>} */
    async runTurn(input, io) {
      await spec.prepare?.(input);
      const [bin, args, env = {}] = spec.command(input);
      const child = io.spawn(bin, args, { env, stdin: "ignore" });
      let fatal = false;
      /** @param {SessionEvent[] | undefined} events */
      const forward = (events) => {
        for (const event of events ?? []) {
          if (event.type === "error" && event.fatal) fatal = true;
          io.emit(event);
        }
      };
      const stdout = lines((line) => {
        io.emit({ type: "log", line });
        forward(spec.parse(line));
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
 * - `sessionMeta({ computer, ephemeral })` (optional): `_meta` for session/new.
 * @template {{ id: string, name: string, bin: string, installHint: string, modes: { build: string[], plan: string[] }, command: (launch: any) => any[], bridge?: { pkg: string, version: string, bin: string, entry: string }, sessionMeta?: (options: { computer: boolean, ephemeral?: boolean }) => object }} T
 * @param {T} spec
 */
export function defineAcpAgent(spec) {
  return {
    ...spec,
    protocol: "acp",
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
          model: input.model,
          defaultModel: input.defaultModel,
          mcpServers: acpComputerServers(input.computer),
          sessionMeta: spec.sessionMeta?.({ computer: !!input.computer }),
          on: {
            sessionId: (id) => io.emit({ type: "conversation", id }),
            defaultModel: (id) => io.emit({ type: "default-model", id }),
            text: (text) => io.emit({ type: "text", text }),
            log: (line) => io.emit({ type: "log", line }),
            notice: (text) => io.emit({ type: "notice", text }),
            models: (models) =>
              void rememberAcpModels(input.dataDir, spec.id, input.version, models),
            permission: (request) => io.ask(request),
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
        if (child.pid && !start.error && !io.signal.aborted)
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
      if (start.error) {
        io.emit({ type: "error", text: `${bin} failed to start: ${start.error.message}` });
        return { ok: false, reason: "spawn" };
      }
      return end;
    },
  };
}
