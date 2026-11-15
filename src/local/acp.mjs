// Agent Client Protocol (ACP) client for one ADE agent turn: newline-delimited
// JSON-RPC 2.0 over the agent process's stdin/stdout (protocol version 1, see
// https://agentclientprotocol.com). ADE spawns the agent per turn like every
// other CLI; this module runs initialize → resume/load/new → mode → model →
// prompt on that process and reports through callbacks. listAcpModels reads
// an agent's model list the same way, without a prompt. It holds no ADE state.
// ADE advertises no fs or terminal capability, so the agent keeps using its
// own file and shell tools — ADE only answers permission requests.
import { promises as fsp } from "node:fs";
import {
  awaitsChangeReport,
  changeReport,
  claimsCreation,
  clip,
  lateResultFields,
  mergeToolCall,
  TOOL_KINDS,
  toolResultFields,
} from "./acp-activity.mjs";

export const ACP_PROTOCOL_VERSION = 1;
const AUTH_REQUIRED = -32000;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

/** Tool kinds a Plan session never approves: Plan is read-only. */
const PLAN_DECLINES = new Set(["edit", "delete", "move", "execute", "switch_mode"]);
const PERMISSION_KINDS = new Set(["allow_once", "allow_always", "reject_once", "reject_always"]);
/** Activity names for agents that report only a tool kind, not a tool name. */
const KIND_TOOL = {
  read: "read",
  edit: "edit",
  delete: "delete",
  move: "move",
  search: "search",
  execute: "bash",
  fetch: "fetch",
  think: "think",
};

export class AcpError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/**
 * A JSON-RPC 2.0 peer over newline-delimited JSON. `onRequest` answers the
 * agent's requests (a throw becomes a JSON-RPC error), `onNotification` takes
 * its notifications, `onInvalid` gets stdout lines that are not JSON-RPC.
 */
export function createRpc(input, output, { onRequest, onNotification, onInvalid }) {
  let nextId = 1;
  let closed = null;
  let buffer = "";
  const pending = new Map();
  // An agent that dies mid-write turns our next write into EPIPE; the close
  // path reports the exit, so the write error itself is not the story.
  output.on?.("error", () => {});
  const send = (message) => {
    if (!closed && output.writable !== false) output.write(`${JSON.stringify(message)}\n`);
  };
  const answer = (id, method, params) =>
    Promise.resolve()
      .then(() => onRequest(method, params))
      .then(
        (result) => send({ jsonrpc: "2.0", id, result: result ?? null }),
        (error) =>
          send({
            jsonrpc: "2.0",
            id,
            error: {
              code: Number.isInteger(error?.code) ? error.code : INTERNAL_ERROR,
              message: error?.message ?? String(error),
            },
          }),
      );
  const receive = (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      onInvalid?.(line);
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      onInvalid?.(line);
      return;
    }
    if (typeof message.method === "string") {
      if (message.id !== undefined && message.id !== null)
        void answer(message.id, message.method, message.params);
      else onNotification?.(message.method, message.params);
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) {
      onInvalid?.(line);
      return;
    }
    pending.delete(message.id);
    if (message.error)
      waiter.reject(
        new AcpError(String(message.error.message ?? "ACP request failed"), message.error.code),
      );
    else waiter.resolve(message.result);
  };
  input.setEncoding?.("utf8");
  input.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) receive(line);
    }
  });
  return {
    request(method, params) {
      if (closed) return Promise.reject(closed);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ jsonrpc: "2.0", id, method, params });
      });
    },
    notify(method, params) {
      send({ jsonrpc: "2.0", method, params });
    },
    close(error) {
      if (closed) return;
      closed = error;
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
    },
  };
}

/** Structured tool name (never the free-text title), MCP server prefix dropped. */
export function toolNameOf(toolCall) {
  const raw =
    (typeof toolCall?.name === "string" && toolCall.name) ||
    (typeof toolCall?._meta?.claudeCode?.toolName === "string" &&
      toolCall._meta.claudeCode.toolName);
  if (raw) return raw.replace(/^mcp__.+?__/, "");
  return KIND_TOOL[toolCall?.kind] ?? "tool";
}

