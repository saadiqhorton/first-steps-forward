export type TraceNoteKind = "error" | "permission" | "notice";

export type ThreadTrace = { lines: string[]; count: number };

/**
 * Turn a thread's activity into the lines `ActivityLogs` renders: decodable CLI lines, ADE's
 * own notices, and its errors and permission asks as the events the pane already understands.
 */
export function threadTrace(activity: unknown): ThreadTrace;
