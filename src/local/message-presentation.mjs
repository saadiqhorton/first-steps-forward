// The CLI receives the full prompt. This optional, bounded presentation keeps
// the user's draft and its selected context readable in the conversation.
export function readMessagePresentation(value) {
  if (value == null) return undefined;
  if (
    typeof value !== "object" ||
    typeof value.text !== "string" ||
    value.text.length > 100000 ||
    !Array.isArray(value.references) ||
    value.references.length > 100
  )
    throw new TypeError("Invalid message presentation.");
  const references = value.references.map((item) => {
    if (
      !item ||
      !["workflow", "skill", "file", "folder"].includes(item.kind) ||
      typeof item.label !== "string" ||
      !item.label ||
      item.label.length > 4096 ||
      typeof item.detail !== "string" ||
      item.detail.length > 8192
    )
      throw new TypeError("Invalid message reference.");
    return { kind: item.kind, label: item.label, detail: item.detail };
  });
  return { text: value.text, references };
}