/**
 * Short scalar fields of a tool's input: never file contents or diffs. The tool's title is
 * logged beside it, so a tool with no such fields has an empty input.
 */
function compactInput(toolCall) {
  const raw = toolCall?.rawInput && typeof toolCall.rawInput === "object" ? toolCall.rawInput : {};
  const input = {};
  const command = raw.command ?? raw.cmd;
  const filePath =
    raw.file_path ??
    raw.filePath ??
    raw.notebook_path ??
    raw.path ??
    toolCall?.locations?.[0]?.path;
  if (typeof command === "string") input.command = clip(command, 300);
  if (typeof filePath === "string") input.path = clip(filePath, 300);
  for (const key of ["pattern", "url", "query"])
    if (typeof raw[key] === "string") input[key] = clip(raw[key], 200);
  return input;
}

/** What the user needs to judge a permission request, bounded (it is agent-supplied). */
function describeRequest(toolCall) {
  const input = compactInput(toolCall);
  const paths = (toolCall?.content ?? [])
    .filter((item) => item?.type === "diff" && typeof item.path === "string")
    .map((item) => item.path);
  const text = (toolCall?.content ?? [])
    .map((item) =>
      item?.type === "content" && item.content?.type === "text" ? item.content.text : "",
    )
    .find(Boolean);
  const detail =
    input.command ??
    (paths.length ? paths.join(", ") : undefined) ??
    input.path ??
    input.url ??
    (text ? String(text) : undefined);
  return {
    title: clip(toolCall?.title || toolNameOf(toolCall), 300),
    kind: typeof toolCall?.kind === "string" ? toolCall.kind : "other",
    ...(detail ? { detail: clip(detail, 600) } : {}),
  };
}

/** The plan carried by a mode-switch request: its input's `plan`, else its text content. */
function planText(toolCall) {
  const raw = toolCall?.rawInput?.plan;
  const content = (toolCall?.content ?? []).find(
    (item) => item?.type === "content" && item.content?.type === "text",
  )?.content?.text;
  const plan = typeof raw === "string" && raw.trim() ? raw : content;
  return typeof plan === "string" ? plan.slice(0, 20000) : "";
}

function permissionOptions(options) {
  return (Array.isArray(options) ? options : [])
    .filter(
      (option) =>
        typeof option?.optionId === "string" &&
        option.optionId &&
        PERMISSION_KINDS.has(option.kind),
    )
    .map((option) => ({
      optionId: option.optionId,
      name: clip(option.name || option.kind, 80),
      kind: option.kind,
    }));
}

/** Flat values of a `select` config option (options may be grouped). */
export function selectValues(option) {
  return (Array.isArray(option?.options) ? option.options : [])
    .flatMap((entry) => (Array.isArray(entry?.options) ? entry.options : [entry]))
    .filter((entry) => typeof entry?.value === "string" && entry.value);
}

/** Wraps rpc.request so an auth failure reads as ADE's auth_expired wording. */
const authAware = (rpc) => async (method, params) => {
  try {
    return await rpc.request(method, params);
  } catch (error) {
    if (error?.code === AUTH_REQUIRED)
      throw new AcpError(`Authentication required: ${error.message}`, AUTH_REQUIRED);
    throw error;
  }
};

/** Fail pending requests when the agent cannot start or exits early. */
function watchExit(child, rpc, name, unfinished) {
  child.once("error", (error) =>
    rpc.close(new AcpError(`${name} failed to start: ${error.message}`)),
  );
  child.once("close", (code, signal) =>
    rpc.close(new AcpError(`${name} exited (${signal ?? `code ${code}`}) ${unfinished}`)),
  );
}

