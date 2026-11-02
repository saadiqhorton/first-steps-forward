export type LogTone = "info" | "tool" | "error" | "output" | "system";

/**
 * What a row is, for grouping. Tool calls are read, edit, run, search, fetch (the web), preview
 * (the dev server), browse (the agent's browser and computer) or tool (anything else).
 * "lifecycle" rows are routine and "turn" is the line ADE writes when it starts a turn.
 */
export type LogKind =
  | "lifecycle"
  | "turn"
  | "read"
  | "edit"
  | "run"
  | "search"
  | "fetch"
  | "preview"
  | "browse"
  | "tool"
  | "message"
  | "plan"
  | "permission"
  | "result"
  | "error"
  | "output"
  | "notice";

export type FormattedLog = {
  tone: LogTone;
  kind: LogKind;
  title: string;
  body?: string;
  raw: string;
  /** The tool's own name, on tool calls and their results. */
  tool?: string;
  /** Ties a tool call to its result. ACP lines ADE wrote before it logged ids carry none. */
  callId?: string;
  /** How a tool-call row stands when it is written. */
  state?: "running" | "done" | "failed";
  decision?: "asked" | "allowed" | "rejected" | "declined";
  /** A result's plain outcome, such as "95 lines": never a preview of contents. */
  summary?: string;
  /** Changed line counts, from an ACP diff or an edit result's `details.diff`. */
  additions?: number;
  deletions?: number;
  /** The paths a change touched. */
  files?: string[];
  /**
   * A result that corrects an earlier one for the same call (a diff that came after the result).
   * It is no step of its own, and its fields replace the earlier result's.
   */
  amends?: boolean;
};

/** ACP's tool kinds: the one vocabulary an agent has for what a tool does. */
export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

/**
 * What one raw log event means, whichever agent wrote it: what every decoder produces and the
 * one renderer words. `live` is the status phrase the event stands for when it should not be
 * worked out from the event itself; `null` says it has none.
 */
export type ActivityEvent =
  | { type: "lifecycle"; title: string; live?: string | null }
  | { type: "turn"; title: string }
  | { type: "message"; text: string }
  | { type: "plan"; step?: string; live?: string | null }
  | {
      type: "permission";
      decision: "asked" | "allowed" | "rejected" | "declined";
      subject?: string;
      option?: string;
    }
  | { type: "notice"; title: string; body?: string; tone?: LogTone; live?: string | null }
  | { type: "error"; title: string; body?: string }
  | { type: "output"; title: string; body?: string }
  | { type: "live"; live: string | null }
  | {
      type: "tool_call";
      tool: string;
      callId?: string;
      kind?: ToolKind;
      input?: unknown;
      /** The agent's own one-line description, the fallback for what the step acted on. */
      describe?: string;
      heading?: string;
      detail?: string;
      files?: string[];
      state?: "running" | "done" | "failed";
      quiet?: boolean;
      live?: string | null;
    }
  | {
      type: "tool_result";
      tool?: string;
      callId?: string;
      kind?: ToolKind;
      failed?: boolean;
      summary?: string;
      detail?: string;
      additions?: number;
      deletions?: number;
      files?: string[];
      /** It corrects the call's earlier result rather than being a second one. */
      amends?: boolean;
    };

/** A formatted row and the index of the input line it came from. */
export type SessionLogRow = FormattedLog & { line: number };

export function truncate(text: string, max?: number): string;
export function summarizeTool(tool: string, rawInput: unknown): { title: string; body?: string };
export function decodeLogEvent(event: Record<string, unknown>): ActivityEvent | null;
export function formatJsonLogEvent(event: Record<string, unknown>): FormattedLog | null;
export function formatLogLine(line: string): FormattedLog | null;
export function formatSessionLogs(lines: string[]): SessionLogRow[];
export function currentActivity(lines: string[]): string;
