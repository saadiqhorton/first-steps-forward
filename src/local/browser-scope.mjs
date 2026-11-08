/** Stable browser identity. Project-only callers retain the original key. */
export function browserScope(projectId, sessionId) {
  return sessionId ? `ade-session:${JSON.stringify([projectId, sessionId])}` : projectId;
}

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