/** The initialize handshake; resolves with the agent's capabilities. */
async function initialize(call, name, clientVersion, acpAuth) {
  const init = await call("initialize", {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: "ade", title: "ADE", version: clientVersion ?? "0" },
  });
  if (init?.protocolVersion !== ACP_PROTOCOL_VERSION)
    throw new AcpError(
      `${name} speaks ACP protocol version ${init?.protocolVersion ?? "(none)"}; ADE supports version ${ACP_PROTOCOL_VERSION}.`,
    );
  if (acpAuth) {
    const offered = new Set((init.authMethods ?? []).map((method) => method?.id));
    const methodId = acpAuth.methods.find((method) => offered.has(method));
    if (!methodId)
      throw new AcpError(acpAuth.missingMessage ?? `${name} needs authentication.`, AUTH_REQUIRED);
    await call("authenticate", { methodId, ...(acpAuth.meta ? { _meta: acpAuth.meta } : {}) });
  }
  return init.agentCapabilities ?? {};
}

const modelOptionOf = (opened) =>
  (opened?.configOptions ?? []).find(
    (option) => option?.category === "model" && option.type === "select",
  );
const effortOptionOf = (opened) =>
  (opened?.configOptions ?? []).find(
    (option) => option?.category === "thought_level" && option.type === "select",
  );

function effortFields(opened) {
  const option = effortOptionOf(opened);
  if (!option) return { efforts: [] };
  const efforts = selectValues(option)
    .map((entry) => entry.value)
    .filter((id) => id !== "default");
  return {
    efforts,
    ...(option.currentValue && option.currentValue !== "default"
      ? { defaultEffort: option.currentValue }
      : {}),
  };
}

/** Picker rows for a model option's values. */
const modelRows = (values) =>
  values.map((entry) => ({
    id: entry.value,
    ...(entry.name && entry.name !== entry.value ? { label: clip(entry.name, 80) } : {}),
    ...(entry.description ? { meta: clip(entry.description, 120) } : {}),
  }));

// Some agents still use ACP's earlier SessionModelState and set_model API.
// Only use it when the session actually advertises that model list.
function legacyModelRows(opened) {
  const entries = opened?.models?.availableModels;
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => typeof entry?.modelId === "string")
    .map((entry) => {
      const efforts = (entry._meta?.reasoningEfforts ?? [])
        .map((effort) => effort?.value ?? effort?.id)
        .filter((effort) => typeof effort === "string" && effort);
      const defaultEffort = entry._meta?.reasoningEfforts?.find((effort) => effort?.default);
      return {
        id: entry.modelId,
        ...(entry.name && entry.name !== entry.modelId ? { label: clip(entry.name, 80) } : {}),
        ...(efforts.length ? { efforts } : {}),
        ...(defaultEffort ? { defaultEffort: defaultEffort.value ?? defaultEffort.id } : {}),
      };
    });
}

/**
 * The models an ACP agent offers, read from a session it opens but is never
 * prompted in (ACP has no listing method). Resolves with [] when it offers no
 * model choice. The caller owns the process, as for runAcpTurn.
 * @param {{ child: any, name: string, cwd: string, sessionMeta?: object, clientVersion?: string, acpAuth?: {methods: string[], meta?: object, missingMessage?: string} }} options
 */
export async function listAcpModels({ child, name, cwd, sessionMeta, clientVersion, acpAuth }) {
  const rpc = createRpc(child.stdout, child.stdin, {
    onRequest(method) {
      throw new AcpError(`ADE does not implement ${method}.`, METHOD_NOT_FOUND);
    },
  });
  watchExit(child, rpc, name, "before reporting its models.");
  const call = authAware(rpc);
  await initialize(call, name, clientVersion, acpAuth);
  const opened = await call("session/new", {
    cwd,
    mcpServers: [],
    ...(sessionMeta ? { _meta: sessionMeta } : {}),
  });
  const modelOption = modelOptionOf(opened);
  if (!modelOption) return legacyModelRows(opened);
  const rows = modelRows(selectValues(modelOption));
  for (const row of rows) {
    if (row.id === modelOption.currentValue) {
      Object.assign(row, effortFields(opened));
      continue;
    }
    try {
      const changed = await call("session/set_config_option", {
        sessionId: opened.sessionId,
        configId: modelOption.id,
        value: row.id,
      });
      if (Array.isArray(changed?.configOptions)) Object.assign(row, effortFields(changed));
    } catch {
      // Some offered models cannot be selected on this account. Keep their
      // model rows, but never invent their effort choices.
    }
  }
  return rows;
}

