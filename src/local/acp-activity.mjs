// What ADE logs about an ACP tool call, and the short facts it reads from a result. The
// Activity pane renders these lines the same way for every ACP agent, so an agent needs no
// activity code of its own. Nothing here keeps file contents, diffs or whole outputs: a
// result is reduced to a one-line summary and plain counts.

/** ACP's tool kinds. Anything else an agent sends is left out rather than guessed at. */
export const TOOL_KINDS = new Set([
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "switch_mode",
  "other",
]);

const FILE_KINDS = new Set(["edit", "delete", "move"]);
const MAX_FILES = 10;
/** Past this many cells a line-by-line comparison costs too much, so a diff counts roughly. */
const MAX_DIFF_CELLS = 4_000_000;

/** One line of text: whitespace collapsed, cut to `max` characters. */
export const clip = (value, max) => {
  // Only the start of a huge string can reach the line, so the rest is never scanned.
  const text = String(value ?? "")
    .slice(0, 20_000)
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** The text items of an update's content, joined. Diffs, terminals and images add nothing. */
function contentText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) =>
      item?.type === "content" &&
      item.content?.type === "text" &&
      typeof item.content.text === "string"
        ? item.content.text
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

/**
 * The lines of a result's text. Claude Code wraps output in one code fence (an opening line
 * that may name a language and a closing line); that fence is not part of the output.
 * @param {string} text
 * @returns {string[]}
 */
function outputLines(text) {
  const lines = text.replace(ANSI, "").split(/\r?\n/);
  const fenced =
    lines.length >= 2 && /^\s*`{3,}[\w-]*\s*$/.test(lines[0]) && /^\s*`{3,}\s*$/.test(lines.at(-1));
  return fenced ? lines.slice(1, -1) : lines;
}

