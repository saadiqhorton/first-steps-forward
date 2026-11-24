/**
 * Turn raw agent log lines (NDJSON from Codex, OpenCode and Pi, and the lines ADE writes for
 * ACP agents) into short Activity-pane rows, in two steps.
 *
 * 1. A decoder reads one raw event in one agent's format and says what happened, as an
 *    ActivityEvent. Decoders are small and know nothing about wording.
 * 2. One renderer words every ActivityEvent as a FormattedLog row, and one phrase function as
 *    the live status line. Kinds, tones and wording live there and nowhere else.
 *
 * A native CLI that prints JSON lines needs one decoder added to DECODERS and a fixture test
 * (activityConformance.test.mjs). An ACP agent needs nothing: ADE logs its tool calls in
 * the canonical format (src/local/acp.mjs) and `decodeAde` reads it. Keep the event trail, and
 * humanize tool payloads so the pane is readable without dumping JSON blobs.
 */

/** @typedef {"info" | "tool" | "error" | "output" | "system"} LogTone */
/**
 * What a row is, for grouping. Tool calls are read, edit, run, search, fetch (the web), preview
 * (the dev server), browse (the agent's browser and computer) or tool (anything else).
 * "lifecycle" rows are routine (session, turn and step markers) and "turn" is the line ADE
 * writes when it starts a turn, which is where the Activity pane begins a new group.
 * @typedef {"lifecycle" | "turn" | "read" | "edit" | "run" | "search" | "fetch" | "preview" |
 *   "browse" | "tool" | "message" | "plan" | "permission" | "result" | "error" | "output" |
 *   "notice"} LogKind
 */
/**
 * `callId` ties a tool call to its result: ADE's ACP `callId`, Pi `toolCallId`, OpenCode
 * `part.callID` or `part.id`, Codex `item.id`. Lines ADE wrote before it logged ACP ids carry
 * none. `state` is how a tool-call row stands when it is written. `additions` and `deletions`
 * are changed line counts (an ACP diff, or an edit result's `details.diff`). `files` are the
 * paths a change touched. `summary` is a result's plain outcome, such as "95 lines", written
 * for the pane and never a preview of contents. `amends` marks a result that corrects an
 * earlier one for the same call (a diff that came after the result): it is no step of its own
 * and its fields replace the earlier ones.
 * @typedef {{
 *   tone: LogTone,
 *   kind: LogKind,
 *   title: string,
 *   body?: string,
 *   raw: string,
 *   tool?: string,
 *   callId?: string,
 *   state?: "running" | "done" | "failed",
 *   decision?: "asked" | "allowed" | "rejected" | "declined",
 *   summary?: string,
 *   additions?: number,
 *   deletions?: number,
 *   files?: string[],
 *   amends?: boolean,
 * }} FormattedLog
 */

/**
 * ACP's tool kinds: the one vocabulary an agent has for what a tool does.
 * @typedef {"read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" |
 *   "switch_mode" | "other"} ToolKind
 */
/**
 * What one raw log event means, whichever agent wrote it: the one shape every decoder
 * produces. `live` is the live status phrase the event stands for, when it should not be
 * worked out from the event itself; `null` says it has none.
 *
 * - lifecycle: a routine marker (session, turn, step); hidden from turns.
 * - turn: ADE's line that starts a turn.
 * - message: the agent wrote a reply.
 * - plan: the agent updated its plan; `step` is the one it is on.
 * - permission: a permission request and what became of it.
 * - notice, error, output: a line to show as it is. A notice has a `tone`, "info" if none.
 * - live: nothing to show as a row, but the phrase says what the agent is doing.
 * - tool_call: a step. `tool` is the tool's own name, `kind` what it does when the agent says
 *   (otherwise its name decides), `input` its raw input, `describe` the agent's own one-line
 *   description (the fallback for what it acted on), `heading` and `detail` word the row for a
 *   format that is already worded, `state` how it stands when written, and `quiet` a step
 *   reported only when it finished and not worth a kind of its own.
 * - tool_result: how a step ended. `callId` finds its call. `summary` is a plain outcome and
 *   `detail` a preview for a result that is shown alone. Neither may carry file contents.
 *   `amends` says it corrects the call's earlier result rather than being a second one.
 * @typedef {{ type: "lifecycle", title: string, live?: string | null }
 *   | { type: "turn", title: string }
 *   | { type: "message", text: string }
 *   | { type: "plan", step?: string, live?: string | null }
 *   | { type: "permission", decision: "asked" | "allowed" | "rejected" | "declined",
 *       subject?: string, option?: string }
 *   | { type: "notice", title: string, body?: string, tone?: LogTone, live?: string | null }
 *   | { type: "error", title: string, body?: string }
 *   | { type: "output", title: string, body?: string }
 *   | { type: "live", live: string | null }
 *   | { type: "tool_call", tool: string, callId?: string, kind?: ToolKind, input?: unknown,
 *       describe?: string, heading?: string, detail?: string, files?: string[],
 *       state?: "running" | "done" | "failed", quiet?: boolean, live?: string | null }
 *   | { type: "tool_result", tool?: string, callId?: string, kind?: ToolKind, failed?: boolean,
 *       summary?: string, detail?: string, additions?: number, deletions?: number,
 *       files?: string[], amends?: boolean }} ActivityEvent
 */