const PLAN_VERBS = {
  edit: "edit files",
  delete: "delete files",
  move: "move files",
  execute: "run a command",
};

/**
 * Run one ACP turn on an already spawned agent (stdin and stdout piped).
 * Resolves with { stopReason } once session/prompt answers; rejects with an
 * AcpError on protocol errors or when the agent exits first. The caller owns
 * the process: it ends stdin (and kills, if needed) after this settles.
 *
 * @param {{
 *   child: import("node:child_process").ChildProcess,
 *   name: string,
 *   cwd: string,
 *   prompt: string,
 *   images?: { path: string, mime: string }[],
 *   resumeId?: string,
 *   permission?: string,
 *   modes?: Record<string, string[]>,
 *   unadvertisedModes?: boolean,
 *   model?: string,
 *   defaultModel?: string,
 *   effort?: string,
 *   acpAuth?: { methods: string[], meta?: object, missingMessage?: string },
 *   mcpServers?: object[],
 *   sessionMeta?: object,
 *   clientVersion?: string,
 *   on: {
 *     sessionId(id: string): void,
 *     text(text: string): void,
 *     log(line: string): void,
 *     notice(text: string): void,
 *     models?(models: { id: string, label?: string, meta?: string }[]): void,
 *     defaultModel?(value: string): void,
 *     permission(request: object): Promise<{ outcome: string, optionId?: string }>,
 *   },
 * }} options
 */
