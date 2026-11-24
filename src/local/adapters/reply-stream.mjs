// Turns an agent's text deltas, followed by its whole message, into the text events of one
// reply: shown as it is written, and never repeated when the whole message arrives.

/** One per turn. `begin` a message, add each `delta`, and `end` with the authoritative text. */
export function createReplyStream() {
  let shown = "";
  let held = "";
  let replied = false;
  /** @returns {import("./kit.mjs").SessionEvent[]} */
  const first = (text) => {
    // A turn's later messages are paragraphs of their own.
    const event = { type: /** @type {const} */ ("text"), text: replied ? `\n\n${text}` : text };
    replied = true;
    return [event];
  };
  return {
    begin() {
      shown = held = "";
    },
    /** @param {string} piece @returns {import("./kit.mjs").SessionEvent[]} */
    delta(piece) {
      const text = held + piece;
      // A message starts with something to show; blank pieces wait for it.
      if (!shown && !text.trim()) {
        held = text;
        return [];
      }
      held = "";
      const begun = !!shown;
      shown += text;
      return begun ? [{ type: "text", text, continues: true }] : first(text);
    },
    /** @param {string} full @returns {import("./kit.mjs").SessionEvent[]} */
    end(full) {
      const before = shown;
      shown = held = "";
      if (before && full.startsWith(before)) {
        const rest = full.slice(before.length);
        return rest ? [{ type: "text", text: rest, continues: true }] : [];
      }
      return full.trim() ? first(full) : [];
    },
  };
}
