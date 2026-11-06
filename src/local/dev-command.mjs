// Agent-proposed dev commands (docs/adr/0005-agent-proposed-dev-commands.md). A project without
// a package.json dev script can still get an ADE-managed dev server: the agent proposes one
// program and its arguments, the user approves it once, and ADE runs it outside the agent's
// sandbox, as the user. Because of that, a command is checked strictly here and never reaches a
// shell: it is split into argv by a small quote-aware splitter that refuses shell syntax, its
// folder must resolve inside the project, and it runs with shell: false.
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const MAX_COMMAND_LENGTH = 500;
const ONE_PROGRAM =
  "Pass one program and its arguments, like `pyxplain-ui` or `uvicorn app:app --port {port}`, and the folder it runs in as `cwd`.";

/** A proposal ADE refuses, or an answer it can no longer take; `status` is the HTTP status. */
export class DevCommandError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const shellSyntax = (what) =>
  new DevCommandError(
    `ADE runs dev commands without a shell, so ${what} cannot be used. ${ONE_PROGRAM}`,
  );
const VARIABLE_START = /[({A-Za-z_]/;

/**
 * Split a one-line command into argv the way a POSIX shell splits plain words: whitespace
 * separates words, single quotes keep everything literally, double quotes keep everything but
 * `\"` and `\\`, and a backslash outside quotes escapes a space, quote or backslash (any other
 * backslash stays, so Windows paths survive). Anything a shell would treat as syntax is refused
 * rather than passed on: unquoted `&`, `|`, `;`, `<`, `>`, and backticks or `$` expansions
 * anywhere a shell would expand them.
 * @param {string} command
 * @returns {string[]}
 */
export function splitCommand(command) {
  const argv = [];
  let word = "";
  let inWord = false;
  /** @type {"'" | '"' | null} */
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    const next = command[i + 1] ?? "";
    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "\\" && (next === '"' || next === "\\")) {
        word += next;
        i += 1;
      } else if (ch === "`") throw shellSyntax("backticks");
      else if (ch === "$" && VARIABLE_START.test(next))
        throw shellSyntax("`$` expansions (use {port} for the port ADE picks)");
      else word += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inWord) argv.push(word);
      word = "";
      inWord = false;
      continue;
    }
    inWord = true;
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "\\" && /[\s'"\\]/.test(next)) {
      word += next;
      i += 1;
    } else if (ch === "&" || ch === "|") throw shellSyntax(`\`${next === ch ? ch + ch : ch}\``);
    else if (ch === ";" || ch === "<" || ch === ">") throw shellSyntax(`\`${ch}\``);
    else if (ch === "`") throw shellSyntax("backticks");
    else if (ch === "$" && VARIABLE_START.test(next))
      throw shellSyntax(
        next === "(" ? "`$( )`" : "`$` expansions (use {port} for the port ADE picks)",
      );
    else word += ch;
  }
  if (quote) throw new DevCommandError(`The command has an unclosed ${quote} quote.`);
  if (inWord) argv.push(word);
  return argv;
}

/** `{port}` in any argument becomes the port the dev server should listen on. */
export const withPort = (argv, port) => argv.map((arg) => arg.replaceAll("{port}", String(port)));

/**
 * The folder a command runs in, as a relative path with forward slashes: "." for the project
 * root, "ui" for "./ui/" or "ui\\". Absolute paths and `..` escapes are refused.
 * @param {unknown} raw
 */
export function normalizeCwd(raw) {
  if (raw === undefined || raw === null || raw === "") return ".";
  if (typeof raw !== "string" || /[\0\r\n]/.test(raw))
    throw new DevCommandError(
      '`cwd` must be a folder relative to the project root, like "ui" (default ".").',
    );
  if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw) || /^[A-Za-z]:/.test(raw))
    throw new DevCommandError(
      '`cwd` must be relative to the project root, like "ui", not an absolute path.',
    );
  const normal = path.posix.normalize(raw.replaceAll("\\", "/")).replace(/\/+$/, "") || ".";
  if (normal === ".." || normal.startsWith("../"))
    throw new DevCommandError("`cwd` must stay inside the project; `..` cannot leave it.");
  return normal;
}

/** @param {unknown} raw */
function normalizePort(raw) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const port = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535)
    throw new DevCommandError(
      "`port` must be an integer from 1 to 65535, and only for apps that always listen on a fixed port.",
    );
  return /** @type {number} */ (port);
}

