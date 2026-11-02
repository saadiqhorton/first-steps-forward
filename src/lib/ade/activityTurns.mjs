/**
 * Group the Activity pane's formatted log rows into one block per turn, in plain words.
 * A tool call and its result become one row, found by call id and never by position (calls
 * overlap and their results arrive in any order). A result that cannot be matched stays a
 * row of its own. Lines from before ADE logged ids for ACP agents have none to match by, so a
 * result joins a call only when exactly one call of that tool is still waiting for one.
 */

/**
 * @typedef {"edit" | "read" | "search" | "run" | "fetch" | "preview" | "browse" | "tool" | "plan" |
 *   "message" | "permission" | "result" | "error" | "output" | "notice"} TurnItemKind
 */
/**
 * One visible row. `label` is the plain verb or phrase; `detail` is what it acted on (a path,
 * a command, the text of a reply). A tool call is "pending" until its result arrives.
 * `activeLabel` is the label for a pending step that is still running. `reason` is why a
 * step failed and `outcome` what a finished one came to in a few words, such as "95 lines".
 * `files` are the paths one edit touched, when it touched several. `brief` is a notice in a
 * few words, for a turn that has nothing else to say.
 * @typedef {{
 *   id: string,
 *   kind: TurnItemKind,
 *   label: string,
 *   activeLabel?: string,
 *   detail?: string,
 *   status: "pending" | "done" | "failed",
 *   decision?: string,
 *   additions?: number,
 *   deletions?: number,
 *   reason?: string,
 *   outcome?: string,
 *   files?: string[],
 *   brief?: string,
 * }} TurnItem
 */
/** @typedef {{ text: string, bad?: boolean }} SummaryPart */
/**
 * @typedef {{
 *   id: string,
 *   items: TurnItem[],
 *   failed: number,
 *   summary: { parts: SummaryPart[], text: string },
 * }} TurnGroup
 */
/**
 * @typedef {{
 *   kind: string, tone: string, title: string, body?: string, tool?: string, callId?: string,
 *   state?: string, decision?: string, summary?: string, additions?: number, deletions?: number,
 *   files?: string[], amends?: boolean, line: number,
 * }} LogRow
 */

const STEP_KINDS = new Set(["edit", "read", "search", "run", "fetch", "preview", "browse", "tool"]);

/** Done, running and failed wording for each step; search is split by the tool's name below. */
const VERBS = {
  edit: ["Edited", "Editing", "Couldn’t edit"],
  read: ["Read", "Reading", "Couldn’t read"],
  run: ["Ran", "Running", "Command failed"],
  fetch: ["Looked up", "Looking up", "Couldn’t look up"],
  preview: ["Checked the preview", "Checking the preview", "Couldn’t check the preview"],
  browse: ["Looked at the page", "Looking at the page", "Couldn’t use the browser"],
  tool: ["Used a tool", "Working", "Tool failed"],
};
const LOOK_FOR = ["Looked for", "Looking for", "Couldn’t search"];
const SEARCH_FOR = ["Searched for", "Searching for", "Couldn’t search"];

const PERMISSION_LABEL = {
  asked: "Asked permission",
  allowed: "You allowed",
  rejected: "You declined",
  declined: "Declined (Plan is read-only)",
};

/**
 * @param {number} count
 * @param {string} one
 * @param {string} [many]
 */
const plural = (count, one, many) => `${count} ${count === 1 ? one : (many ?? `${one}s`)}`;

/** @param {{ kind: string, tool?: string }} step */
function verbsFor(step) {
  if (step.kind === "search")
    return /^(grep|rg|search)/i.test(step.tool ?? "") ? SEARCH_FOR : LOOK_FOR;
  return VERBS[/** @type {keyof typeof VERBS} */ (step.kind)] ?? VERBS.tool;
}

/**
 * A plain line for a turn, such as "Edited 1 file · ran 2 commands". A failed step comes first
 * and at most three parts show. A turn with no steps says what else it holds: a reply, the
 * plan, a notice such as "stopped", or the CLI's own lines.
 * @param {TurnItem[]} items
 * @returns {{ parts: SummaryPart[], text: string, failed: number }}
 */
