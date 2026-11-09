export function hasPendingUserRequest(session: {
  pendingPermissions?: unknown[];
  pendingDevCommand?: unknown;
}): boolean;
