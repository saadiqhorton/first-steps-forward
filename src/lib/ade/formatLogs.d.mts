export type LogTone = "info" | "tool" | "error" | "output" | "system";

export type FormattedLog = {
  tone: LogTone;
  title: string;
  body?: string;
  raw: string;
};

export function truncate(text: string, max?: number): string;
export function formatJsonLogEvent(event: Record<string, unknown>): FormattedLog | null;
export function formatLogLine(line: string): FormattedLog | null;
export function formatSessionLogs(lines: string[]): FormattedLog[];
