/**
 * Upgrade only the exact untouched layout default from the previous ADE shell.
 * User-adjusted layouts must remain intact.
 */
export function migrateDefaultLayout(stored, previousDefault, nextDefault) {
  if (!stored) return stored;

  try {
    const layout = JSON.parse(stored);
    const keys = Object.keys(previousDefault);
    if (
      !layout ||
      typeof layout !== "object" ||
      Array.isArray(layout) ||
      Object.keys(layout).length !== keys.length ||
      !keys.every((key) => layout[key] === previousDefault[key])
    ) {
      return stored;
    }
    return JSON.stringify(nextDefault);
  } catch {
    return stored;
  }
}