export function summarizeTurn(items) {
  const count = {
    edit: new Set(),
    run: 0,
    read: 0,
    search: 0,
    fetch: 0,
    preview: 0,
    browse: 0,
    tool: 0,
  };
  let failed = 0;
  for (const item of items) {
    if (item.status === "failed") {
      failed++;
      continue;
    }
    // A file edited twice counts once; an edit that names no file counts as its own.
    if (item.kind === "edit") {
      for (const file of item.files ?? [item.detail ?? `#${item.id}`]) count.edit.add(file);
    } else if (item.kind in count) count[/** @type {"run"} */ (item.kind)]++;
  }
  /** @type {SummaryPart[]} */
  const parts = [];
  if (failed) parts.push({ text: `${plural(failed, "step")} failed`, bad: true });
  if (count.edit.size) parts.push({ text: `edited ${plural(count.edit.size, "file")}` });
  if (count.run) parts.push({ text: `ran ${plural(count.run, "command")}` });
  if (count.read) parts.push({ text: `read ${plural(count.read, "file")}` });
  if (count.search) parts.push({ text: "searched the project" });
  if (count.fetch) parts.push({ text: "looked something up" });
  if (count.preview) parts.push({ text: "checked the preview" });
  if (count.browse) parts.push({ text: "looked at the page" });
  if (count.tool) parts.push({ text: `used ${plural(count.tool, "tool")}` });
  if (!parts.length) parts.push(...quietParts(items));
  const shown = parts.slice(0, 3);
  const [first] = shown;
  if (first && !first.bad) first.text = first.text.charAt(0).toUpperCase() + first.text.slice(1);
  return { parts: shown, text: shown.map((part) => part.text).join(" · "), failed };
}

/**
 * What a turn without steps holds, in words. Notices come in the order they happened, each once.
 * @param {TurnItem[]} items
 * @returns {SummaryPart[]}
 */
function quietParts(items) {
  /** @type {string[]} */
  const texts = [];
  const has = (/** @type {string} */ kind) => items.some((item) => item.kind === kind);
  if (has("message")) texts.push("wrote a reply");
  else if (has("plan")) texts.push("updated the plan");
  for (const item of items) if (item.brief && !texts.includes(item.brief)) texts.push(item.brief);
  const results = items.filter((item) => item.kind === "result").length;
  if (results) texts.push(plural(results, "tool result"));
  const lines = items.filter((item) => item.kind === "output").length;
  if (lines) texts.push(`${plural(lines, "line")} of CLI output`);
  if (!texts.length) texts.push(items.length ? plural(items.length, "event") : "no steps yet");
  return texts.map((text) => ({ text }));
}

/**
 * A tool call while its turn is being read; results are folded into it before it becomes an item.
 * @typedef {{
 *   id: string, kind: string, tool: string, detail?: string, status: TurnItem["status"],
 *   additions?: number, deletions?: number, reason?: string, outcome?: string, files?: string[],
 *   resolved?: boolean,
 * }} Call
 */

/**
 * Fold a result into the call it belongs to.
 * @param {Call} call
 * @param {LogRow} row
 */
function settle(call, row) {
  call.resolved = true;
  if (row.kind === "error") {
    call.status = "failed";
    call.reason = row.body ?? row.title;
  } else if (call.status === "pending") call.status = "done";
  if (row.summary && row.kind !== "error") call.outcome = row.summary;
  if (row.additions != null) call.additions = row.additions;
  if (row.deletions != null) call.deletions = row.deletions;
  if (row.files?.length && !call.files) call.files = row.files;
}

/**
 * Fold a correction into a call that already has its result: whatever it says replaces what the
 * first result said.
 * @param {Call} call
 * @param {LogRow} row
 */
function amend(call, row) {
  if (row.summary) call.outcome = row.summary;
  if (row.additions != null) call.additions = row.additions;
  if (row.deletions != null) call.deletions = row.deletions;
  if (row.files?.length) call.files = row.files;
}

/**
 * The rows of one turn as visible items. Rows are read in order. A result goes to the latest
 * call with its id that has no result yet, so an id used twice gives two steps; a result that
 * comes first waits for the call that claims it. A result with no id goes to a call with no id
 * only when that call is the one call of its tool still waiting; with two or more waiting
 * there is no telling which it belongs to, so it stays a row of its own. A result that says it
 * amends an earlier one (a diff that came after the result) is never a row: it corrects the
 * latest call with its id, or is dropped when that call is no longer in the log.
 * @param {LogRow[]} rows
 * @param {number} lineOffset
 * @returns {TurnItem[]}
 */
