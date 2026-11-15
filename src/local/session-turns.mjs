// @ts-check
// The session turn module: everything about running a session's turns and
// checks, and the only place a session's status changes.
//
// A session has one slot. A turn (one agent run for one prompt) or a checks
// run holds it from the moment it is accepted until it has settled; every
// entry point checks and claims the slot before its first await, so two runs
// can never overlap. While the slot is held, a follow-up either waits in the
// queue or ("send now") interrupts the run and goes next. When a run ends,
// one place decides what happens next: the "send now" message, then the
// queue, then the run's own outcome.
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { formatAttachmentPrompt } from "./attachments.mjs";
import { classifyFailure, modelSuggestion, retryHint } from "./classify.mjs";
import { getDiff, projectFiles, projectInfo } from "./project-git.mjs";
import { checksFor, otherServicesNote } from "./project-scripts.mjs";
import { processRunsIn, runCommand, spawnCommand, stopProcess } from "./spawn.mjs";

/** @typedef {import("./adapters/kit.mjs").SessionEvent} SessionEvent */
/** @typedef {import("./adapters/kit.mjs").TurnEnd} TurnEnd */
/** @typedef {import("./adapters/kit.mjs").TurnInput} TurnInput */
/** @typedef {import("./adapters/kit.mjs").TurnIO} TurnIO */
/** @typedef {import("./adapters/kit.mjs").ComputerContext} ComputerContext */
/** @typedef {{ runTurn: (input: TurnInput, io: TurnIO) => Promise<TurnEnd> }} AgentAdapter */
/** @typedef {{ id: string, name: string, path: string, branch?: string, uncommittedFiles?: string[], missing?: boolean }} Project */
/** @typedef {{ id: string, name: string, short?: string, installed?: boolean, signedIn?: boolean, version?: string, providers?: string[], account?: string, tools?: string }} AgentRow */
/** @typedef {{ id: string, name: string, mime: string, size: number, kind: string, absPath: string, recording?: boolean }} ResolvedFile */
/** @typedef {{ text: string, files?: ResolvedFile[], presentation?: { text: string, references: { kind: string, label: string, detail: string }[] } }} Message */
/** @typedef {Record<string, any> & { id: string, projectId: string, agentId: string, status: string, messages: any[], logs: string[] }} Session */
/**
 * What ADE knows about a project at the start of a turn, beyond Git.
 * @typedef {{ computer: ComputerContext | null, devServer: string, agentBrowser: object }} TurnContext
 */

/** A request the session cannot take right now; `status` is the HTTP status to answer with. */
export class TurnRefused extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const now = () => Date.now();
const SETTLED = ["stopped", "complete"];

const LOG_LINE_LIMIT = 4096;
const LOG_STRING_LIMIT = 500;
// Whole transcripts a CLI repeats on every event (Pi's agent_end and turn_end); the chat has them.
const LOG_DROPPED_KEYS = new Set(["messages", "toolResults"]);

function shrinkValue(value) {
  if (typeof value === "string")
    return value.length > LOG_STRING_LIMIT
      ? `${value.slice(0, LOG_STRING_LIMIT)}…[+${value.length - LOG_STRING_LIMIT} chars]`
      : value;
  if (Array.isArray(value)) return value.map(shrinkValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !LOG_DROPPED_KEYS.has(key))
        .map(([key, item]) => [key, shrinkValue(item)]),
    );
  return value;
}

/**
 * Bound one raw CLI log line before it is stored or classified. Lines up to 4 KB are returned
 * as they are. A longer JSON line stays valid JSON (the Activity pane parses it) with its
 * transcripts dropped and long strings cut; anything else is cut to 4 KB with a marker.
 * @param {string} line
 */
export function shrinkLogLine(line) {
  if (typeof line !== "string" || line.length <= LOG_LINE_LIMIT) return line;
  try {
    const shrunk = JSON.stringify(shrinkValue(JSON.parse(line)));
    if (shrunk.length <= LOG_LINE_LIMIT * 2) return shrunk;
  } catch {}
  return `${line.slice(0, LOG_LINE_LIMIT)}…[+${line.length - LOG_LINE_LIMIT} chars]`;
}

/** Append one line to a session's log (the last 500 are kept). */
export function addLog(session, text) {
  session.logs = [...(session.logs ?? []), text].slice(-500);
  session.updatedAt = now();
}
/** Add a message; an agent's output arriving in quick succession joins its last message. */
export function addMessage(session, role, text, extra = {}) {
  if (!text.trim()) return;
  if (role === "user") session.lastUserMessageAt = now();
  const last = session.messages.at(-1);
  if (role === "agent" && last?.role === "agent" && now() - last.at < 1200) {
    last.text += text;
    last.at = now();
  } else session.messages.push({ id: randomUUID(), role, text, at: now(), ...extra });
  session.updatedAt = now();
}

