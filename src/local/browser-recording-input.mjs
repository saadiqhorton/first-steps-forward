// Adapted from T3 Code: apps/desktop/src/preview/RecordingInput.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.

/** Runs inside the inspected page. Unknown iframe and closed shadow focus are treated as sensitive. */
export function recordingKeysAreSensitive() {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return (
    element?.tagName === "IFRAME" ||
    element?.tagName.includes("-") === true ||
    element?.getAttribute("type")?.toLowerCase() === "password"
  );
}

export function recordingKeyLabel(key, modifiers = 0, isMac = process.platform === "darwin") {
  if (typeof key !== "string" || ["Dead", "Process", "Unidentified", ""].includes(key)) return null;
  const parts = [
    modifiers & 2 || key === "Control" ? (isMac ? "⌃" : "Ctrl") : null,
    modifiers & 1 || key === "Alt" ? (isMac ? "⌥" : "Alt") : null,
    modifiers & 8 || key === "Shift" ? (isMac ? "⇧" : "Shift") : null,
    modifiers & 4 || key === "Meta" ? (isMac ? "⌘" : "Win") : null,
  ].filter(Boolean);
  const labels = {
    Enter: "↵",
    Tab: "⇥",
    Backspace: "⌫",
    Delete: "⌦",
    Escape: "Esc",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    " ": "Space",
    Space: "Space",
  };
  if (!["Control", "Alt", "Shift", "Meta"].includes(key))
    parts.push(labels[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  return parts.join(isMac ? "" : " + ").slice(0, 100) || null;
}
