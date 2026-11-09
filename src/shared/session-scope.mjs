/** Stable encoding of a (project, session) pair shared by browser identity and feedback drafts. */
export function sessionPairKey(projectId, sessionId) {
  return JSON.stringify([projectId, sessionId]);
}

/** Browser identity key. Project-only callers retain the bare project id. */
export function browserScope(projectId, sessionId) {
  return sessionId ? `ade-session:${sessionPairKey(projectId, sessionId)}` : projectId;
}

/** Decode a browser identity key into project / optional session ids. */
export function browserScopeParts(key) {
  if (!key.startsWith("ade-session:")) return { projectId: key, sessionId: null };
  try {
    const value = JSON.parse(key.slice("ade-session:".length));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((part) => typeof part === "string" && part)
    )
      return { projectId: value[0], sessionId: value[1] };
  } catch {
    /* An invalid key is not a scoped browser. */
  }
  throw new Error("Invalid browser session identity.");
}