/** @param {ResolvedFile[]} files */
function attachmentMeta(files) {
  return files.length
    ? {
        attachments: files.map(({ id, name, mime, size, kind }) => ({
          id,
          name,
          mime,
          size,
          kind,
        })),
      }
    : {};
}
/** @param {ResolvedFile[]} files */
const nativeAttachments = (files) =>
  // CLIs generally treat native file arguments as prompt text or image data. A WebM can be
  // gigabytes long and is already available by path in formatAttachmentPrompt; its keyframe
  // images remain native attachments so an agent can inspect the visual feedback directly.
  files
    .filter((file) => !file.recording)
    .map(({ absPath, mime, kind, name }) => ({ path: absPath, mime, kind, name }));

const SAFETY_PREAMBLE =
  "Safety instructions: Work only in this project. Do not deploy, publish, send external communications, modify shared or production systems, or delete data. If such an action is necessary, stop and ask the user instead. Preserve existing files unless the requested code change requires editing them. ";

/**
 * @param {object} deps
 * @param {{ sessions: Session[], projects: Project[], agents: AgentRow[] }} deps.state the workspace
 * @param {() => Promise<void>} deps.save persists the workspace
 * @param {Record<string, AgentAdapter>} deps.adapters agent adapters by id
 * @param {string} deps.dataDir ADE's data folder
 * @param {(project: Project, session: Session) => TurnContext | Promise<TurnContext>} deps.turnContext dev server, agent browser and tool wiring for a project's turn
 * @param {{ append: (id: string, text: string) => Promise<unknown>, flush: (id: string) => Promise<void> }} [deps.logs]
 * @param {(scope: string) => void} [deps.emit]
 * @param {(agentId: string) => boolean} [deps.isAgentUpdating]
 * @param {(session: Session) => void} [deps.turnEnded]
 */