function buildItems(rows, lineOffset) {
  /** @type {Map<string, Call[]>} every call that has this id, in order */
  const calls = new Map();
  /** @type {Map<string, { row: LogRow, folded: boolean }[]>} */
  const early = new Map();
  /** @type {Map<string, Call[]>} every call with no id, by tool name, in order */
  const anonymous = new Map();
  /** @type {({ call: Call } | { row: LogRow, folded: boolean })[]} */
  const slots = [];

  for (const row of rows) {
    if (STEP_KINDS.has(row.kind)) {
      const same = row.callId ? (calls.get(row.callId) ?? []) : [];
      const known = same.find((call) => !call.resolved && call.tool === (row.tool ?? ""));
      if (known) {
        // The same call reported again, such as OpenCode updating a running tool.
        if (row.state === "failed") known.status = "failed";
        else if (row.state === "done" && known.status !== "failed") known.status = "done";
        if (row.body) known.detail = row.body;
        // An ACP agent may name a tool before it knows what kind it is.
        if (row.kind !== "tool") known.kind = row.kind;
        if (row.files?.length) known.files = row.files;
        continue;
      }
      /** @type {Call} */
      const call = {
        id: String(lineOffset + row.line),
        kind: row.kind,
        tool: row.tool ?? "",
        ...(row.body ? { detail: row.body } : {}),
        ...(row.files?.length ? { files: row.files } : {}),
        // Only a call with an id can be waiting for a result.
        status:
          row.state === "failed"
            ? "failed"
            : row.state === "done" || !row.callId
              ? "done"
              : "pending",
      };
      slots.push({ call });
      if (!row.callId) {
        anonymous.set(call.tool, [...(anonymous.get(call.tool) ?? []), call]);
        continue;
      }
      calls.set(row.callId, [...same, call]);
      const waiting = early.get(row.callId)?.shift();
      if (waiting) {
        settle(call, waiting.row);
        waiting.folded = true;
      }
    } else if (row.amends) {
      const same = row.callId ? (calls.get(row.callId) ?? []) : [];
      const call = same.filter((candidate) => !row.tool || candidate.tool === row.tool).at(-1);
      if (call) amend(call, row);
    } else if (row.kind !== "lifecycle" && row.kind !== "turn") {
      const slot = { row, folded: false };
      slots.push(slot);
      if (row.kind !== "result" && row.kind !== "error") continue;
      if (!row.callId) {
        const waiting = (row.tool ? (anonymous.get(row.tool) ?? []) : []).filter(
          (candidate) => !candidate.resolved,
        );
        const [only] = waiting;
        if (only && waiting.length === 1) {
          settle(only, row);
          slot.folded = true;
        }
        continue;
      }
      const same = calls.get(row.callId);
      // A result belongs to the first call with its id that is still waiting for one.
      const call = same?.find(
        (candidate) =>
          !candidate.resolved && (!row.tool || !candidate.tool || candidate.tool === row.tool),
      );
      if (call) {
        settle(call, row);
        slot.folded = true;
      } else if (!same) early.set(row.callId, [...(early.get(row.callId) ?? []), slot]);
    }
  }

  /** @type {TurnItem[]} */
  const items = [];
  for (const slot of slots) {
    if ("row" in slot) {
      if (!slot.folded) items.push(plainItem(slot.row, String(lineOffset + slot.row.line)));
      continue;
    }
    const { call } = slot;
    const [done, active, fail] = verbsFor(call);
    // A tool with nothing else to say is named, unless it has no name ("tool" is the stand-in).
    const detail =
      call.detail ??
      (call.kind === "tool" && call.tool && call.tool !== "tool" ? call.tool : undefined);
    items.push({
      id: call.id,
      kind: /** @type {TurnItemKind} */ (call.kind),
      label: call.status === "failed" ? fail : done,
      activeLabel: active,
      ...(detail ? { detail } : {}),
      status: call.status,
      ...(call.additions != null ? { additions: call.additions } : {}),
      ...(call.deletions != null ? { deletions: call.deletions } : {}),
      ...(call.reason ? { reason: call.reason } : {}),
      ...(call.outcome ? { outcome: call.outcome } : {}),
      ...(call.files ? { files: call.files } : {}),
    });
  }
  return withoutRepeatedNotices(items);
}

/**
 * ADE can write the same notice twice in a row (a stop is logged by both the stop and the
 * switch that follows it). Say it once.
 * @param {TurnItem[]} items
 * @returns {TurnItem[]}
 */
function withoutRepeatedNotices(items) {
  return items.filter((item, index) => {
    const prev = items[index - 1];
    return !(
      item.kind === "notice" &&
      prev?.kind === "notice" &&
      prev.label === item.label &&
      prev.detail === item.detail
    );
  });
}