/**
 * Check a proposed (or stored) dev command against the project and resolve what to run: argv,
 * the real folder (which must be inside the project's real path, so a symlink cannot lead out),
 * and an optional fixed port.
 * @param {{ command?: unknown, cwd?: unknown, port?: unknown }} input
 * @param {string} projectPath
 * @returns {Promise<{ command: string, cwd: string, port?: number, argv: string[], dir: string }>}
 */
export async function resolveDevCommand(input, projectPath) {
  const command = typeof input.command === "string" ? input.command.trim() : "";
  if (!command) throw new DevCommandError(`\`command\` must be a non-empty string. ${ONE_PROGRAM}`);
  if (/[\r\n]/.test(command)) throw new DevCommandError("`command` must be a single line.");
  if (command.length > MAX_COMMAND_LENGTH)
    throw new DevCommandError(`\`command\` must be at most ${MAX_COMMAND_LENGTH} characters.`);
  const argv = splitCommand(command);
  if (!argv.length || !argv[0])
    throw new DevCommandError(`\`command\` names no program. ${ONE_PROGRAM}`);
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0]))
    throw shellSyntax(
      "a leading `NAME=value` assignment (ADE already sets PORT and HOST=127.0.0.1)",
    );
  const cwd = normalizeCwd(input.cwd);
  const port = normalizePort(input.port);
  const root = await fs.realpath(projectPath);
  let dir;
  try {
    dir = await fs.realpath(path.resolve(root, cwd));
  } catch {
    throw new DevCommandError(`The folder \`${cwd}\` does not exist in this project.`);
  }
  const inside = path.relative(root, dir);
  if (inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside))
    throw new DevCommandError(
      `\`cwd\` must stay inside the project; \`${cwd}\` resolves outside it.`,
    );
  if (!(await fs.stat(dir)).isDirectory())
    throw new DevCommandError(`\`${cwd}\` is not a folder in this project.`);
  return { command, cwd, ...(port ? { port } : {}), argv, dir };
}

/** Same program, arguments, folder and fixed port: an approval for one covers the other. */
export function sameDevCommand(a, b) {
  if (!a || !b || a.cwd !== b.cwd || (a.port ?? null) !== (b.port ?? null)) return false;
  try {
    return JSON.stringify(splitCommand(a.command)) === JSON.stringify(splitCommand(b.command));
  } catch {
    return false;
  }
}

const isDirectory = (candidate) =>
  fs.stat(candidate).then(
    (stat) => stat.isDirectory(),
    () => false,
  );

/**
 * Environment additions for an approved command, as for a package script whose framework ADE
 * does not know: PORT and HOST=127.0.0.1. A virtualenv's scripts folder (`.venv/bin`, or
 * `.venv\Scripts` on Windows) in the command's folder or the project root goes first on PATH, so
 * a console script like `pyxplain-ui` is found without activating it.
 * @param {{ dir: string, root: string, port: number }} where
 */