export function createSessionTurns({
  state,
  save,
  adapters,
  dataDir,
  turnContext,
  logs,
  emit = () => {},
  isAgentUpdating = () => false,
  turnEnded = () => {},
}) {
  /** @type {Map<string, { controller: AbortController, child?: import("node:child_process").ChildProcess }>} */
  const slots = new Map();
  /** Permission requests waiting on the user: request id → answer. */
  const waiters = new Map();

  const projectOf = (session) => state.projects.find((p) => p.id === session.projectId);
  const busy = (session) => slots.has(session.id);
  const refuseDuringAgentUpdate = (agentId) => {
    if (isAgentUpdating(agentId))
      throw new TurnRefused(
        409,
        "Wait for this agent's installation or update to finish before starting a task.",
      );
  };
  const persist = async (session) => {
    emit(`session:${session.id}`);
    await logs?.flush(session.id);
    await save();
  };
  const recordLog = (session, text) => {
    if (logs)
      void logs
        .append(session.id, text)
        .catch((error) => console.warn(`ADE could not append log for ${session.id}:`, error));
    else addLog(session, text);
    if (logs) session.updatedAt = now();
    emit(`session:${session.id}`);
    emit(`logs:${session.id}`);
  };
  /** @param {Session} session @param {string} status */
  const setStatus = (session, status) => {
    session.status = status;
    emit(`session:${session.id}`);
  };
  /** Take the session's slot, or null when a run already holds it. Synchronous by design. */
  const claim = (session) => {
    if (slots.has(session.id)) return null;
    const slot = { controller: new AbortController() };
    slots.set(session.id, slot);
    return slot;
  };
  /** Hand a finished run's slot straight to the next run, never freeing it in between. */
  const renew = (session) => {
    const slot = { controller: new AbortController() };
    slots.set(session.id, slot);
    return slot;
  };
  const free = (session, slot) => {
    if (slots.get(session.id) === slot) slots.delete(session.id);
  };
  /** Stop whatever holds the slot: its process now, a checks run at the next step. */
  const interrupt = (session) => {
    const slot = slots.get(session.id);
    if (!slot) return;
    slot.controller.abort();
    if (slot.child) stopProcess(slot.child);
  };
  /**
   * Answer every open ACP permission request "cancelled" (the turn is ending) and clear them.
   * Dev command approvals live on `session.pendingDevCommand` / the project and outlive the turn
   * (see dev-command.mjs). Pre-demux leftovers with `kind === "dev_command"` in the permissions
   * array are dropped without answering.
   */
  const dropPermissions = (session) => {
    for (const request of session.pendingPermissions ?? []) {
      if (request.kind === "dev_command") continue;
      waiters.get(request.id)?.({ outcome: "cancelled" });
      waiters.delete(request.id);
    }
    delete session.pendingPermissions;
  };
  /** Files that were already dirty before this turn are the user's, not the agent's. */
  const flagBaseline = (session, changes) => {
    const baseline = new Set(session.baselineFiles ?? []);
    return changes.map((c) => (baseline.has(c.path) ? { ...c, preExisting: true } : c));
  };
  const refuseIfComplete = (session, what) => {
    if (session.status === "complete")
      throw new TurnRefused(409, `Reopen this session before ${what}.`);
  };
  /** "Send now": interrupt the current run; the message runs as soon as it has stopped. */
  const steer = (session, prompt, attachmentBatches = []) => {
    session.steerNow = prompt;
    session.steerNowAttachments = attachmentBatches;
    setStatus(session, "working");
    interrupt(session);
    recordLog(session, "Switching to your message.");
  };

  /** Add the original request to the first turn after switching providers. */
  function agentHandoffPrompt(session, prompt) {
    return (
      `A different coding agent worked on this task before you. Review the current repository state and continue or finish it. Original request: ${session.request}` +
      (session.criteria ? `\nAcceptance criteria: ${session.criteria}` : "") +
      `\n\nUser follow-up: ${prompt}`
    );
  }

  /**
   * After a run, in this order: the "send now" message, then the queue, then
   * `settle` (the run's own outcome). A stopped or completed session keeps
   * its status. The slot passes straight to a next turn, or is released.
   */
  async function afterRun(session, slot, settle) {
    if (session.steerNow && !SETTLED.includes(session.status)) {
      const prompt = session.steerNow;
      delete session.steerNow;
      const batches = session.steerNowAttachments ?? [];
      delete session.steerNowAttachments;
      return begin(session, renew(session), {
        prompt,
        continuing: true,
        attachments: batches.flat(),
      });
    }
    if (!SETTLED.includes(session.status)) {
      const queue = session.queuedMessages ?? [];
      if (queue.length) {
        session.queuedMessages = [];
        const batches = session.queuedAttachments ?? [];
        delete session.queuedAttachments;
        const prompt = queue.join("\n\n");
        const fresh = session.agentStartFresh === true;
        delete session.agentStartFresh;
        return begin(session, renew(session), {
          prompt: fresh ? agentHandoffPrompt(session, prompt) : prompt,
          continuing: !fresh,
          attachments: batches.flat(),
        });
      }
      settle();
    }
    free(session, slot);
    await persist(session);
    turnEnded(session);
  }

  /** @param {{ prompt: string, continuing: boolean, attachments: object[] }} input */
  async function begin(session, slot, input) {
    setStatus(session, "working");
    await persist(session);
    void runTurn(session, slot, input);
  }

  async function buildManifest(session, project, agent, context) {
    const files = (await projectFiles(project)).slice(0, 400);
    const candidates = files.filter((file) =>
      /(readme|package\.json|src|app|lib|components|routes|pages|server|api|test|spec)/i.test(file),
    );
    return {
      createdAt: now(),
      project: { id: project.id, name: project.name, path: project.path, branch: project.branch },
      task: session.request,
      ...(session.criteria ? { acceptanceCriteria: session.criteria } : {}),
      agent: {
        id: session.agentId,
        account: agent?.account ?? null,
        model: session.model ?? "agent default",
      },
      devServer: context.devServer,
      agentComputer: context.agentBrowser,
      otherServices: await otherServicesNote(project),
      constraints: [
        "Work only within the project directory",
        "No deployments, publishing, or external/shared-system changes without the user",
        "Do not revert or overwrite user changes",
        "The devServer status is ADE's observed snapshot at turn start. If it includes a running URL, use that URL instead of asking the user which frontend port to open. Do not infer that other services are running from the frontend alone.",
        "Start, stop, and inspect the dev server only with the dev_server_start/dev_server_stop/dev_server_status tools; never start a server yourself (no nohup, &, disown, or a foreground dev command) and never leave one running that ADE does not manage. When the project has no package.json dev script and no approved dev command, propose one: call dev_server_start with command (one program and its arguments, no shell operators; {port} becomes the port ADE picks, also in PORT) and cwd (its folder relative to the project root), and ADE asks the user to approve it once",
        "After changing anything visible, verify it in your agent browser (computer_open_url, screenshots, clicks, typing) before reporting done, and say what you checked; if the browser tools fail, report the exact error instead of claiming it works",
      ],
      relevantFiles: candidates.slice(0, 60),
      tools: agent?.tools ?? "agent's default CLI tools",
      dirtyWorktree: (project.uncommittedFiles ?? []).length > 0,
      ...(project.uncommittedFiles?.length
        ? { uncommittedFiles: project.uncommittedFiles.slice(0, 40) }
        : {}),
    };
  }

  /** The manifest as the agent reads it, at the top of every prompt. */
  function manifestLine(session, project) {
    const manifest = session.manifest;
    return (
      `Context manifest: project ${project.name} (${project.branch}); task: ${session.request}` +
      (session.criteria ? `; acceptance criteria: ${session.criteria}` : "") +
      `; model: ${session.model ?? "agent default"}` +
      `; dev server at turn start: ${manifest.devServer}` +
      `; other services: ${manifest.otherServices}` +
      `; agent browser: ${manifest.agentComputer.available ? `available (${manifest.agentComputer.screen}; tools: ${manifest.agentComputer.tools}). ` : "unavailable. "}${manifest.agentComputer.note}` +
      `; constraints: ${manifest.constraints.join("; ")}; candidate files: ${manifest.relevantFiles.join(", ") || "(none listed)"}` +
      (manifest.uncommittedFiles
        ? `; the user has uncommitted changes in these files: ${manifest.uncommittedFiles.join(", ")} — never revert, stash, commit, or overwrite them; work around them`
        : "")
    );
  }

  /** What the user reads when a turn failed, by what went wrong. */
  function failureMessage(session, agent, kind, texts, end) {
    const modelNote = session.model ? ` The selected model was "${session.model}".` : "";
    if (kind === "provider_quota") {
      const hint = retryHint(texts);
      return `Provider quota or rate limit reached — no work was performed.${hint ? ` ${hint}.` : ""} Your task is kept; nothing in the project was changed. Retry later or switch agents.`;
    }
    if (kind === "model_not_found") {
      const suggestion = modelSuggestion(texts);
      return `The agent rejected the selected model — no work was performed.${modelNote}${suggestion ? ` ${suggestion}` : ""} Pick a different model with Change model, or clear it to use the agent's configured default, then send a follow-up. Nothing in the project was changed; your task is kept.`;
    }
    if (kind === "provider_unavailable")
      return `The agent reported that its provider is unavailable — no work was performed.${modelNote} Check this CLI's own provider setup (Agents page); ADE does not manage provider credentials. Nothing in the project was changed.`;
    if (kind === "auth_expired")
      return `The agent's sign-in or credentials were refused — no work was performed. Re-authenticate with this CLI's own sign-in flow from the Agents page, then retry. Nothing in the project was changed; your task is kept.`;
    if (kind === "context_overflow")
      return `The conversation exceeded the model's context window and the turn stopped. Shorten or summarize your follow-up (or start a fresh session for a narrower task); a larger-context model may also help — use Change model. Any project edits made before the failure were left in place.`;
    if (end.reason === "unfinished")
      return `${agent.name} did not finish this turn; its own error is shown above and in Logs. Any project edits it made before stopping are kept. Your task is kept — retry, switch model, or switch agents.`;
    if (end.reason === "reported")
      return `The agent reported that this turn failed and produced no result; nothing was applied. The CLI's own error is shown above and in Logs. Your task is kept — retry, switch model, or switch agents.`;
    const exit = end.reason === "exit" ? end.exit : { code: 1, signal: null };
    return `Agent process exited with ${exit.signal ?? `code ${exit.code}`}. Existing project changes were left in place. See Logs for details.`;
  }

  /**
   * Run one turn in the slot it was given, then hand the slot on (afterRun).
   * Never rejects: every failure ends as a blocked session with a message.
   * @param {Session} session
   * @param {{ controller: AbortController, child?: any }} slot
   * @param {{ prompt: string, continuing: boolean, attachments: object[] }} input
   */
  async function runTurn(session, slot, { prompt, continuing, attachments }) {
    const project = projectOf(session);
    if (!project) {
      free(session, slot);
      return;
    }
    const agent = state.agents.find((a) => a.id === session.agentId);
    const adapter = adapters[session.agentId];
    if (!agent?.installed || !agent.signedIn || !adapter) {
      setStatus(session, "blocked");
      addMessage(
        session,
        "system",
        `${agent?.name ?? session.agentId} is not available or not authenticated. Check the Agents page.`,
      );
      free(session, slot);
      await persist(session);
      return;
    }
    // Only this turn's own output decides its outcome, never earlier history.
    const turn = { texts: /** @type {string[]} */ ([]), sawText: false, spawned: false };
    /** @type {TurnIO} */
    const io = {
      signal: slot.controller.signal,
      emit(event) {
        if (event.type === "text") {
          addMessage(session, "agent", event.text);
          if (event.text.trim()) turn.sawText = true;
        } else if (event.type === "log") {
          // The adapter already parsed the raw line; what is kept only needs the failure wording,
          // which sits in short lines or in the first 500 characters of a field.
          const line = shrinkLogLine(event.line);
          recordLog(session, line);
          turn.texts.push(line);
        } else if (event.type === "notice" || event.type === "error") {
          addMessage(session, "system", event.text);
          turn.texts.push(event.text);
          if (event.type === "notice") void persist(session);
        } else if (event.type === "conversation") session.agentSessionId = event.id;
        else if (event.type === "default-model") session.acpDefaultModel = event.id;
      },
      ask(request) {
        return new Promise((resolve) => {
          if (slot.controller.signal.aborted) return resolve({ outcome: "cancelled" });
          const entry = { id: randomUUID(), at: now(), ...request };
          session.pendingPermissions = [...(session.pendingPermissions ?? []), entry];
          waiters.set(entry.id, resolve);
          addLog(
            session,
            JSON.stringify({ type: "permission", decision: "asked", title: request.title }),
          );
          void persist(session);
        });
      },
      spawn(bin, args, { env = {}, stdin = "ignore" } = {}) {
        // The user stopped the session (or sent a message now) while the turn
        // was being prepared: never start a CLI nobody is waiting for.
        if (slot.controller.signal.aborted) throw new Error("The turn was interrupted.");
        const child = spawnCommand(bin, args, {
          cwd: project.path,
          env: { ...process.env, ...env },
          stdio: [stdin, "pipe", "pipe"],
          shell: false,
          detached: process.platform !== "win32",
        });
        session.pid = child.pid;
        slot.child = child;
        turn.spawned = true;
        return child;
      },
    };

    /** @type {TurnEnd | null} */
    let end = null;
    try {
      setStatus(session, "working");
      await persist(session);
      await projectInfo(project);
      delete session.changeCountUnavailable;
      // Refresh the baseline at the start of every turn so it reflects the
      // tree as it is right now (the user may edit between turns).
      if (project.uncommittedFiles?.length)
        session.baselineFiles = (await getDiff(project)).files.map((f) => f.path);
      else delete session.baselineFiles;
      const context = await turnContext(project, session);
      session.manifest = await buildManifest(session, project, agent, context);
      addLog(
        session,
        `Context manifest: ${session.manifest.relevantFiles.length} candidate files, tools: ${session.manifest.tools}`,
      );
      end = await adapter.runTurn(
        {
          projectPath: project.path,
          prompt: `${SAFETY_PREAMBLE}${manifestLine(session, project)}\n\nTask: ${prompt}`,
          session: {
            id: session.id,
            agentSessionId: session.agentSessionId,
            agentSessionKey: session.agentSessionKey,
          },
          continuing,
          dataDir,
          providers: agent.providers,
          version: agent.version ?? "",
          model: session.model,
          defaultModel: session.acpDefaultModel,
          effort: session.effort,
          speed: session.speed,
          permission: session.permission,
          attachments: /** @type {any} */ (attachments),
          computer: context.computer,
        },
        io,
      );
    } catch (error) {
      if (turn.spawned) end = { ok: false, reason: "unfinished" };
      else if (slot.controller.signal.aborted) {
        if (session.status === "stopped")
          recordLog(session, "Turn not started: the session was stopped before the CLI launched.");
      } else {
        if (!SETTLED.includes(session.status)) setStatus(session, "blocked");
        addMessage(
          session,
          "system",
          `ADE could not start this turn: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    slot.child = undefined;
    delete session.pid;
    dropPermissions(session);
    // Refresh the live diff on every exit path and flag the user's own files.
    if (turn.spawned) session.changes = flagBaseline(session, (await getDiff(project)).changes);
    await afterRun(session, slot, () => {
      if (!end) return;
      // A CLI can exit 0 after its own settled error, or with no output and
      // real error wording (OpenCode on a rejected model): never report
      // "ready to review" for a turn that produced nothing.
      let failed = !end.ok;
      if (!failed && !turn.sawText && classifyFailure(turn.texts) !== "process") failed = true;
      // failureKind describes the current turn only: success and generic
      // process failures clear an earlier diagnosis.
      const kind = failed ? classifyFailure(turn.texts) : undefined;
      if (kind && kind !== "process") session.failureKind = kind;
      else delete session.failureKind;
      setStatus(session, failed ? "blocked" : "ready");
      if (!failed && !turn.sawText)
        addMessage(
          session,
          "system",
          "The CLI exited successfully but did not emit a parseable response. Review the Logs tab for its raw output.",
        );
      // A process that never started has already said why.
      if (failed && !(!end.ok && end.reason === "spawn"))
        addMessage(session, "system", failureMessage(session, agent, kind, turn.texts, end));
      session.summary = session.messages.filter((m) => m.role === "agent").at(-1)?.text;
      session.updatedAt = now();
      session.checks = [
        {
          name: "Project checks",
          status: "not_run",
          detail: "ADE did not run checks automatically.",
        },
      ];
    });
  }

  return {
    /** Whether a turn or checks run holds the session's slot (including a process still exiting). */
    isBusy: busy,

    /**
     * Create a session and start its first turn. Refuses (409) while another
     * session in the project is running.
     * @param {{ project: Project, agentId: string, request: string, criteria: string, text: string, files: ResolvedFile[], presentation?: Message['presentation'], model?: string, options: object, baseline: { changes: any[], files: { path: string }[] } | null }} draft
     */
    async start({
      project,
      agentId,
      request,
      criteria,
      text,
      files,
      presentation,
      model,
      options,
      baseline,
    }) {
      refuseDuringAgentUpdate(agentId);
      if (
        state.sessions.some(
          (s) =>
            s.projectId === project.id && (busy(s) || ["working", "verifying"].includes(s.status)),
        )
      )
        throw new TurnRefused(
          409,
          "Another agent task is still running in this project. Wait until it stops before starting another.",
        );
      /** @type {Session} */
      const session = {
        id: randomUUID(),
        projectId: project.id,
        agentId,
        createdBy: agentId,
        request,
        criteria,
        status: "working",
        messages: [
          {
            id: randomUUID(),
            role: "user",
            text,
            at: now(),
            ...attachmentMeta(files),
            ...(presentation ? { presentation } : {}),
          },
        ],
        changes: baseline ? baseline.changes.map((c) => ({ ...c, preExisting: true })) : [],
        ...(baseline ? { baselineFiles: baseline.files.map((f) => f.path) } : {}),
        checks: [{ name: "Project checks", status: "not_run", detail: "Not run yet." }],
        logs: [],
        createdAt: now(),
        updatedAt: now(),
        queuedMessages: [],
        ...(model ? { model } : {}),
        ...options,
      };
      state.sessions.unshift(session);
      const slot = /** @type {NonNullable<ReturnType<typeof claim>>} */ (claim(session));
      await persist(session);
      void runTurn(session, slot, {
        prompt: `${text}${formatAttachmentPrompt(files)}`,
        continuing: false,
        attachments: nativeAttachments(files),
      });
      return session;
    },

    /**
     * Send a follow-up. Idle: it runs now. Busy: it waits ("later") or
     * interrupts the current run and goes next ("now").
     * @param {Session} session @param {Message} message @param {"now" | "later"} [when]
     */
    async send(session, { text, files = [], presentation }, when = "later") {
      refuseIfComplete(session, "sending a message");
      refuseDuringAgentUpdate(session.agentId);
      const fresh = session.agentStartFresh === true;
      const rawPrompt = `${text}${formatAttachmentPrompt(files)}`;
      const prompt = fresh ? agentHandoffPrompt(session, rawPrompt) : rawPrompt;
      addMessage(session, "user", text, {
        ...attachmentMeta(files),
        ...(presentation ? { presentation } : {}),
      });
      if (busy(session)) {
        const attachments = nativeAttachments(files);
        if (when === "now") steer(session, prompt, [attachments]);
        else {
          (session.queuedMessages ??= []).push(prompt);
          (session.queuedAttachments ??= []).push(attachments);
          recordLog(session, "Follow-up queued until the current CLI turn exits.");
        }
        await persist(session);
        return session;
      }
      const slot = /** @type {NonNullable<ReturnType<typeof claim>>} */ (claim(session));
      if (!fresh) {
        session.queuedMessages = [];
        delete session.queuedAttachments;
      }
      delete session.agentStartFresh;
      setStatus(session, "working");
      await persist(session);
      void runTurn(session, slot, {
        prompt,
        continuing: !fresh,
        attachments: nativeAttachments(files),
      });
      return session;
    },

    /** Send the waiting messages now, interrupting the current run if there is one. */
    async release(session) {
      refuseIfComplete(session, "sending a message");
      refuseDuringAgentUpdate(session.agentId);
      const waiting = [...(session.queuedMessages ?? [])];
      const attachmentBatches = session.queuedAttachments ?? [];
      if (!waiting.length) throw new TurnRefused(400, "There is no waiting message to send.");
      session.queuedMessages = [];
      delete session.queuedAttachments;
      const prompt = waiting.join("\n\n");
      if (busy(session)) steer(session, prompt, attachmentBatches);
      else {
        recordLog(session, "Sending the waiting message.");
        const slot = /** @type {NonNullable<ReturnType<typeof claim>>} */ (claim(session));
        const fresh = session.agentStartFresh === true;
        const freshPrompt = fresh ? agentHandoffPrompt(session, prompt) : prompt;
        delete session.agentStartFresh;
        setStatus(session, "working");
        await persist(session);
        void runTurn(session, slot, {
          prompt: freshPrompt,
          continuing: !fresh,
          attachments: attachmentBatches.flat(),
        });
        return session;
      }
      await persist(session);
      return session;
    },

    /** Forget the waiting messages. */
    async drop(session) {
      refuseIfComplete(session, "sending a message");
      const waiting = (session.queuedMessages ?? []).length;
      session.queuedMessages = [];
      delete session.queuedAttachments;
      if (waiting) addMessage(session, "system", "The waiting message will not be sent.");
      await persist(session);
      return session;
    },

    /** Stop the current run, if any, and keep the session stopped. */
    async stop(session) {
      const alreadyStopped = session.status === "stopped";
      setStatus(session, "stopped");
      // A stop cancels an in-flight "send now" so the exit does not restart work.
      delete session.steerNow;
      delete session.steerNowAttachments;
      dropPermissions(session);
      if (busy(session)) interrupt(session);
      else stopProcess(session.pid);
      recordLog(session, "Stopped by user. Existing worktree changes are kept.");
      if (!alreadyStopped)
        addMessage(
          session,
          "system",
          "Stopped. Files are kept. Send a message when you want it to continue.",
        );
      await persist(session);
      return session;
    },

    /** Answer a permission request with one of the options the agent offered. */
    async answer(session, requestId, optionId) {
      const request = (session.pendingPermissions ?? []).find((p) => p.id === requestId);
      const resolve = request && waiters.get(request.id);
      if (!resolve) throw new TurnRefused(409, "The agent is no longer waiting for this answer.");
      // Only an option the agent itself offered; ADE never invents one.
      const option = request.options.find((o) => o.optionId === optionId);
      if (!option) throw new TurnRefused(400, "Choose one of the options the agent offered.");
      session.pendingPermissions = session.pendingPermissions.filter((p) => p !== request);
      if (!session.pendingPermissions.length) delete session.pendingPermissions;
      waiters.delete(request.id);
      resolve({ outcome: "selected", optionId: option.optionId });
      addLog(
        session,
        JSON.stringify({
          type: "permission",
          decision: option.kind.startsWith("allow") ? "allowed" : "rejected",
          title: request.title,
          option: option.name,
        }),
      );
      await persist(session);
      return session;
    },

    /**
     * Change the selected agent and its options without starting a turn. The
     * next user message starts a fresh agent conversation against the current
     * repository state.
     * @param {Session} session @param {string} agentId
     * @param {{ model?: string, options?: Record<string, string>, cleared?: Set<string> }} [selection]
     */
    async switchAgent(session, agentId, selection = {}) {
      const target = state.agents.find((a) => a.id === agentId);
      if (!target?.installed || !target.signedIn)
        throw new TurnRefused(
          400,
          `${target?.name ?? agentId} must be installed and authenticated before switching.`,
        );
      if (!projectOf(session)) throw new TurnRefused(404, "Project not found.");
      if (busy(session))
        throw new TurnRefused(
          409,
          "Stop or wait for the current CLI turn to finish before switching agents.",
        );
      refuseIfComplete(session, "switching agents");
      const from = state.agents.find((a) => a.id === session.agentId);
      // A previous provider failure no longer describes the newly selected
      // agent. Keep the session idle until the user explicitly sends a turn.
      if (session.status === "blocked") setStatus(session, "stopped");
      delete session.failureKind;
      session.createdBy = session.agentId;
      session.agentId = target.id;
      session.agentSessionId = undefined;
      // Pi stores conversations by file path instead of returning a resumable
      // conversation id. A new key prevents switching back from reopening its
      // previous provider conversation.
      session.agentSessionKey = randomUUID();
      delete session.acpDefaultModel;
      // Effort and speed are model-scoped too: a level valid for the old CLI
      // (e.g. Pi's "high") can map to a flag the new CLI rejects outright.
      const droppedModel = session.model;
      const droppedEffort = session.effort;
      const droppedSpeed = session.speed;
      if (selection.model) session.model = selection.model;
      else delete session.model;
      for (const key of ["effort", "speed", "permission"]) {
        if (selection.cleared?.has(key)) delete session[key];
        else if (selection.options?.[key] !== undefined) session[key] = selection.options[key];
        else delete session[key];
      }
      session.agentStartFresh = true;
      addMessage(
        session,
        "system",
        `Switched from ${from?.name ?? session.createdBy} to ${target.name}. No agent turn was started. The new agent will start a fresh conversation when you send a message; the repository state, task, and current diff carry over, but the prior conversation does not.` +
          (droppedModel ? ` The previous model (${droppedModel}) belonged to the old agent.` : "") +
          (selection.model
            ? ` The selected model is "${selection.model}".`
            : ` ${target.name} will use its configured default model.`) +
          (droppedEffort || droppedSpeed
            ? " The previous model's effort and speed settings were replaced with the new agent's selections."
            : ""),
      );
      addLog(
        session,
        `agent switch: ${from?.short ?? session.createdBy} → ${target.short} (no agent turn started; conversation not carried)`,
      );
      await persist(session);
      return session;
    },

    /**
     * Run the project's checks on a session that is ready to review. Settles
     * when the checks (and anything sent meanwhile) have been handed on.
     * @param {Session} session
     */
    async runChecks(session) {
      if (busy(session))
        throw new TurnRefused(409, "Stop or wait for the agent before running checks.");
      if (session.status !== "ready")
        throw new TurnRefused(
          409,
          `Checks run only when the session is ready to review; this session is "${session.status}".`,
        );
      const slot = /** @type {NonNullable<ReturnType<typeof claim>>} */ (claim(session));
      const { signal } = slot.controller;
      setStatus(session, "verifying");
      const project = projectOf(session);
      if (project) {
        const checks = await checksFor(project);
        // A stop (or reopen) may have landed while checksFor was reading.
        const stillVerifying = () => session.status === "verifying";
        if (!signal.aborted && stillVerifying()) {
          session.checks = checks.filter((check) => !check.script);
          for (const check of checks.filter((item) => item.script)) {
            // A checks run has no process to stop: an interrupt takes effect
            // between steps.
            if (signal.aborted || SETTLED.includes(session.status)) break;
            if (!check.command) throw new Error(`Runnable check ${check.script} has no command.`);
            const command = check.command;
            const [manager = "npm"] = command.split(" ");
            const r = await runCommand(manager, ["run", check.script], {
              cwd: project.path,
              timeout: 120000,
            });
            const output = (r.stdout + r.stderr).trim().slice(-4000);
            session.checks.push({
              name: check.name,
              status: r.code === 0 ? "passed" : "failed",
              detail: `${command} · exit ${r.code}\n${output}`,
            });
            recordLog(session, `$ ${command}\n${output}`);
            await persist(session);
          }
        }
        session.updatedAt = now();
      }
      await afterRun(session, slot, () => setStatus(session, "ready"));
      return session;
    },

    /** Mark a session done; only once its agent has stopped. */
    async complete(session) {
      if (!["ready", "blocked", "stopped"].includes(session.status))
        throw new TurnRefused(409, "Wait for the agent to stop before completing this session.");
      if (busy(session))
        throw new TurnRefused(
          409,
          "The agent is still running. Wait for it to stop before completing this session.",
        );
      setStatus(session, "complete");
      session.completedAt = now();
      await persist(session);
      return session;
    },

    /** Make a completed session ready to work on again. */
    async reopen(session) {
      setStatus(session, "ready");
      session.completedAt = undefined;
      await persist(session);
      return session;
    },

    /**
     * After ADE restarts: stop processes left from interrupted turns (only
     * ones that are really ours), mark those sessions stopped, and forget what
     * died with them. Returns whether anything changed.
     */
    async recover() {
      let changed = false;
      for (const session of state.sessions) {
        const project = projectOf(session);
        if (session.pid && project && (await processRunsIn(session.pid, project.path)))
          stopProcess(session.pid);
        if (["working", "verifying"].includes(session.status)) {
          setStatus(session, "stopped");
          addMessage(
            session,
            "system",
            "ADE restarted and stopped the interrupted CLI process. Any project edits made before it stopped are kept.",
          );
          changed = true;
        }
        // A permission request dies with the agent process that asked it. Dev command
        // approvals are memory-only and re-proposed after restart (see dev-command.mjs).
        for (const key of [
          "pid",
          "steerNow",
          "steerNowAttachments",
          "pendingPermissions",
          "pendingDevCommand",
          "checksCancelled",
        ])
          if (key in session) {
            delete session[key];
            changed = true;
          }
      }
      return changed;
    },
  };
}