const MAX_BODY = 240;

/**
 * The first usable id among the values (a string or a number), as a string.
 * @param {...unknown} values
 * @returns {string | undefined}
 */
function firstId(...values) {
  for (const value of values) {
    if (typeof value === "string" && value) return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

/**
 * Which kind of step a tool call is, from its name.
 * @param {string} tool
 * @returns {"read" | "edit" | "run" | "search" | "preview" | "browse" | "tool"}
 */
function toolKind(tool) {
  const name = (mcpToolParts(tool)?.tool ?? tool).toLowerCase();
  if (
    /^(edit|write|multiedit|notebookedit|apply_patch|str_replace|search_replace|create)/.test(name)
  )
    return "edit";
  if (/^(read|view|cat)/.test(name)) return "read";
  // A web search is a lookup outside the project: the design already words a
  // fetch as "Looked up" and summaries as "looked something up".
  if (/^(fetch|web_fetch|read_url|get_page|web_search|search_web)$/.test(name)) return "fetch";
  if (/^(find|glob|ls|list|grep|rg|search)/.test(name) || /(^|_)(search|crawl)(_|$)/.test(name))
    return "search";
  if (/^(bash|shell|exec|terminal|run_terminal)/.test(name)) return "run";
  if (/^dev_server_/.test(name)) return "preview";
  if (/^(computer_|browser_)/.test(name)) return "browse";
  return "tool";
}

/**
 * Lines added and removed in an edit result's diff. A diff cut by the log's length limit
 * would undercount, so it yields nothing.
 * @param {unknown} diff
 * @returns {{ additions?: number, deletions?: number }}
 */
function diffCounts(diff) {
  if (typeof diff !== "string" || !diff || /…\[\+\d+ chars\]$/.test(diff)) return {};
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return additions || deletions ? { additions, deletions } : {};
}

/**
 * @param {string} text
 * @param {number} [max]
 */
export function truncate(text, max = MAX_BODY) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function asText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * The readable message of a failure event. Providers nest it: a plain string, `error.message`,
 * or a JSON string with the message inside.
 * @param {Record<string, unknown>} event
 * @returns {string}
 */
function errorMessage(event) {
  const error = event.error;
  const raw = asText(
    (error && typeof error === "object"
      ? /** @type {Record<string, unknown>} */ (error).message
      : undefined) ??
      event.message ??
      event.errorMessage ??
      event.finalError ??
      error,
  );
  const text = raw.trim();
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      const inner = parsed?.error && typeof parsed.error === "object" ? parsed.error : parsed;
      if (typeof inner?.message === "string" && inner.message) return truncate(inner.message, 200);
    } catch {
      /* not JSON after all */
    }
  }
  return truncate(text, 200);
}

/**
 * Prefer a short path for display (basename or last two segments).
 * @param {string} path
 */
function shortPath(path) {
  const clean = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts.length <= 2) return clean || path;
  return parts.slice(-2).join("/");
}

/**
 * OpenCode often nests tool args under `{ status, input, output }`.
 * @param {unknown} value
 * @returns {Record<string, unknown> | string | null}
 */