/** Lines of a diff side; no text and null are no lines, and a final newline ends a line. */
function diffLines(text) {
  if (typeof text !== "string" || !text) return [];
  return text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

/**
 * Lines added and removed going from one text to another. The unchanged head and tail are set
 * aside and what is left is compared line by line, so a hunk with unchanged lines inside it
 * (diffs carry context) counts only what changed. A new file is all additions and a removed
 * one all deletions. When the middle is too large to compare, every line of it counts as
 * changed, which can only overstate.
 * @param {unknown} oldText
 * @param {unknown} newText
 * @returns {{ additions: number, deletions: number }}
 */
export function lineDiffCounts(oldText, newText) {
  const before = diffLines(oldText);
  const after = diffLines(newText);
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tailBefore = before.length;
  let tailAfter = after.length;
  while (tailBefore > head && tailAfter > head && before[tailBefore - 1] === after[tailAfter - 1]) {
    tailBefore--;
    tailAfter--;
  }
  const removed = before.slice(head, tailBefore);
  const added = after.slice(head, tailAfter);
  if (!removed.length || !added.length || removed.length * added.length > MAX_DIFF_CELLS)
    return { additions: added.length, deletions: removed.length };
  // Longest common subsequence length, one row at a time.
  let row = new Uint32Array(added.length + 1);
  let next = new Uint32Array(added.length + 1);
  for (const line of removed) {
    for (let j = 1; j <= added.length; j++)
      next[j] = line === added[j - 1] ? row[j - 1] + 1 : Math.max(row[j], next[j - 1]);
    [row, next] = [next, row];
  }
  const same = row[added.length];
  return { additions: added.length - same, deletions: removed.length - same };
}

/** The changed line counts and paths of an update's diff content. */
function diffFacts(update) {
  let additions = 0;
  let deletions = 0;
  let any = false;
  const files = [];
  for (const item of Array.isArray(update.content) ? update.content : []) {
    if (item?.type !== "diff") continue;
    any = true;
    const counts = lineDiffCounts(item.oldText, item.newText);
    additions += counts.additions;
    deletions += counts.deletions;
    if (typeof item.path === "string" && item.path && !files.includes(item.path))
      files.push(item.path);
  }
  if (!any) {
    // No diff, but the agent said which files it touched.
    for (const location of Array.isArray(update.locations) ? update.locations : [])
      if (typeof location?.path === "string" && location.path && !files.includes(location.path))
        files.push(location.path);
  }
  return {
    ...(additions || deletions ? { additions, deletions } : {}),
    ...(files.length ? { files: files.slice(0, MAX_FILES).map((file) => clip(file, 200)) } : {}),
  };
}

/** The exit status a result reports, when it does. */
function exitCodeOf(update) {
  const code =
    update._meta?.terminal_exit?.exit_code ??
    update.rawOutput?.exit_code ??
    update.rawOutput?.exitCode;
  return Number.isInteger(code) ? code : undefined;
}

/** The text of a failure that arrived in `rawOutput` rather than as content. */
function rawFailure(update) {
  const raw = update.rawOutput;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object")
    for (const key of ["error", "message", "stderr"])
      if (typeof raw[key] === "string") return raw[key];
  return "";
}

/**
 * The one-line reason a tool failed: the first line of the error that has anything in it. A
 * failed command (Claude Code starts its text with "Exit code N") also gets its last line,
 * which is where the shell says why.
 * @param {Record<string, any>} update
 * @returns {string | undefined}
 */
function failureSummary(update) {
  const lines = outputLines(contentText(update.content) || rawFailure(update))
    .map((line) => line.trim())
    .filter(Boolean);
  const first = lines[0];
  if (!first) return undefined;
  const last = lines[lines.length - 1];
  return clip(/^exit code \d+$/i.test(first) && last !== first ? `${first}: ${last}` : first, 200);
}

/**
 * What to say about a finished tool, in a few words and never its contents. A failure gives
 * the reason. A read gives how many lines it read. A command gives its last line of output
 * and a non-zero exit status. A change gives changed line counts and the paths it touched.
 * Any other tool gives nothing.
 * @param {Record<string, any>} update the call as merged from everything the agent sent
 * @param {boolean} failed
 * @returns {{ summary?: string, additions?: number, deletions?: number, files?: string[] }}
 */
export function toolResultFields(update, failed) {
  if (failed) {
    // A change that failed changed nothing, whatever diff the agent showed beforehand.
    const summary = failureSummary(update);
    return summary ? { summary } : {};
  }
  if (update.kind === "read") {
    const lines = outputLines(contentText(update.content));
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    return lines.length
      ? { summary: `${lines.length} ${lines.length === 1 ? "line" : "lines"}` }
      : {};
  }
  if (update.kind === "execute") {
    const last = outputLines(contentText(update.content))
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
    const code = exitCodeOf(update);
    const parts = [code ? `exit ${code}` : "", last ? clip(last, 160) : ""].filter(Boolean);
    return parts.length ? { summary: parts.join(": ") } : {};
  }
  return FILE_KINDS.has(update.kind) ? diffFacts(update) : {};
}

/**
 * The call as the agent has described it so far. An update carries only what changed, and a
 * field it names replaces the earlier one. Of `_meta` only what ADE reads is kept (the tool's
 * name and a command's exit status), so a call does not hold the file a report repeats there.
 * @param {Record<string, any>} known
 * @param {Record<string, any>} update
 * @returns {Record<string, any>}
 */
export function mergeToolCall(known, update) {
  const merged = { ...known };
  for (const [key, value] of Object.entries(update))
    if (value != null && key !== "_meta") merged[key] = value;
  const meta = update._meta && typeof update._meta === "object" ? update._meta : {};
  const toolName = meta.claudeCode?.toolName;
  const exit = meta.terminal_exit;
  if (typeof toolName === "string") merged._meta = { ...merged._meta, claudeCode: { toolName } };
  if (exit && typeof exit === "object")
    merged._meta = { ...merged._meta, terminal_exit: { exit_code: exit.exit_code } };
  return merged;
}

/**
 * Whether a finished call is a change that Claude Code's adapter will still report the final
 * diff of (its tools name themselves in `_meta`).
 */
export const awaitsChangeReport = (call) =>
  typeof call._meta?.claudeCode?.toolName === "string" && FILE_KINDS.has(call.kind);

/** Whether a change shows a file with no earlier text, which is what a new file looks like. */
export const claimsCreation = (call) =>
  Array.isArray(call.content) &&
  call.content.some((item) => item?.type === "diff" && !item.oldText);

/**
 * What Claude Code's PostToolUse report says about an Edit or a Write, when an update is that
 * report: the final change, which replaces the diff it showed from the tool's input. The
 * adapter shows every Write as a new file until then, and the report normally comes after the
 * completed status. `created` is whether the Write made the file.
 * @param {Record<string, any>} update
 * @returns {{ created: boolean } | undefined}
 */
export function changeReport(update) {
  const response = update?._meta?.claudeCode?.toolResponse;
  if (!response || typeof response !== "object") return undefined;
  const known = response.type === "create" || response.type === "update";
  return known || Array.isArray(response.structuredPatch)
    ? { created: response.type === "create" }
    : undefined;
}

/**
 * The corrected result of a change whose real diff arrived after its result was logged, or
 * undefined when the report adds nothing to what was logged. A created file keeps the counts
 * its first diff gave; otherwise they come from the report's own diff.
 * @param {{ shown?: { additions?: number, deletions?: number }, guess?: { additions?: number, deletions?: number, files?: string[] } }} logged
 *   `shown` is the counts the result carried and `guess` those of the diff that said "new file"
 * @param {Record<string, any>} update the report
 * @param {{ created: boolean }} report
 * @returns {{ additions: number, deletions: number, files?: string[] } | undefined}
 */
export function lateResultFields(logged, update, report) {
  const real = diffFacts({ content: update.content, locations: update.locations });
  const final = real.additions != null ? real : report.created ? logged.guess : undefined;
  if (final?.additions == null) return undefined;
  if (final.additions === logged.shown?.additions && final.deletions === logged.shown?.deletions)
    return undefined;
  return {
    additions: final.additions,
    deletions: final.deletions ?? 0,
    ...(final.files?.length ? { files: final.files } : {}),
  };
}
