// Streams a growing message to open pages as the text added since the last
// push, so a reply appears as it is written without refetching the conversation.

/** Finished messages are forgotten oldest first; one sent again just repeats its text. */
const MAX_TRACKED = 200;

/**
 * @param {(event: string, key: string, build: () => object | null) => void} push
 * @param {string} event the SSE event name
 */
export function createMessageStream(push, event) {
  /** Message id to how much of its text has been sent. */
  const sent = new Map();
  return {
    /** @param {string} parentId the conversation @param {{ id: string, text: string }} message */
    update(parentId, message) {
      push(event, message.id, () => {
        const offset = sent.get(message.id) ?? 0;
        if (message.text.length <= offset) return null;
        sent.delete(message.id);
        sent.set(message.id, message.text.length);
        if (sent.size > MAX_TRACKED) sent.delete(sent.keys().next().value);
        const { text, ...rest } = message;
        return { parentId, offset, append: text.slice(offset), message: rest };
      });
    },
  };
}
