/**
 * How a change's conversation is laid out around ADE's automatic fix requests.
 *
 * - A change whose checks now pass (ready or kept): the fix requests and the agent's replies
 *   before the last one fold into one "resolved" item, so the thread does not show failures
 *   next to "all checks passed". It stops at the last message the person typed.
 * - Otherwise everything stays visible, but an agent reply identical to its previous reply
 *   (only fix requests between them) becomes a "same" item.
 *
 * @param {{ id: string; role: string; text: string }[]} messages
 * @param {(message: { role: string; text: string }) => boolean} isFix
 * @param {boolean} resolved
 */
export function threadItems(messages, isFix, resolved) {
  /** @type {any[]} */
  const items = [];
  let start = -1;
  let end = -1;
  if (resolved) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (isFix(messages[i])) {
        end = i;
        break;
      }
    }
    if (end >= 0) {
      start = end;
      while (start > 0 && (messages[start - 1].role !== "user" || isFix(messages[start - 1])))
        start -= 1;
    }
  }
  let lastAgentText = null;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (i === start) {
      const folded = messages.slice(start, end + 1);
      items.push({
        kind: "resolved",
        id: `resolved-${message.id}`,
        messages: folded,
        attempts: folded.filter(isFix).length,
      });
      i = end;
      lastAgentText = null;
      continue;
    }
    if (isFix(message)) {
      items.push({ kind: "fix", message });
      continue;
    }
    if (message.role === "agent") {
      const same = lastAgentText !== null && message.text.trim() === lastAgentText;
      items.push({ kind: same ? "same" : "message", message });
      lastAgentText = message.text.trim();
      continue;
    }
    if (message.role === "user") lastAgentText = null;
    items.push({ kind: "message", message });
  }
  return items;
}