function unwrapToolPayload(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    const t = value.trim();
    if ((t.startsWith("{") || t.startsWith("[")) && t.length < 8000) {
      try {
        return unwrapToolPayload(JSON.parse(t));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const obj = /** @type {Record<string, unknown>} */ (value);
  if (obj.input != null && typeof obj.input === "object" && !Array.isArray(obj.input)) {
    return /** @type {Record<string, unknown>} */ (obj.input);
  }
  if (obj.arguments != null && typeof obj.arguments === "object" && !Array.isArray(obj.arguments)) {
    return /** @type {Record<string, unknown>} */ (obj.arguments);
  }
  if (obj.args != null && typeof obj.args === "object" && !Array.isArray(obj.args)) {
    return /** @type {Record<string, unknown>} */ (obj.args);
  }
  return obj;
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function humanBody(value) {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return undefined;
    // Still looks like a JSON blob — unwrap or drop the braces from the pane.
    if ((t.startsWith("{") || t.startsWith("[")) && /"[a-zA-Z_]+"\s*:/.test(t)) {
      try {
        const parsed = JSON.parse(t);
        const unwrapped = unwrapToolPayload(parsed);
        if (unwrapped && typeof unwrapped === "object") {
          const summary = summarizeTool("tool", unwrapped);
          return summary.body ?? (summary.title.startsWith("Used ") ? undefined : summary.title);
        }
        if (typeof unwrapped === "string") return truncate(unwrapped, 160);
      } catch {
        return truncate(t, 160);
      }
      return undefined;
    }
    return truncate(t, MAX_BODY);
  }
  if (typeof value === "object") {
    const unwrapped = unwrapToolPayload(value);
    if (typeof unwrapped === "string") return truncate(unwrapped, MAX_BODY);
    if (unwrapped && typeof unwrapped === "object") {
      const command = asText(unwrapped.command ?? unwrapped.cmd);
      const filePath = asText(
        unwrapped.filePath ?? unwrapped.filepath ?? unwrapped.path ?? unwrapped.file,
      );
      if (command) return truncate(command, 160);
      if (filePath) return shortPath(filePath);
      const preview = asText(unwrapped.output ?? unwrapped.result ?? unwrapped.content);
      if (preview && !/^\s*[{[]/.test(preview)) return truncate(preview, MAX_BODY);
    }
  }
  return undefined;
}

/**
 * Every agent names an MCP tool `mcp__<server>__<tool>` (Pi, Codex, OpenCode).
 * The server tells the user which connector acted; the tool says what it did.
 * @param {string} tool
 * @returns {{ server: string, tool: string } | null}
 */
function mcpToolParts(tool) {
  const match = /^mcp__(.+)__(.+)$/.exec(tool);
  return match ? { server: match[1], tool: match[2] } : null;
}

/**
 * @param {string} tool
 * @param {unknown} rawInput
 * @returns {{ title: string, body?: string }}
 */
export function summarizeTool(tool, rawInput) {
  const raw = (tool || "tool").trim() || "tool";
  const mcp = mcpToolParts(raw);
  // Read the tool's own name for the payload fields; the server prefix is not
  // a tool name, so matching on it would miss `query` or `path`.
  const name = mcp?.tool ?? raw;
  const label = mcp ? `${mcp.server} ${name.replace(/_/g, " ")}` : name;
  const lower = name.toLowerCase();
  const input = unwrapToolPayload(rawInput);

  if (typeof input === "string" && input.trim()) {
    return { title: `Used ${label}`, body: truncate(input, 160) };
  }

  const fields = input && typeof input === "object" ? input : {};
  const command = asText(fields.command ?? fields.cmd ?? fields.shell);
  const filePath = asText(
    fields.filePath ?? fields.filepath ?? fields.path ?? fields.file ?? fields.target,
  );
  const pattern = asText(
    fields.pattern ??
      fields.query ??
      fields.regex ??
      fields.grep ??
      fields.objective ??
      (Array.isArray(fields.search_queries) ? fields.search_queries.join(" · ") : ""),
  );
  const contentHint = asText(fields.description ?? fields.title ?? fields.message);

  if (/(bash|shell|exec|terminal|run_terminal_cmd|command)/i.test(lower) && command) {
    return { title: `Used ${label}`, body: truncate(command, 160) };
  }
  if (/(read|view|open|cat)/i.test(lower) && filePath) {
    return { title: `Used ${label}`, body: shortPath(filePath) };
  }
  if (/(write|create|edit|apply_patch|str_replace|search_replace)/i.test(lower) && filePath) {
    return { title: `Used ${label}`, body: shortPath(filePath) };
  }
  if (/(glob|list_dir|ls|search_files)/i.test(lower)) {
    const target = filePath || asText(fields.glob ?? fields.glob_pattern ?? fields.targetDirectory);
    return target
      ? { title: `Used ${label}`, body: shortPath(target) }
      : { title: `Used ${label}` };
  }
  if (/(grep|rg|search)/i.test(lower) && pattern) {
    return {
      title: `Used ${label}`,
      body: filePath ? `${truncate(pattern, 48)} in ${shortPath(filePath)}` : truncate(pattern, 80),
    };
  }
  if (filePath) return { title: `Used ${label}`, body: shortPath(filePath) };
  if (command) return { title: `Used ${label}`, body: truncate(command, 160) };
  if (pattern) return { title: `Used ${label}`, body: truncate(pattern, 80) };
  if (contentHint) return { title: `Used ${label}`, body: truncate(contentHint, 120) };
  return { title: `Used ${label}` };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);

/** The live phrase between one step and the next. */
const BETWEEN = "Still working on the next step";

/**
 * What a tool's ACP kind makes of its step. "other" says nothing, so the tool's name decides.
 * @type {Record<ToolKind, LogKind | undefined>}
 */
const KIND_STEP = {
  read: "read",
  edit: "edit",
  delete: "edit",
  move: "edit",
  search: "search",
  execute: "run",
  fetch: "fetch",
  // Claude Code reports its sub-agents as "think"; they are work worth a quiet row.
  think: "tool",
  // The permission row says what became of a mode switch, so the call itself is routine.
  switch_mode: "lifecycle",
  other: undefined,
};

/**
 * @param {unknown} value
 * @returns {ToolKind | undefined}
 */
const toolKindOf = (value) =>
  typeof value === "string" && Object.hasOwn(KIND_STEP, value)
    ? /** @type {ToolKind} */ (value)
    : undefined;

// ── Decoders ──────────────────────────────────────────────────────────────────────────────
//
// A decoder takes one parsed JSON event and returns an ActivityEvent, `null` when the event
// has nothing to show, or `undefined` when the event is not in its format (the next decoder
// tries). `decodeGeneric` is last and takes everything left.

/**
 * The parts of a tool-call event that formats spell differently: Pi has `toolName`, `args` and
 * `toolCallId`; OpenCode nests them as `part.tool`, `part.state` and `part.callID`.
 * @param {Record<string, unknown>} event
 */
function readToolCall(event) {
  const part = isRecord(event.part) ? event.part : null;
  const tool =
    asText(event.toolName) ||
    asText(event.tool) ||
    asText(event.name) ||
    asText(part?.tool) ||
    asText(part?.name) ||
    "tool";
  const input =
    event.input ??
    event.args ??
    event.arguments ??
    (part ? (part.state ?? part.input ?? part.arguments) : undefined);
  const callId = firstId(
    event.toolCallId,
    event.callId,
    event.callID,
    event.tool_call_id,
    part?.callID,
    part?.callId,
    part?.id,
  );
  // OpenCode reports a tool's status inside part.state; other agents report it as a result.
  const status = part && isRecord(part.state) ? asText(part.state.status) : "";
  return { tool, input, callId, status };
}

/**
 * A tool result as Pi and OpenCode write it: the text in `result.content`, a diff in
 * `result.details`, and an `isError` flag.
 * @param {Record<string, unknown>} event
 * @returns {ActivityEvent}
 */
function decodeToolResult(event) {
  const result = isRecord(event.result) ? event.result : null;
  const resultPayload =
    result && Array.isArray(result.content)
      ? result.content.find((c) => c && typeof c === "object" && typeof c.text === "string")?.text
      : undefined;
  const detail = humanBody(
    resultPayload ?? event.output ?? event.result ?? event.content ?? event.part,
  );
  const part = isRecord(event.part) ? event.part : null;
  const tool = asText(event.toolName);
  const callId = firstId(
    event.toolCallId,
    event.callId,
    event.callID,
    event.tool_call_id,
    part?.callID,
    part?.callId,
  );
  const failed = event.isError === true;
  const details = result && isRecord(result.details) ? result.details : null;
  return {
    type: "tool_result",
    ...(tool ? { tool } : {}),
    ...(callId ? { callId } : {}),
    ...(failed ? { failed } : {}),
    ...(detail ? { detail } : {}),
    ...(failed ? {} : diffCounts(details?.diff)),
  };
}

/**
 * ADE's own lines for an ACP agent (written by src/local/acp.mjs and ade-local.mjs): tool calls
 * and results with their `callId` and ACP `kind`, plans and permission decisions. Lines from
 * before ADE logged ids have no `callId`, `kind` or `title`, and decode the same way.
 * @param {Record<string, unknown>} event
 * @returns {ActivityEvent | null | undefined}
 */
function decodeAde(event) {
  const callId = firstId(event.callId);
  const kind = toolKindOf(event.kind);
  switch (event.type) {
    case "tool_call": {
      const input = isRecord(event.input) ? event.input : undefined;
      const title = asText(event.title);
      return {
        type: "tool_call",
        tool: asText(event.toolName) || "tool",
        ...(callId ? { callId } : {}),
        ...(kind ? { kind } : {}),
        input: event.input,
        ...(title ? { describe: title } : {}),
        // A web request names the address it fetched, which the generic summary does not read.
        ...(kind === "fetch" && typeof input?.url === "string"
          ? { detail: truncate(input.url, 120) }
          : {}),
        state: "running",
      };
    }
    case "tool_result": {
      const tool = asText(event.toolName);
      const summary = truncate(asText(event.summary), 200);
      const files = Array.isArray(event.files)
        ? event.files.filter((file) => typeof file === "string" && file).slice(0, 10)
        : [];
      return {
        type: "tool_result",
        ...(tool ? { tool } : {}),
        ...(callId ? { callId } : {}),
        ...(kind ? { kind } : {}),
        ...(event.isError === true ? { failed: true } : {}),
        ...(event.amends === true ? { amends: true } : {}),
        ...(summary ? { summary } : {}),
        ...(typeof event.additions === "number" ? { additions: event.additions } : {}),
        ...(typeof event.deletions === "number" ? { deletions: event.deletions } : {}),
        ...(files.length ? { files } : {}),
      };
    }
    case "plan": {
      const entries = Array.isArray(event.entries) ? event.entries : [];
      const current =
        entries.find((entry) => entry?.status === "in_progress") ??
        entries.find((entry) => entry?.status === "pending");
      const step = current ? truncate(asText(current.content), 160) : "";
      return { type: "plan", ...(step ? { step } : {}) };
    }
    case "permission": {
      const decision = asText(event.decision);
      const subject = truncate(asText(event.title), 160);
      const option = asText(event.option);
      return {
        type: "permission",
        decision:
          decision === "asked" || decision === "allowed" || decision === "rejected"
            ? decision
            : "declined",
        ...(subject ? { subject } : {}),
        ...(option ? { option } : {}),
      };
    }
    default:
      return undefined;
  }
}

/**
 * Pi (`pi --mode json`): `tool_execution_start` and `_end` with a `toolCallId`, `message_*`
 * and `turn_*` events, and the retries it makes by itself.
 * @param {Record<string, unknown>} event
 * @returns {ActivityEvent | null | undefined}
 */
function decodePi(event) {
  switch (event.type) {
    case "tool_execution_start": {
      const { tool, input, callId } = readToolCall(event);
      return { type: "tool_call", tool, ...(callId ? { callId } : {}), input, state: "running" };
    }
    case "tool_execution_end":
      return decodeToolResult(event);
    case "turn_start":
      return { type: "lifecycle", title: "Turn started", live: "Starting" };
    case "turn_end":
      return { type: "lifecycle", title: "Turn completed" };
    case "agent_start":
      return { type: "lifecycle", title: "Session started", live: "Starting" };
    case "session":
      return { type: "lifecycle", title: "Session started" };
    case "message_update": {
      const delta = isRecord(event.assistantMessageEvent)
        ? asText(event.assistantMessageEvent.type)
        : "";
      if (delta.startsWith("thinking")) return { type: "live", live: "Thinking" };
      if (delta.startsWith("text")) return { type: "live", live: "Writing a reply" };
      return null;
    }
    case "message_start":
    case "message_end":
    case "agent_end":
    case "agent_settled":
      return null;
    // Pi retries a failed model request by itself. Say so, rather than leave it out of the turn.
    case "auto_retry_start": {
      const attempt = Number(event.attempt);
      const most = Number(event.maxAttempts);
      const body = [
        attempt > 0 && most > 0 ? `Attempt ${attempt} of ${most}` : "",
        errorMessage(event),
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        type: "notice",
        title: "Retrying after an error",
        ...(body ? { body } : {}),
        live: null,
      };
    }
    case "auto_retry_end": {
      if (event.success !== false) return undefined;
      const message = errorMessage(event);
      return {
        type: "error",
        title: "Retrying did not work",
        ...(message ? { body: message } : {}),
      };
    }
    default:
      return undefined;
  }
}

/**
 * OpenCode (`opencode run --format json`): `step_*`, `text`, and `tool_use` with the tool under
 * `part`.
 * @param {Record<string, unknown>} event
 * @returns {ActivityEvent | undefined}
 */
function decodeOpenCode(event) {
  switch (event.type) {
    case "step_start":
      return { type: "lifecycle", title: "Step started", live: "Starting" };
    case "step_finish":
    case "step_end":
      return { type: "lifecycle", title: "Step finished" };
    case "text": {
      const part = isRecord(event.part) ? event.part : null;
      const text = asText(part && "text" in part ? part.text : event.text);
      return text.trim() ? { type: "message", text } : { type: "live", live: BETWEEN };
    }
    case "tool_use":
    case "tool": {
      const { tool, input, callId, status } = readToolCall(event);
      return {
        type: "tool_call",
        tool,
        ...(callId ? { callId } : {}),
        input,
        state: status === "completed" ? "done" : status === "error" ? "failed" : "running",
      };
    }
    case "tool_output":
      return decodeToolResult(event);
    default:
      return undefined;
  }
}

/**
 * Codex (`codex exec --json`): `thread.*`, `turn.*` and `item.started` / `item.completed`. A
 * command or a file change is reported once, as it completes.
 * @param {Record<string, unknown>} event
 * @returns {ActivityEvent | null | undefined}
 */
function decodeCodex(event) {
  const item = isRecord(event.item) ? event.item : null;
  const itemType = item ? asText(item.type) : "";
  switch (event.type) {
    case "thread.started":
      return { type: "lifecycle", title: "Codex thread started", live: "Starting" };
    case "turn.started":
      return { type: "lifecycle", title: "Turn started", live: "Starting" };
    case "turn.completed":
      return { type: "lifecycle", title: "Turn completed" };
    case "item.started":
      return {
        type: "lifecycle",
        title: `Started ${itemType || "item"}`,
        live: startedPhrase(itemType, item),
      };
    case "item.completed": {
      if (itemType === "agent_message") return { type: "live", live: BETWEEN }; // already in chat
      const callId = firstId(item?.id);
      const state = item && asText(item.status) === "failed" ? "failed" : "done";
      if (itemType === "command_execution" || itemType === "command") {
        const cmd = truncate(asText(item?.command ?? item?.cmd ?? item?.title), 160);
        return {
          type: "tool_call",
          tool: itemType,
          ...(callId ? { callId } : {}),
          kind: "execute",
          heading: "Ran command",
          ...(cmd ? { detail: cmd } : {}),
          state,
          live: BETWEEN,
        };
      }
      if (itemType === "file_change" || itemType === "file_change_item") {
        const files = changedPaths(item?.changes).map(shortPath);
        return {
          type: "tool_call",
          tool: itemType,
          ...(callId ? { callId } : {}),
          kind: "edit",
          heading: "Updated files",
          // One path reads as itself; more read as a count, and `files` keeps them for counting.
          ...(files.length
            ? { detail: files.length === 1 ? files[0] : `${files.length} files` }
            : {}),
          ...(files.length ? { files } : {}),
          state,
          live: BETWEEN,
        };
      }
      // Codex reports a problem it worked around, and its to-do list, as items of their own.
      if (itemType === "error") {
        const message = truncate(asText(item?.message), 200);
        return { type: "error", title: message || "Codex reported an error" };
      }
      if (itemType === "todo_list") {
        const entries = Array.isArray(item?.items) ? item.items : [];
        const next = entries.find((entry) => entry && entry.completed !== true);
        const step = next ? truncate(asText(next.text), 160) : "";
        return { type: "plan", ...(step ? { step } : {}), live: null };
      }
      // Reasoning is routine; any other finished item (an MCP call, a web search) is an action.
      if (!itemType || itemType === "reasoning")
        return { type: "lifecycle", title: itemType ? `Finished ${itemType}` : "Finished item" };
      return {
        type: "tool_call",
        tool: itemType,
        ...(callId ? { callId } : {}),
        heading: `Finished ${itemType}`,
        state,
        quiet: true,
        live: null,
      };
    }
    default:
      return undefined;
  }
}

/**
 * Everything no format claimed: errors, events named for a failure, and the rest as a routine
 * marker with its type as the title.
 * @param {Record<string, unknown>} event
 * @returns {ActivityEvent | null}
 */
function decodeGeneric(event) {
  const type = typeof event.type === "string" ? event.type : "";
  if (type === "error") {
    const title = truncate(
      asText(
        (isRecord(event.error) ? event.error.message : undefined) ??
          event.message ??
          event.error ??
          "CLI error",
      ),
      200,
    );
    return { type: "error", title: title || "CLI error" };
  }
  // An event named for a failure (Codex's turn.failed, a CLI's extension_error) is a problem.
  if (type && /(^|[._-])(fail|failed|failure|error|errored)([._-]|$)/i.test(type)) {
    const message = errorMessage(event);
    return {
      type: "error",
      title: type.replace(/[._]/g, " "),
      ...(message ? { body: message } : {}),
    };
  }
  return { type: "lifecycle", title: type ? type.replace(/[._]/g, " ") : "CLI event" };
}

/**
 * A line that is not JSON: what ADE itself writes (the turn's context manifest, the notices
 * about stops and agent switches) and whatever a CLI prints.
 * @param {string} line
 * @returns {ActivityEvent}
 */
function decodeText(line) {
  const trimmed = line.trim();
  if (/^Context manifest:/.test(trimmed)) return { type: "turn", title: truncate(trimmed, 220) };
  if (
    /^\$ /.test(trimmed) ||
    /^Turn not started:/.test(trimmed) ||
    /^Stopped by user/.test(trimmed)
  )
    return { type: "notice", tone: "system", title: truncate(trimmed, 220) };
  // Other lines ADE writes itself. They are notices, though their tone has always been "output".
  if (
    /^agent switch:/.test(trimmed) ||
    /^(Switching to your message\.|Follow-up queued|Sending the waiting message\.)/.test(trimmed)
  )
    return {
      type: "notice",
      tone: "output",
      title: truncate(trimmed, 200),
      ...(trimmed === "Switching to your message." ? { live: "Switching to your message" } : {}),
    };
  if (/error|failed|exception/i.test(trimmed) && trimmed.length < 300)
    return { type: "error", title: truncate(trimmed, 200) };
  // Long shell dumps — short preview in the summarized body.
  if (trimmed.length > 160 || /\n/.test(line))
    return { type: "output", title: "CLI output", body: truncate(trimmed, MAX_BODY) };
  return { type: "output", title: truncate(trimmed, 200) };
}

/**
 * The decoders for JSON events, in the order they are tried. To support a new agent that prints
 * JSON lines, write a decoder above and add it before `decodeGeneric`.
 * @type {((event: Record<string, unknown>) => ActivityEvent | null | undefined)[]}
 */
const DECODERS = [decodeAde, decodePi, decodeOpenCode, decodeCodex, decodeGeneric];

/**
 * What one raw log event means, whichever agent wrote it.
 * @param {Record<string, unknown>} event
 * @returns {ActivityEvent | null} null when the event has nothing to show or say
 */
export function decodeLogEvent(event) {
  for (const decode of DECODERS) {
    const decoded = decode(event);
    if (decoded !== undefined) return decoded;
  }
  return null;
}

// ── Rendering ─────────────────────────────────────────────────────────────────────────────

/**
 * Which kind of step a tool call is. ADE's own preview and browser tools are named for what
 * they are, whatever kind the agent files them under; for the rest the agent's own kind decides
 * and a tool name stands in for an agent that gives none.
 * @param {{ tool: string, kind?: ToolKind }} call
 * @returns {LogKind}
 */
function stepKind(call) {
  const named = toolKind(call.tool);
  if (named === "preview" || named === "browse") return named;
  return (call.kind && KIND_STEP[call.kind]) ?? named;
}

/**
 * Word one activity event as a row. The row's `raw` is left for the caller to fill.
 * @param {ActivityEvent} event
 * @returns {FormattedLog | null}
 */
function renderEvent(event) {
  switch (event.type) {
    case "lifecycle":
      return { tone: "info", kind: "lifecycle", title: event.title, raw: "" };
    case "turn":
      return { tone: "system", kind: "turn", title: event.title, raw: "" };
    case "message":
      return {
        tone: "info",
        kind: "message",
        title: "Agent wrote a reply",
        body: truncate(event.text, 160),
        raw: "",
      };
    case "plan":
      return {
        tone: "info",
        kind: "plan",
        title: "Updated its plan",
        ...(event.step ? { body: event.step } : {}),
        raw: "",
      };
    case "permission": {
      const title =
        event.decision === "asked"
          ? "Asked for your permission"
          : event.decision === "allowed"
            ? "You allowed"
            : event.decision === "rejected"
              ? "You rejected"
              : "Declined by ADE (Plan is read-only)";
      return {
        tone: "system",
        kind: "permission",
        title,
        ...(event.subject
          ? { body: event.option ? `${event.subject} — ${event.option}` : event.subject }
          : {}),
        raw: "",
        decision: event.decision,
      };
    }
    case "notice":
      return {
        tone: event.tone ?? "info",
        kind: "notice",
        title: event.title,
        ...(event.body ? { body: event.body } : {}),
        raw: "",
      };
    case "error":
      return {
        tone: "error",
        kind: "error",
        title: event.title,
        ...(event.body ? { body: event.body } : {}),
        raw: "",
      };
    case "output":
      return {
        tone: "output",
        kind: "output",
        title: event.title,
        ...(event.body ? { body: event.body } : {}),
        raw: "",
      };
    case "live":
      return null;
    case "tool_call": {
      const summary = summarizeTool(event.tool, event.input);
      const body =
        event.detail ??
        summary.body ??
        (event.describe ? truncate(event.describe, 120) : undefined);
      const kind = event.quiet ? "tool" : stepKind(event);
      return {
        tone: event.quiet || kind === "lifecycle" ? "info" : "tool",
        kind,
        title: event.heading ?? summary.title,
        ...(body ? { body } : {}),
        raw: "",
        tool: event.tool,
        ...(event.callId ? { callId: event.callId } : {}),
        ...(event.state ? { state: event.state } : {}),
        ...(event.files?.length ? { files: event.files } : {}),
      };
    }
    case "tool_result": {
      const ids = {
        ...(event.tool ? { tool: event.tool } : {}),
        ...(event.callId ? { callId: event.callId } : {}),
      };
      const body = event.summary ?? event.detail;
      // The permission row already says what became of a mode switch.
      if (event.kind === "switch_mode")
        return { tone: "info", kind: "lifecycle", title: "Tool finished", raw: "", ...ids };
      if (event.failed)
        return {
          tone: "error",
          kind: "error",
          title: `${event.tool || "Tool"} failed`,
          ...(body ? { body } : {}),
          raw: "",
          ...ids,
          ...(event.summary ? { summary: event.summary } : {}),
        };
      return {
        tone: "output",
        kind: "result",
        title: "Tool finished",
        ...(body ? { body } : {}),
        raw: "",
        ...ids,
        ...(event.summary ? { summary: event.summary } : {}),
        ...(event.additions != null ? { additions: event.additions } : {}),
        ...(event.deletions != null ? { deletions: event.deletions } : {}),
        ...(event.files?.length ? { files: event.files.map(shortPath) } : {}),
        ...(event.amends ? { amends: true } : {}),
      };
    }
    default:
      return null;
  }
}

/**
 * @param {Record<string, unknown>} event
 * @returns {FormattedLog | null}
 */
export function formatJsonLogEvent(event) {
  const decoded = decodeLogEvent(event);
  return decoded ? renderEvent(decoded) : null;
}

/**
 * @param {string} line
 * @returns {FormattedLog | null}
 */
export function formatLogLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (isRecord(parsed)) {
        const formatted = formatJsonLogEvent(parsed);
        if (!formatted) return null;
        return { ...formatted, raw: trimmed };
      }
    } catch {
      /* fall through — treat as plain text */
    }
  }

  const row = renderEvent(decodeText(line));
  return row && { ...row, raw: trimmed };
}

// ── The live status line ──────────────────────────────────────────────────────────────────

/**
 * One plain sentence for the live status line. Describes the latest step
 * a non-developer can act on, never a command or a file dump.
 * @param {string[]} lines
 * @returns {string}
 */
export function currentActivity(lines) {
  const list = lines ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const line = String(list[i] ?? "").trim();
    if (!line) continue;
    const phrase = phraseForLine(line);
    if (phrase) return phrase;
  }
  return "Starting";
}