export async function devCommandEnv({ dir, root, port }) {
  const scripts =
    process.platform === "win32" ? path.join(".venv", "Scripts") : path.join(".venv", "bin");
  const prepend = [];
  for (const base of new Set([dir, root])) {
    const candidate = path.join(base, scripts);
    if (await isDirectory(candidate)) prepend.push(candidate);
  }
  const env = { PORT: String(port), HOST: "127.0.0.1" };
  if (!prepend.length) return env;
  const key = Object.keys(process.env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  return {
    ...env,
    [key]: [...prepend, process.env[key]].filter(Boolean).join(path.delimiter),
  };
}

/**
 * The questions "Run this dev command?" waiting on the user: at most one per project. A request
 * is attached to the session whose agent proposed it (its `pendingPermissions`, so the session
 * shows Needs you) or, when ADE does not know the session, to the project for the right pane.
 * It outlives the turn that asked, because the answer is about the project; an identical
 * proposal joins it, a different one replaces it. Kept in memory only: after a restart the agent
 * proposes again.
 * @param {{ state: { projects: any[], sessions: any[] }, save: () => Promise<void>, emit?: (scope: string) => void, waitMs?: number }} deps
 */
export function createDevCommandApprovals({ state, save, emit = () => {}, waitMs = 5 * 60_000 }) {
  /** @type {Map<string, { request: any, sessionId: string | null, waiters: Set<(outcome: string) => void> }>} */
  const pending = new Map();
  let wait = waitMs;

  function detach(entry) {
    const session = state.sessions.find((s) => s.id === entry.sessionId);
    if (!session?.pendingPermissions) return;
    session.pendingPermissions = session.pendingPermissions.filter(
      (p) => p.id !== entry.request.id,
    );
    if (!session.pendingPermissions.length) delete session.pendingPermissions;
    emit(`session:${session.id}`);
  }
  /** Close the project's request and tell everyone waiting on it what happened. */
  function settle(projectId, outcome) {
    const entry = pending.get(projectId);
    if (!entry) return false;
    pending.delete(projectId);
    detach(entry);
    for (const resolve of [...entry.waiters]) resolve(outcome);
    return true;
  }

  return {
    /** Test-only: how long a start call waits for the user's answer. */
    setWaitMs(ms) {
      wait = ms;
    },
    /** A request the UI shows on the project because no session asked it. */
    unattached(projectId) {
      const entry = pending.get(projectId);
      return entry && !entry.sessionId ? entry.request : undefined;
    },
    /** The project's open request, wherever it is shown. */
    pendingFor(projectId) {
      return pending.get(projectId)?.request;
    },
    /**
     * Ask the user about `proposal`, or join the identical open request.
     * @param {{ id: string }} project
     * @param {{ command: string, cwd: string, port?: number }} proposal
     * @param {unknown} sessionId the asking agent's ADE session, when it sent one
     */
    ask(project, proposal, sessionId) {
      const current = pending.get(project.id);
      if (current && sameDevCommand(current.request, proposal)) return current.request;
      if (current) settle(project.id, "superseded");
      const session = state.sessions.find(
        (s) => typeof sessionId === "string" && s.id === sessionId && s.projectId === project.id,
      );
      const request = {
        id: randomUUID(),
        kind: "dev_command",
        command: proposal.command,
        cwd: proposal.cwd,
        ...(proposal.port ? { port: proposal.port } : {}),
        requestedAt: Date.now(),
      };
      pending.set(project.id, { request, sessionId: session?.id ?? null, waiters: new Set() });
      if (session) {
        session.pendingPermissions = [...(session.pendingPermissions ?? []), request];
        emit(`session:${session.id}`);
      }
      save().catch(() => {});
      return request;
    },
    /**
     * Wait for the answer to `requestId`, or until the caller cancels.
     * @param {string} projectId @param {string} requestId
     * @param {AbortSignal} [signal]
     * @returns {Promise<string>}
     */
    wait(projectId, requestId, signal) {
      const entry = pending.get(projectId);
      if (!entry || entry.request.id !== requestId || signal?.aborted)
        return Promise.resolve(signal?.aborted ? "gone" : "cancelled");
      return new Promise((resolve) => {
        const finish = (outcome) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", cancelled);
          entry.waiters.delete(finish);
          resolve(outcome);
        };
        const cancelled = () => finish("gone");
        const timer = setTimeout(() => finish("timeout"), wait);
        timer.unref?.();
        entry.waiters.add(finish);
        signal?.addEventListener("abort", cancelled, { once: true });
      });
    },
    /**
     * The user's answer. Allow stores the command as the project's approved dev command
     * (replacing any earlier one); deny changes nothing.
     * @param {any} project @param {unknown} requestId @param {boolean} allow
     */
    async answer(project, requestId, allow) {
      const entry = pending.get(project.id);
      if (!entry || entry.request.id !== requestId)
        throw new DevCommandError("ADE is no longer waiting for this answer.", 409);
      const { command, cwd, port } = entry.request;
      if (allow)
        project.devCommand = { command, cwd, ...(port ? { port } : {}), approvedAt: Date.now() };
      settle(project.id, allow ? "allow" : "deny");
      await save();
      return entry.request;
    },
    /** Drop the open request a session holds (the session was completed). */
    cancelForSession(session) {
      for (const [projectId, entry] of pending)
        if (entry.sessionId === session.id) settle(projectId, "cancelled");
    },
    /** Drop a removed project's open request. */
    cancelForProject(projectId) {
      settle(projectId, "cancelled");
    },
  };
}