export async function runAcpTurn(options) {
  const { child, name, on } = options;
  let sessionId = null;
  let replaying = false;
  let text = "";
  let lastRun = "";
  let emitted = false;
  let declinedModeSwitch = false;
  let skippedUpdate = false;
  // Text runs between tool calls are separate paragraphs; ADE's message list
  // joins an agent's consecutive output, so the break has to be in the text.
  const flush = () => {
    if (text.trim()) {
      on.text(emitted ? `\n\n${text}` : text);
      emitted = true;
    }
    text = "";
  };
  const run = (kind) => {
    if (lastRun === kind) return;
    lastRun = kind;
    // Same events Pi logs, so the live status reads "Thinking" / "Writing a reply".
    on.log(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: kind } }));
  };
  /** Each tool call by id: what the agent has sent so far, and whether its result is logged. */
  const tools = new Map();
  /** A call is logged again as it is refined, but only this often before it is finished. */
  const MAX_CALL_LINES = 6;
  const MAX_UNIDENTIFIED = 50;
  let unidentified = 0;
  /** What the agent sends is not trusted to have the shape the protocol gives it. */
  const guarded = (read, fallback) => {
    try {
      return read();
    } catch {
      return fallback;
    }
  };
  /**
   * Log a tool call, and its result once it has one. A call is logged again when later updates
   * say more about it (Claude Code first names a tool before its input has streamed in), and
   * the Activity pane folds the repeats into one step. The first sight of an id is its call,
   * whichever update brought it, and it may already be completed.
   */
  const handleTool = (update) => {
    const id = typeof update.toolCallId === "string" ? clip(update.toolCallId, 120) : "";
    const known = id ? tools.get(id) : undefined;
    if (known?.settled) {
      logLateChange(known, update, id);
      return;
    }
    // Nothing ties updates with no id together, so each stands alone; a turn only gets so many.
    if (!id && ++unidentified > MAX_UNIDENTIFIED) return;
    if (!known) {
      flush();
      lastRun = "";
    }
    const entry = {
      call: mergeToolCall(known?.call ?? {}, update),
      // A call keeps the name it was first logged with, so its lines stay one step.
      name: known?.name,
      logged: known?.logged,
      lines: known?.lines ?? 0,
      hooked: known?.hooked || changeReport(update) !== undefined,
      settled: false,
    };
    entry.name ??= clip(toolNameOf(entry.call), 80);
    const { call } = entry;
    const failed = call.status === "failed";
    const finished = failed || call.status === "completed";
    const line = JSON.stringify({
      type: "tool_call",
      ...(id ? { callId: id } : {}),
      toolName: entry.name,
      ...(TOOL_KINDS.has(call.kind) ? { kind: call.kind } : {}),
      ...(call.title ? { title: clip(call.title, 160) } : {}),
      input: guarded(() => compactInput(call), {}),
    });
    // An agent that streams a command or a path as it types would otherwise write a line for
    // every keystroke. Past a few, only the finished call is logged.
    if (line !== entry.logged && (entry.lines < MAX_CALL_LINES || finished)) {
      on.log(line);
      entry.logged = line;
      entry.lines++;
    }
    if (finished) {
      const fields = guarded(() => toolResultFields(call, failed), {});
      // Claude Code shows a Write as a new file until its PostToolUse report gives the real
      // diff, which comes after the completed status. Counts taken from that guess would call a
      // rewritten file all additions, so they wait for the report (see logLateChange).
      const awaiting = !failed && !entry.hooked && awaitsChangeReport(call);
      const guessed = awaiting && guarded(() => claimsCreation(call), true);
      const { additions, deletions, ...rest } = fields;
      on.log(
        JSON.stringify({
          type: "tool_result",
          ...(id ? { callId: id } : {}),
          toolName: entry.name,
          ...(TOOL_KINDS.has(call.kind) ? { kind: call.kind } : {}),
          ...(failed ? { isError: true } : {}),
          ...(guessed ? rest : fields),
        }),
      );
      entry.settled = true;
      // The call's content and output are not kept once the result is logged.
      entry.call = {};
      entry.kind = call.kind;
      if (awaiting)
        entry.waiting = {
          shown: guessed ? {} : { additions, deletions },
          guess: { additions, deletions, files: fields.files },
        };
    }
    if (id) {
      tools.set(id, entry);
      // A turn that runs thousands of tools forgets the oldest rather than grow.
      if (tools.size > 10_000) tools.delete(tools.keys().next().value);
    }
  };
  /**
   * A change Claude Code reported after its result: the real diff. When it moves the line
   * counts, the result is logged again with the counts, and the Activity pane takes the later
   * result's fields over the earlier one's.
   */
  const logLateChange = (entry, update, id) => {
    const report = entry.waiting ? changeReport(update) : undefined;
    if (!report) return;
    const fields = guarded(() => lateResultFields(entry.waiting, update, report), undefined);
    entry.waiting = undefined;
    if (fields)
      on.log(
        JSON.stringify({
          type: "tool_result",
          callId: id,
          toolName: entry.name,
          ...(TOOL_KINDS.has(entry.kind) ? { kind: entry.kind } : {}),
          amends: true,
          ...fields,
        }),
      );
  };

  const handleUpdate = (update) => {
    switch (update?.sessionUpdate) {
      case "agent_message_chunk":
        if (update.content?.type === "text" && typeof update.content.text === "string") {
          run("text");
          text += update.content.text;
        }
        return;
      case "agent_thought_chunk":
        run("thinking");
        return;
      case "tool_call":
      case "tool_call_update":
        handleTool(update);
        return;
      case "plan":
        flush();
        lastRun = "";
        on.log(
          JSON.stringify({
            type: "plan",
            entries: (Array.isArray(update.entries) ? update.entries : [])
              .slice(0, 20)
              .map((entry) => ({
                content: clip(entry?.content, 160),
                status: entry?.status,
              })),
          }),
        );
        return;
      default:
        // usage, available commands, mode/config/session-info updates: nothing to show.
        return;
    }
  };

  const decide = async (params) => {
    const choices = permissionOptions(params?.options);
    const request = describeRequest(params?.toolCall);
    if (choices.length === 0) return { outcome: "cancelled" };
    if (options.permission === "plan" && PLAN_DECLINES.has(request.kind)) {
      const reject =
        choices.find((choice) => choice.kind === "reject_once") ??
        choices.find((choice) => choice.kind === "reject_always");
      on.log(JSON.stringify({ type: "permission", decision: "declined", title: request.title }));
      if (request.kind === "switch_mode") {
        // The plan is the point of a Plan turn, but the agent put it only in
        // this request (Claude: ExitPlanMode's input). Show it as its message.
        declinedModeSwitch = true;
        flush();
        text = planText(params?.toolCall);
        flush();
      }
      on.notice(
        request.kind === "switch_mode"
          ? `${name} asked to leave plan mode. ADE declined because this session is in Plan, which never edits files. To apply the plan, switch the session to Build and send a follow-up.`
          : `${name} asked to ${PLAN_VERBS[request.kind] ?? "make a change"} (${request.title}). ADE declined because this session is in Plan, which is read-only.`,
      );
      return reject ? { outcome: "selected", optionId: reject.optionId } : { outcome: "cancelled" };
    }
    // "Don't ask" means ADE answers every request itself instead of showing
    // it: anything that would prompt is declined, matching Claude's dontAsk.
    if (options.permission === "dont-ask") {
      const reject =
        choices.find((choice) => choice.kind === "reject_once") ??
        choices.find((choice) => choice.kind === "reject_always");
      on.log(JSON.stringify({ type: "permission", decision: "declined", title: request.title }));
      on.notice(
        request.kind === "switch_mode"
          ? `${name} asked to leave the current mode. ADE declined because this session is set to Don't ask.`
          : `${name} asked to ${PLAN_VERBS[request.kind] ?? "make a change"} (${request.title}). ADE declined because this session is set to Don't ask.`,
      );
      return reject ? { outcome: "selected", optionId: reject.optionId } : { outcome: "cancelled" };
    }
    flush();
    lastRun = "";
    const answer = await on.permission({ ...request, options: choices });
    return answer?.outcome === "selected" && choices.some((c) => c.optionId === answer.optionId)
      ? { outcome: "selected", optionId: answer.optionId }
      : { outcome: "cancelled" };
  };

  const rpc = createRpc(child.stdout, child.stdin, {
    onNotification(method, params) {
      if (method !== "session/update" || replaying || !sessionId) return;
      if (params?.sessionId !== sessionId) return;
      // A notification that throws would take the process down with it; an update ADE cannot
      // read is skipped, because a turn is worth more than one line of its activity.
      try {
        handleUpdate(params.update);
      } catch {
        if (!skippedUpdate) {
          skippedUpdate = true;
          on.log(`${name} sent an activity update ADE could not read; it was skipped.`);
        }
      }
    },
    async onRequest(method, params) {
      // Not gated on sessionId: an unanswerable request makes the agent deny
      // the tool, while showing it to the user is always the safe side.
      if (method === "session/request_permission") return { outcome: await decide(params) };
      throw new AcpError(`ADE does not implement ${method}.`, METHOD_NOT_FOUND);
    },
    onInvalid(line) {
      on.log(clip(line, 500));
    },
  });
  watchExit(child, rpc, name, "before finishing the turn. See Logs for its output.");
  const call = authAware(rpc);
  const caps = await initialize(call, name, options.clientVersion, options.acpAuth);
  const setup = {
    cwd: options.cwd,
    mcpServers: options.mcpServers ?? [],
    ...(options.sessionMeta ? { _meta: options.sessionMeta } : {}),
  };

  let opened = null;
  if (options.resumeId) {
    const method = caps.sessionCapabilities?.resume
      ? "session/resume"
      : caps.loadSession
        ? "session/load"
        : null;
    if (method) {
      sessionId = options.resumeId;
      // session/load replays the conversation as updates; ADE already has it.
      replaying = method === "session/load";
      try {
        opened = (await call(method, { ...setup, sessionId })) ?? {};
      } catch (error) {
        if (error?.code === AUTH_REQUIRED) throw error;
        sessionId = null;
        on.notice(
          `${name} could not reopen its earlier conversation (${clip(error.message, 200)}), so this turn starts a fresh one. Repository state carries over.`,
        );
      } finally {
        replaying = false;
      }
    } else
      on.notice(
        `${name} cannot reopen an earlier conversation over ACP, so this turn starts a fresh one. Repository state carries over.`,
      );
  }
  const fresh = !sessionId;
  if (fresh) {
    opened = await call("session/new", setup);
    if (typeof opened?.sessionId !== "string" || !opened.sessionId)
      throw new AcpError(`${name} did not return a session id.`);
    sessionId = opened.sessionId;
  }
  on.sessionId(sessionId);

  const wanted = options.modes?.[options.permission ?? "build"] ?? [];
  const available = (opened?.modes?.availableModes ?? []).map((mode) => mode?.id);
  const mode =
    wanted.find((id) => available.includes(id)) ??
    (options.unadvertisedModes ? wanted[0] : undefined);
  if (mode && opened.modes?.currentModeId !== mode)
    await call("session/set_mode", { sessionId, modeId: mode });
  else if (!mode && options.permission === "plan")
    on.log(`${name} offers no plan mode; ADE declines edit and command requests itself.`);
  else if (!mode && wanted.length)
    throw new AcpError(
      `${name} does not currently offer the selected permission mode "${options.permission}".`,
    );

  const modelOption = modelOptionOf(opened);
  const legacyRows = !modelOption ? legacyModelRows(opened) : [];
  const models = modelOption
    ? selectValues(modelOption)
    : legacyRows.map((row) => ({ value: row.id, name: row.label }));
  if (models.length) on.models?.(modelOption ? modelRows(models) : legacyRows);
  // A fresh conversation reports the model it starts on: the agent's own
  // configured default. A resumed one keeps whatever model it last ran, so
  // "no model chosen" restores that recorded default instead.
  const currentModel = modelOption?.currentValue ?? opened?.models?.currentModelId;
  if (fresh && typeof currentModel === "string") on.defaultModel?.(currentModel);
  if (options.model && !models.some((entry) => entry.value === options.model))
    throw new AcpError(
      models.length
        ? `The selected model "${options.model}" is not available in ${name}. It offers: ${models.map((entry) => entry.value).join(", ")}.`
        : `${name} offers no model choice over ACP, so the selected model "${options.model}" is not available. Clear the model to use its default.`,
    );
  const targetModel =
    options.model ||
    (!fresh && models.some((entry) => entry.value === options.defaultModel)
      ? options.defaultModel
      : undefined);
  let currentOptions = opened;
  if (modelOption && targetModel && modelOption.currentValue !== targetModel) {
    const changed = await call("session/set_config_option", {
      sessionId,
      configId: modelOption.id,
      value: targetModel,
    });
    if (Array.isArray(changed?.configOptions)) currentOptions = changed;
  }
  const effortOption = effortOptionOf(currentOptions);
  const effortValues = selectValues(effortOption).map((entry) => entry.value);
  const legacyModel = legacyRows.find((row) => row.id === (targetModel ?? currentModel));
  const allowedEfforts = modelOption ? effortValues : (legacyModel?.efforts ?? []);
  if (options.effort && !allowedEfforts.includes(options.effort))
    throw new AcpError(
      `The selected effort "${options.effort}" is not available for this model in ${name}.`,
    );
  // Restore the bridge's default on resume when it explicitly exposes one.
  const targetEffort = options.effort || (effortValues.includes("default") ? "default" : undefined);
  if (modelOption && targetEffort && effortOption.currentValue !== targetEffort)
    await call("session/set_config_option", {
      sessionId,
      configId: effortOption.id,
      value: targetEffort,
    });

  if (!modelOption && ((targetModel && currentModel !== targetModel) || options.effort)) {
    const changed = await call("session/set_model", {
      sessionId,
      modelId: targetModel ?? currentModel,
      ...(options.effort ? { _meta: { reasoningEffort: options.effort } } : {}),
    });
    if (changed?._meta?.model?.Err)
      throw new AcpError(
        `${name} rejected the selected model or effort: ${String(changed._meta.model.Err)}`,
      );
  }

  const prompt = [{ type: "text", text: options.prompt }];
  if (caps.promptCapabilities?.image)
    for (const image of options.images ?? [])
      prompt.push({
        type: "image",
        mimeType: image.mime,
        data: (await fsp.readFile(image.path)).toString("base64"),
      });
  const result = await call("session/prompt", { sessionId, prompt });
  flush();
  return {
    stopReason: typeof result?.stopReason === "string" ? result.stopReason : "end_turn",
    // Declining a mode switch can stop the turn (Claude ends it "cancelled").
    ...(declinedModeSwitch ? { declinedModeSwitch } : {}),
  };
}