/**
 * @param {string} line a trimmed, non-empty log line
 * @returns {string | null}
 */
function phraseForLine(line) {
  if (!line.startsWith("{")) return phraseOf(decodeText(line));
  try {
    const event = JSON.parse(line);
    return isRecord(event) ? phraseOf(decodeLogEvent(event)) : null;
  } catch {
    return null; // keep walking
  }
}

/**
 * The live phrase an event stands for, or null when it says nothing about what is happening.
 * @param {ActivityEvent | null} event
 * @returns {string | null}
 */
function phraseOf(event) {
  if (!event) return null;
  if ("live" in event && event.live !== undefined) return event.live;
  switch (event.type) {
    case "tool_call":
      return toolPhrase(event);
    case "tool_result":
      // A correction to a result says nothing new about what the agent is doing.
      return event.amends ? null : BETWEEN;
    case "message":
      return BETWEEN;
    case "plan":
      return "Planning the work";
    case "permission":
      return event.decision === "asked" ? "Waiting for your answer" : BETWEEN;
    default:
      return null;
  }
}

/**
 * What a started Codex item is doing.
 * @param {string} itemType
 * @param {Record<string, unknown> | null} item
 */
function startedPhrase(itemType, item) {
  if (itemType === "reasoning") return "Thinking";
  if (itemType === "agent_message") return "Writing a reply";
  if (itemType === "command_execution" || itemType === "command")
    return commandPhrase(asText(item?.command ?? item?.cmd));
  if (itemType === "file_change" || itemType === "file_change_item")
    return filePhrase(item?.changes);
  return "Working";
}

