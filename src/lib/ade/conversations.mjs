/**
 * Pure conversation-list filtering / unread helpers (plain JS for node:test).
 * Re-exported from `viewed.ts` for the React UI.
 */

/**
 * @typedef {"all" | "needs" | "working" | "unread"} ConversationFilter
 */

/**
 * @param {{ id: string, updatedAt: number, createdAt: number }} session
 * @param {Record<string, number>} viewed
 */
export function isUnread(session, viewed) {
  const last = viewed[session.id] ?? session.createdAt;
  return session.updatedAt > last;
}

/**
 * Whether a session is waiting on the user: ready to review, blocked, or
 * paused on a permission request while its turn runs.
 * @param {{ status: string, pendingPermissions?: unknown[] }} session
 */
export function needsAttention(session) {
  return (
    session.status === "ready" ||
    session.status === "blocked" ||
    (session.pendingPermissions?.length ?? 0) > 0
  );
}

/**
 * @param {{ status: string }} session
 * @param {boolean} showCompleted
 */
function passesCompleted(session, showCompleted) {
  if (showCompleted) return true;
  return session.status !== "complete";
}

/**
 * @param {{ status: string, id: string, updatedAt: number, createdAt: number, pendingPermissions?: unknown[] }} session
 * @param {ConversationFilter} filter
 * @param {Record<string, number>} viewed
 */
function passesFilter(session, filter, viewed) {
  if (filter === "all") return true;
  if (filter === "needs") return needsAttention(session);
  if (filter === "working") return session.status === "working" || session.status === "verifying";
  if (filter === "unread") return isUnread(session, viewed);
  return true;
}

/**
 * @param {{
 *   request?: string,
 *   summary?: string,
 *   messages?: Array<{ text?: string }>
 * }} session
 * @param {string} query
 */
function passesQuery(session, query, searchMatches) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if ((session.request ?? "").toLowerCase().includes(q)) return true;
  if ((session.summary ?? "").toLowerCase().includes(q)) return true;
  if (searchMatches) return searchMatches.has(session.id);
  const messages = session.messages ?? [];
  for (const m of messages) {
    if ((m.text ?? "").toLowerCase().includes(q)) return true;
  }
  return false;
}

/**
 * @template {{ id: string, status: string, updatedAt: number, createdAt: number, request?: string, summary?: string, messages?: Array<{ text?: string }> }} S
 * @param {S[]} sessions
 * @param {{ filter: ConversationFilter, query: string, showCompleted: boolean, viewed: Record<string, number>, searchMatches?: Set<string> }} o
 * @returns {S[]}
 */
export function filterSessions(sessions, o) {
  const { filter, query, showCompleted, viewed, searchMatches } = o;
  return sessions
    .filter((s) => passesCompleted(s, showCompleted))
    .filter((s) => passesFilter(s, filter, viewed))
    .filter((s) => passesQuery(s, query, searchMatches))
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
