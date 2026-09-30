/**
 * @typedef {"all" | "needs" | "working" | "unread"} ConversationFilter
 */

export type ConversationFilter = "all" | "needs" | "working" | "unread";

export function isUnread(
  session: { id: string; updatedAt: number; createdAt: number },
  viewed: Record<string, number>,
): boolean;

export function filterSessions<
  S extends {
    id: string;
    status: string;
    updatedAt: number;
    createdAt: number;
    request?: string;
    summary?: string;
    messages?: Array<{ text?: string }>;
  },
>(
  sessions: S[],
  o: {
    filter: ConversationFilter;
    query: string;
    showCompleted: boolean;
    viewed: Record<string, number>;
  },
): S[];
