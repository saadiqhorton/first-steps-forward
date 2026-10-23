/**
 * Turn raw CLI log lines (often NDJSON from Codex/OpenCode/Pi) into short
 * Activity-pane rows. Keep the event trail; humanize tool payloads so the
 * pane is readable without dumping JSON blobs.
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

const MAX_BODY = 240;

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
 * @param {string} tool
 * @param {unknown} rawInput
 * @returns {{ title: string, body?: string }}
 */
export function summarizeTool(tool, rawInput) {
  const name = (tool || "tool").trim() || "tool";
  const lower = name.toLowerCase();
  const input = unwrapToolPayload(rawInput);

  if (typeof input === "string" && input.trim()) {
    return { title: `Used ${name}`, body: truncate(input, 160) };
  }

  const fields = input && typeof input === "object" ? input : {};
  const command = asText(fields.command ?? fields.cmd ?? fields.shell);
  const filePath = asText(
    fields.filePath ?? fields.filepath ?? fields.path ?? fields.file ?? fields.target,
  );
  const pattern = asText(fields.pattern ?? fields.query ?? fields.regex ?? fields.grep);
  const contentHint = asText(fields.description ?? fields.title ?? fields.message);

  if (/(bash|shell|exec|terminal|run_terminal_cmd|command)/i.test(lower) && command) {
    return { title: `Used ${name}`, body: truncate(command, 160) };
  }
  if (/(read|view|open|cat)/i.test(lower) && filePath) {
    return { title: `Used ${name}`, body: shortPath(filePath) };
  }
  if (/(write|create|edit|apply_patch|str_replace|search_replace)/i.test(lower) && filePath) {
    return { title: `Used ${name}`, body: shortPath(filePath) };
  }
  if (/(glob|list_dir|ls|search_files)/i.test(lower)) {
    const target = filePath || asText(fields.glob ?? fields.glob_pattern ?? fields.targetDirectory);
    return target ? { title: `Used ${name}`, body: shortPath(target) } : { title: `Used ${name}` };
  }
  if (/(grep|rg|search)/i.test(lower) && pattern) {
    return {
      title: `Used ${name}`,
      body: filePath ? `${truncate(pattern, 48)} in ${shortPath(filePath)}` : truncate(pattern, 80),
    };
  }
  if (filePath) return { title: `Used ${name}`, body: shortPath(filePath) };
  if (command) return { title: `Used ${name}`, body: truncate(command, 160) };
  if (pattern) return { title: `Used ${name}`, body: truncate(pattern, 80) };
  if (contentHint) return { title: `Used ${name}`, body: truncate(contentHint, 120) };
  return { title: `Used ${name}` };
}

/**
 * @param {Record<string, unknown>} event
 * @returns {FormattedLog | null}
 */