/**
 * The phrase for a tool call. ADE's preview and browser tools are named first; then the
 * agent's own kind, which holds for any ACP agent; then the tool's name.
 * @param {{ tool: string, kind?: ToolKind, input?: unknown }} call
 * @returns {string | null}
 */
function toolPhrase(call) {
  const tool = call.tool.toLowerCase();
  const input = unwrapToolPayload(call.input);
  const fields = input && typeof input === "object" ? input : {};
  const filePath = asText(fields.filePath ?? fields.filepath ?? fields.path ?? fields.file);
  const command = () => commandPhrase(asText(fields.command ?? fields.cmd ?? input));
  if (/^dev_server_/.test(tool)) return "Checking the preview";
  if (/^(computer_|browser_)/.test(tool)) return "Looking at the page";
  switch (call.kind) {
    case "read":
    case "search":
      return "Reading the project";
    case "edit":
    case "delete":
    case "move":
      return filePhrase(filePath ? [{ path: filePath }] : []);
    case "execute":
      return command();
    case "fetch":
      return "Looking something up";
    case "switch_mode":
      return null;
    default:
  }
  if (/(write|edit|patch|create)/.test(tool))
    return filePhrase(filePath ? [{ path: filePath }] : []);
  if (/(read|grep|search|glob|ls|list|find)/.test(tool)) return "Reading the project";
  if (/(bash|shell|exec|command)/.test(tool)) return command();
  return "Working";
}