/**
 * A notice in a few words for a turn's summary, or nothing when it has no short form.
 * @param {string} title
 * @returns {string | undefined}
 */
function noticeBrief(title) {
  if (/^Stopped by user/.test(title)) return "stopped";
  if (/^Turn not started/.test(title)) return "never started";
  if (/^Retrying after an error/.test(title)) return "retried after an error";
  if (/^Switching to your message/.test(title)) return "switched to your message";
  if (/^Follow-up queued/.test(title)) return "queued your follow-up";
  if (/^Sending the waiting message/.test(title)) return "sent your waiting message";
  const swap = /^agent switch: (.+?) → (.+?)(?: \(|$)/.exec(title);
  if (swap) return `switched from ${swap[1]} to ${swap[2]}`;
  return undefined;
}

/**
 * A row that is not a tool call: a plan, a reply, a permission, output, an error, a notice, or
 * a result that matches no call.
 * @param {LogRow} row
 * @param {string} id
 * @returns {TurnItem}
 */
function plainItem(row, id) {
  const detail = row.body ? { detail: row.body } : {};
  switch (row.kind) {
    case "plan":
      return { id, kind: "plan", label: "Updated the plan", ...detail, status: "done" };
    case "message":
      return { id, kind: "message", label: "Replied", ...detail, status: "done" };
    case "permission":
      return {
        id,
        kind: "permission",
        label:
          PERMISSION_LABEL[/** @type {keyof typeof PERMISSION_LABEL} */ (row.decision)] ??
          row.title,
        ...detail,
        status: "done",
        ...(row.decision ? { decision: row.decision } : {}),
      };
    case "error":
      return { id, kind: "error", label: row.title, ...detail, status: "failed" };
    case "result": {
      const text = row.body ?? row.tool;
      return {
        id,
        kind: "result",
        label: row.title,
        ...(text ? { detail: text } : {}),
        status: "done",
        ...(row.additions != null ? { additions: row.additions } : {}),
        ...(row.deletions != null ? { deletions: row.deletions } : {}),
      };
    }
    case "notice": {
      const brief = noticeBrief(row.title);
      return {
        id,
        kind: "notice",
        label: row.title,
        ...detail,
        status: "done",
        ...(brief ? { brief } : {}),
      };
    }
    default:
      // Plain CLI output: a long dump keeps its short preview in the body.
      return { id, kind: "output", label: row.body ?? row.title, status: "done" };
  }
}

/**
 * Split rows into turns. A turn starts at the "Context manifest" line ADE writes for every
 * turn of every agent. Pi's own turn_start and turn_end mark each model response, so using
 * those would cut one request into dozens of groups. Rows before the first manifest form their
 * own group, which is also the whole log when it has none (plain CLI output). Routine rows are
 * left out. A group can be empty.
 * @param {LogRow[]} rows
 * @param {number} [lineOffset] lines already dropped from the front of the log, so ids stay put
 * @returns {TurnGroup[]}
 */
export function groupActivityTurns(rows, lineOffset = 0) {
  /** @type {{ id: string, rows: LogRow[] }[]} */
  const turns = [{ id: "turn-head", rows: [] }];
  for (const row of rows) {
    if (row.kind === "turn") turns.push({ id: `turn-${lineOffset + row.line}`, rows: [] });
    else turns[turns.length - 1]?.rows.push(row);
  }
  // An empty head group only exists when the log opens with a manifest.
  if (turns.length > 1 && !turns[0]?.rows.length) turns.shift();
  return turns.map(({ id, rows: turnRows }) => {
    const items = buildItems(turnRows, lineOffset);
    const { failed, parts, text } = summarizeTurn(items);
    return { id, items, failed, summary: { parts, text } };
  });
}

/**
 * How many lines were dropped from the front of the log between two snapshots. ADE keeps only
 * the last 500 lines, so once the log is full every new line pushes the first one out and
 * every index shifts by one. Counting what was dropped keeps ids stable.
 * @param {string[]} prev
 * @param {string[]} next
 * @returns {number}
 */
export function trimmedFromFront(prev, next) {
  for (let dropped = 0; dropped < prev.length; dropped++) {
    const overlap = prev.length - dropped;
    if (next.length < overlap) continue;
    let same = true;
    for (let i = 0; i < overlap && same; i++) same = prev[dropped + i] === next[i];
    if (same) return dropped;
  }
  return prev.length;
}
