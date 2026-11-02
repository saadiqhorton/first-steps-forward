import type { SessionLogRow } from "./formatLogs.mjs";

export type TurnItemKind =
  | "edit"
  | "read"
  | "search"
  | "run"
  | "fetch"
  | "preview"
  | "browse"
  | "tool"
  | "plan"
  | "message"
  | "permission"
  | "result"
  | "error"
  | "output"
  | "notice";

/**
 * One visible row. `label` is the plain verb or phrase; `detail` is what it acted on (a path, a
 * command, the text of a reply). A tool call is "pending" until its result arrives, and
 * `activeLabel` is its label while it is still running. `reason` is why a step failed and
 * `outcome` what a finished one came to in a few words, such as "95 lines".
 */
export type TurnItem = {
  id: string;
  kind: TurnItemKind;
  label: string;
  activeLabel?: string;
  detail?: string;
  status: "pending" | "done" | "failed";
  /** On permission rows: asked, allowed, rejected or declined. */
  decision?: string;
  additions?: number;
  deletions?: number;
  reason?: string;
  outcome?: string;
  /** The paths one edit touched, when it touched several. */
  files?: string[];
  /** A notice in a few words, for a turn that has nothing else to say. */
  brief?: string;
};

export type SummaryPart = { text: string; bad?: boolean };

export type TurnGroup = {
  id: string;
  items: TurnItem[];
  /** Steps and errors that failed; a turn with any stays open. */
  failed: number;
  summary: { parts: SummaryPart[]; text: string };
};

export function summarizeTurn(items: TurnItem[]): {
  parts: SummaryPart[];
  text: string;
  failed: number;
};
export function groupActivityTurns(rows: SessionLogRow[], lineOffset?: number): TurnGroup[];
export function trimmedFromFront(prev: string[], next: string[]): number;