/**
 * @param {string} command
 */
function commandPhrase(command) {
  const text = command.toLowerCase();
  if (/curl|localhost:\d+|\/dev\/(start|stop|status)/.test(text)) return "Checking the preview";
  if (/playwright|puppeteer|chromium|google-chrome/.test(text)) return "Looking at the page";
  if (/\b(npm test|npm run test|vitest|pytest|node --test)\b/.test(text)) return "Running checks";
  if (/\bgit\b/.test(text)) return "Looking at what changed";
  if (/\b(rg|grep|cat|sed|head|tail|ls|find|pwd)\b/.test(text)) return "Reading the project";
  return "Running a check";
}

/**
 * The paths in a Codex file change: a list of `{ path }` or an object keyed by path.
 * @param {unknown} changes
 * @returns {string[]}
 */
function changedPaths(changes) {
  return Array.isArray(changes)
    ? changes
        .map((change) =>
          change && typeof change === "object" ? asText(change.path ?? change.file) : "",
        )
        .filter(Boolean)
    : changes && typeof changes === "object"
      ? Object.keys(changes)
      : [];
}

/**
 * @param {unknown} changes
 */
function filePhrase(changes) {
  const paths = changedPaths(changes);
  if (paths.length !== 1) return "Updating files";
  const path = paths[0].replace(/\\/g, "/");
  const base = path.split("/").filter(Boolean).pop() ?? "";
  if (/workshop/i.test(path) || /\/artifacts\/.+\.html$/.test(path))
    return "Updating the workshop page";
  return base ? `Updating ${base}` : "Updating files";
}

/**
 * Each row also says which of the input lines it came from, so a row keeps the same id while
 * the log grows.
 * @param {string[]} lines
 * @returns {(FormattedLog & { line: number })[]}
 */
export function formatSessionLogs(lines) {
  /** @type {(FormattedLog & { line: number })[]} */
  const out = [];
  let prevTitle = "";
  (lines ?? []).forEach((line, index) => {
    const entry = formatLogLine(line);
    if (!entry) return;
    // Collapse back-to-back identical titles with no body (e.g. repeated step_start).
    if (!entry.body && entry.title === prevTitle && entry.tone === "info") return;
    prevTitle = entry.body ? "" : entry.title;
    out.push({ ...entry, line: index });
  });
  return out;
}
