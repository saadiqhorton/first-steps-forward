import { formatSessionLogs } from "../../lib/ade/formatLogs.mjs";

/**
 * A Luna thread's agent trace, from the thread detail's `activity` list.
 *
 * The service records raw agent CLI output as `type: "log"` entries; those are the lines the
 * Activity pane already decodes (`formatLogs.mjs`). It writes its own notices, errors and
 * permission asks as plain text, so they become the same lines the pane shows: errors and asks
 * as the JSON events it decodes, a notice as its own line. Everything stays in one list, in the
 * order it happened, so `ActivityLogs` groups and summarizes it exactly like a project's log.
 */

/** @typedef {"error" | "permission" | "notice"} TraceNoteKind */
/** @typedef {{ lines: string[], count: number }} ThreadTrace */

/** Error entries keep an error tone; a stop is a notice, not a failure. */
const ERROR_TYPES = new Set(["error", "failed"]);

/**
 * A stored log line is traceable when it is a readable event. Pi's streaming
 * `message_update` deltas are chat text, and a line cut off by an older
 * activity cap is not valid JSON; neither belongs in the trace.
 * @param {string} text
 */
function isTraceable(text) {
  if (!text.startsWith("{")) return true;
  try {
    return JSON.parse(text)?.type !== "message_update";
  } catch {
    return false;
  }
}

/**
 * How many rows the trace will actually show. Lifecycle/turn markers are
 * separators, not steps, so a thread with no tool calls has nothing to show.
 * @param {string[]} lines
 */
function visibleRows(lines) {
  return formatSessionLogs(lines).filter((row) => row.kind !== "lifecycle" && row.kind !== "turn")
    .length;
}

/**
 * @param {string} type
 * @returns {TraceNoteKind}
 */
function noteKind(type) {
  if (ERROR_TYPES.has(type)) return "error";
  if (type === "permission") return "permission";
  return "notice";
}

/**
 * The line that shows one ADE-written entry as the row the Activity pane already renders.
 * @param {TraceNoteKind} kind
 * @param {string} text
 */
function noteLine(kind, text) {
  if (kind === "error") return JSON.stringify({ type: "error", message: text });
  if (kind === "permission")
    return JSON.stringify({ type: "permission", decision: "asked", title: text });
  // A notice is what ADE writes into a session log too: plain text, read as it is.
  return text;
}

/**
 * @param {unknown} activity the thread detail's `activity` list
 * @returns {ThreadTrace}
 */
export function threadTrace(activity) {
  /** @type {string[]} */
  const lines = [];
  const entries = Array.isArray(activity) ? activity : [];
  entries.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const record = /** @type {Record<string, unknown>} */ (entry);
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!text) return;
    if (record.type === "log") {
      if (isTraceable(text)) lines.push(text);
      return;
    }
    const type = typeof record.type === "string" ? record.type : "";
    lines.push(noteLine(noteKind(type), text));
  });
  return { lines, count: visibleRows(lines) };
}
