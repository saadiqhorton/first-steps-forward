/**
 * The Chat/Work pick a saved Luna thread stands for.
 *
 * The thread's own `permission` is the source of truth: the service stores "plan" for Chat
 * (read-only answers) and any other permission for Work. Hardcoding "plan" here made a thread
 * saved as Work reopen as Chat, so this mapping lives in one small, tested place.
 */

/**
 * @typedef {{ agentId: string, model: string, effort: string, speed: string, permission: string }} WorkspaceSelection
 * @typedef {{ agentId?: string, model?: string, effort?: string, permission?: string }} ThreadFields
 */

/**
 * The picker state a thread was saved with. A thread with no permission (an older thread) reads
 * as Chat, the service default.
 * @param {ThreadFields} thread
 * @returns {WorkspaceSelection}
 */
export function threadSelection(thread) {
  return {
    agentId: thread?.agentId ?? "",
    model: thread?.model ?? "",
    effort: thread?.effort ?? "",
    speed: "",
    permission: thread?.permission || "plan",
  };
}

/**
 * Chat or Work, from the permission. Only Plan is an answer; every other permission lets the
 * agent act.
 * @param {{ permission?: string }} selection
 * @returns {"chat" | "work"}
 */
export function selectionMode(selection) {
  return (selection?.permission ?? "plan") === "plan" ? "chat" : "work";
}
