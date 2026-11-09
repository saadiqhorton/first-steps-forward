/**
 * True when the session is waiting on a permission grant or a proposed
 * developer command — the shared half of `needsYou` / `needsAttention`.
 * @param {{ pendingPermissions?: unknown[], pendingDevCommand?: unknown }} session
 */
export function hasPendingUserRequest(session) {
  return (session.pendingPermissions?.length ?? 0) > 0 || !!session.pendingDevCommand;
}