export function formatJsonLogEvent(event) {
  const type = typeof event.type === "string" ? event.type : "";
  const part = event.part && typeof event.part === "object" ? event.part : null;

  // OpenCode-style stream
  if (type === "step_start") return { tone: "info", title: "Step started", raw: "" };
  if (type === "step_finish" || type === "step_end")
    return { tone: "info", title: "Step finished", raw: "" };
  if (type === "text") {
    const text = asText(part && "text" in part ? part.text : event.text);
    if (!text.trim()) return null;
    return { tone: "info", title: "Agent wrote a reply", body: truncate(text, 160), raw: "" };
  }
  if (type === "tool_use" || type === "tool_call" || type === "tool" || type === "tool_execution_start") {
    const tool =
      asText(event.toolName) ||
      asText(event.tool) ||
      asText(event.name) ||
      asText(part && "tool" in part ? part.tool : "") ||
      asText(part && "name" in part ? part.name : "") ||
      "tool";
    const rawInput =
      event.input ??
      event.args ??
      event.arguments ??
      (part ? (part.state ?? part.input ?? part.arguments) : undefined);
    const summary = summarizeTool(tool, rawInput);
    return {
      tone: "tool",
      title: summary.title,
      ...(summary.body ? { body: summary.body } : {}),
      raw: "",
    };
  }
  if (type === "tool_result" || type === "tool_output" || type === "tool_execution_end") {
    const resultPayload =
      event.result && typeof event.result === "object" && Array.isArray(event.result.content)
        ? event.result.content.find((c) => c && typeof c === "object" && typeof c.text === "string")?.text
        : undefined;
    const body = humanBody(resultPayload ?? event.output ?? event.result ?? event.content ?? event.part);
    if (event.isError === true) {
      return {
        tone: "error",
        title: `${asText(event.toolName) || "Tool"} failed`,
        ...(body ? { body } : {}),
        raw: "",
      };
    }
    return {
      tone: "output",
      title: "Tool finished",
      ...(body ? { body } : {}),
      raw: "",
    };
  }
  if (type === "turn_start") return { tone: "info", title: "Turn started", raw: "" };
  if (type === "turn_end") return { tone: "info", title: "Turn completed", raw: "" };
  if (type === "agent_start" || type === "session") return { tone: "info", title: "Session started", raw: "" };
  if (
    type === "message_start" ||
    type === "message_update" ||
    type === "message_end" ||
    type === "agent_end" ||
    type === "agent_settled"
  )
    return null;
  if (type === "error") {
    const message = truncate(
      asText(
        (event.error && typeof event.error === "object" ? event.error.message : undefined) ??
          event.message ??
          event.error ??
          "CLI error",
      ),
      200,
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
      const cmd = truncate(asText(item.command ?? item.cmd ?? item.title), 160);
      return {
        tone: "tool",
        title: "Ran command",
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

  // Unknown JSON — type label only (no blob in the summarized body).
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
    /^Stopped by user/.test(trimmed) ||
    /^Context manifest:/.test(trimmed)
  )
    return { tone: "system", title: truncate(trimmed, 220), raw: trimmed };
  if (/error|failed|exception/i.test(trimmed) && trimmed.length < 300)
    return { tone: "error", title: truncate(trimmed, 200), raw: trimmed };

  // Long shell dumps — short preview in the summarized body.
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
    if (line === "Switching to your message.") return "Switching to your message";
    if (!line.startsWith("{")) continue;
    try {
      const phrase = phraseForActivity(JSON.parse(line));
      if (phrase) return phrase;
    } catch {
      /* keep walking */
    }
  }
  return "Starting";
}

/**
 * @param {unknown} event
 * @returns {string | null}
 */
function phraseForActivity(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const record = /** @type {Record<string, unknown>} */ (event);
  const type = typeof record.type === "string" ? record.type : "";
  const item =
    record.item && typeof record.item === "object" && !Array.isArray(record.item)
      ? /** @type {Record<string, unknown>} */ (record.item)
      : null;
  const itemType = item && typeof item.type === "string" ? item.type : "";

  if (type === "item.started" || type === "item.completed") {
    if (itemType === "reasoning") return type === "item.started" ? "Thinking" : null;
    if (itemType === "agent_message")
      return type === "item.started" ? "Writing a reply" : "Still working on the next step";
    if (itemType === "command_execution" || itemType === "command") {
      if (type === "item.completed") return "Still working on the next step";
      return commandPhrase(asText(item?.command ?? item?.cmd));
    }
    if (itemType === "file_change" || itemType === "file_change_item") {
      if (type === "item.completed") return "Still working on the next step";
      return filePhrase(item?.changes);
    }
    if (type === "item.started") return "Working";
    return null;
  }

  if (type === "tool_use" || type === "tool_call" || type === "tool" || type === "tool_execution_start") {
    const tool = asText(record.toolName || record.tool || record.name || "tool").toLowerCase();
    const input = unwrapToolPayload(record.input ?? record.args ?? record.arguments ?? record.part);
    const fields = input && typeof input === "object" ? input : {};
    const filePath = asText(fields.filePath ?? fields.filepath ?? fields.path ?? fields.file);
    if (/^dev_server_/.test(tool)) return "Checking the preview";
    if (/^(computer_|browser_)/.test(tool)) return "Looking at the page";
    if (/(write|edit|patch|create)/.test(tool))
      return filePhrase(filePath ? [{ path: filePath }] : []);
    if (/(read|grep|search|glob|ls|list|find)/.test(tool)) return "Reading the project";
    if (/(bash|shell|exec|command)/.test(tool))
      return commandPhrase(asText(fields.command ?? fields.cmd ?? input));
    return "Working";
  }
  if (type === "message_update") {
    const delta =
      record.assistantMessageEvent && typeof record.assistantMessageEvent === "object"
        ? asText(record.assistantMessageEvent.type)
        : "";
    if (delta.startsWith("thinking")) return "Thinking";
    if (delta.startsWith("text")) return "Writing a reply";
    return null;
  }
  if (type === "tool_result" || type === "tool_output" || type === "tool_execution_end" || type === "text")
    return "Still working on the next step";
  if (
    type === "turn.started" ||
    type === "thread.started" ||
    type === "step_start" ||
    type === "turn_start" ||
    type === "agent_start"
  )
    return "Starting";
  return null;
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
 * @param {unknown} changes
 */
function filePhrase(changes) {
  const paths = Array.isArray(changes)
    ? changes
        .map((change) =>
          change && typeof change === "object" ? asText(change.path ?? change.file) : "",
        )
        .filter(Boolean)
    : changes && typeof changes === "object"
      ? Object.keys(changes)
      : [];
  if (paths.length !== 1) return "Updating files";
  const path = paths[0].replace(/\\/g, "/");
  const base = path.split("/").filter(Boolean).pop() ?? "";
  if (/workshop/i.test(path) || /\/artifacts\/.+\.html$/.test(path))
    return "Updating the workshop page";
  return base ? `Updating ${base}` : "Updating files";
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
    // Collapse back-to-back identical titles with no body (e.g. repeated step_start).
    if (!entry.body && entry.title === prevTitle && entry.tone === "info") continue;
    prevTitle = entry.body ? "" : entry.title;
    out.push(entry);
  }
  return out;
}
