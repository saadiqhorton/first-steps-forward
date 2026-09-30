/**
 * Turn raw CLI log lines (often NDJSON from Codex/OpenCode/Pi) into short
 * Activity-pane rows. Chat already shows agent prose; logs should answer
 * "what did the CLI do?" without dumping every event blob.
 */

/** @typedef {"info" | "tool" | "error" | "output" | "system"} LogTone */
/**
 * @typedef {{
 *   tone: LogTone,
 *   title: string,
 *   body?: string,
 *   raw: string,
 * }} FormattedLog
 */

const MAX_BODY = 480;

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
 * @param {Record<string, unknown>} event
 * @returns {FormattedLog | null}
 */
export function formatJsonLogEvent(event) {
  const type = typeof event.type === "string" ? event.type : "";

  // OpenCode-style stream
  if (type === "step_start") return { tone: "info", title: "Step started", raw: "" };
  if (type === "step_finish" || type === "step_end")
    return { tone: "info", title: "Step finished", raw: "" };
  if (type === "text") {
    const text = asText(
      event.part && typeof event.part === "object" ? event.part.text : event.text,
    );
    if (!text.trim()) return null;
    return { tone: "info", title: "Agent wrote a reply", body: truncate(text, 160), raw: "" };
  }
  if (type === "tool_use" || type === "tool_call" || type === "tool") {
    const tool =
      asText(event.tool) ||
      asText(event.name) ||
      asText(event.part && typeof event.part === "object" ? event.part.tool : "") ||
      "tool";
    const input =
      event.input ??
      event.args ??
      event.arguments ??
      (event.part && typeof event.part === "object"
        ? (event.part.state ?? event.part.input)
        : undefined);
    const body = input != null ? truncate(asText(input)) : undefined;
    return {
      tone: "tool",
      title: `Used ${tool}`,
      ...(body ? { body } : {}),
      raw: "",
    };
  }
  if (type === "tool_result" || type === "tool_output") {
    const body = truncate(
      asText(event.output ?? event.result ?? event.content ?? event.part),
      MAX_BODY,
    );
    return {
      tone: "output",
      title: "Tool finished",
      ...(body ? { body } : {}),
      raw: "",
    };
  }
  if (type === "error") {
    const message = truncate(
      asText(
        (event.error && typeof event.error === "object" ? event.error.message : undefined) ??
          event.message ??
          event.error ??
          "CLI error",
      ),
    );
    return { tone: "error", title: message || "CLI error", raw: "" };
  }

  // Codex-style stream
  if (type === "thread.started") return { tone: "info", title: "Codex thread started", raw: "" };
  if (type === "turn.started") return { tone: "info", title: "Turn started", raw: "" };
  if (type === "turn.completed") return { tone: "info", title: "Turn completed", raw: "" };
  if (type === "item.started") {
    const itemType =
      event.item && typeof event.item === "object" ? asText(event.item.type) : "item";
    return { tone: "info", title: `Started ${itemType || "item"}`, raw: "" };
  }
  if (type === "item.completed") {
    const item = event.item && typeof event.item === "object" ? event.item : null;
    const itemType = item ? asText(item.type) : "";
    if (itemType === "agent_message") return null; // already in chat
    if (itemType === "command_execution" || itemType === "command") {
      const cmd = truncate(asText(item.command ?? item.cmd ?? item.title));
      return {
        tone: "tool",
        title: cmd ? `Ran command` : "Ran a command",
        ...(cmd ? { body: cmd } : {}),
        raw: "",
      };
    }
    if (itemType === "file_change" || itemType === "file_change_item") {
      return { tone: "tool", title: "Updated files", raw: "" };
    }
    return {
      tone: "info",
      title: itemType ? `Finished ${itemType}` : "Finished item",
      raw: "",
    };
  }

  // Unknown JSON — keep a short type label, hide the blob unless expanded via raw later.
  if (type) return { tone: "info", title: type.replace(/[._]/g, " "), raw: "" };
  return { tone: "info", title: "CLI event", raw: "" };
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
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const formatted = formatJsonLogEvent(/** @type {Record<string, unknown>} */ (parsed));
        if (!formatted) return null;
        return { ...formatted, raw: trimmed };
      }
    } catch {
      /* fall through — treat as plain text */
    }
  }

  // ADE / shell lines
  if (
    /^\$ /.test(trimmed) ||
    /^Turn not started:/.test(trimmed) ||
    /^Stopped by user/.test(trimmed)
  )
    return { tone: "system", title: truncate(trimmed, 200), raw: trimmed };
  if (/error|failed|exception/i.test(trimmed) && trimmed.length < 300)
    return { tone: "error", title: truncate(trimmed, 200), raw: trimmed };

  // Long shell dumps (ls, git status, etc.)
  if (trimmed.length > 160 || /\n/.test(line))
    return {
      tone: "output",
      title: "CLI output",
      body: truncate(trimmed, MAX_BODY),
      raw: trimmed,
    };

  return { tone: "output", title: truncate(trimmed, 200), raw: trimmed };
}

/**
 * @param {string[]} lines
 * @returns {FormattedLog[]}
 */
export function formatSessionLogs(lines) {
  /** @type {FormattedLog[]} */
  const out = [];
  let prevTitle = "";
  for (const line of lines ?? []) {
    const entry = formatLogLine(line);
    if (!entry) continue;
    // Collapse back-to-back identical titles with no body (e.g. repeated step_start noise).
    if (!entry.body && entry.title === prevTitle && entry.tone === "info") continue;
    prevTitle = entry.body ? "" : entry.title;
    out.push(entry);
  }
  return out;
}
