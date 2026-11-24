// Applies one streamed piece of a message to the conversation already on screen.

/**
 * @template {{ id: string, text: string }} M
 * @param {M[]} messages
 * @param {{ offset: number, append: string, message: Omit<M, "text"> & { id: string } }} delta
 *   `append` belongs at `offset` in the message's text
 * @returns {M[] | null} the new list, or null when a piece was missed and the
 *   conversation has to be fetched again
 */
export function applyMessageDelta(messages, { offset, append, message }) {
  const index = messages.findLastIndex((item) => item.id === message.id);
  const known = index < 0 ? "" : messages[index].text;
  if (known.length < offset) return null;
  const text = known.slice(0, offset) + append;
  if (index < 0)
    return [...messages, /** @type {M} */ (/** @type {unknown} */ ({ ...message, text }))];
  if (text === known) return messages;
  const next = messages.slice();
  next[index] = { ...messages[index], ...message, text };
  return next;
}
