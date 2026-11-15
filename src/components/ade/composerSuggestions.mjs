/** Find a command or reference token ending at the caret, at a word boundary. */
export function composerTrigger(text, caret) {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)([\/@])([^\s@]*)$/.exec(before);
  if (!match || (match[1] === "/" && match[2].includes("/"))) return null;
  return {
    kind: match[1] === "/" ? "command" : "reference",
    query: match[2],
    start: caret - match[2].length - 1,
    end: caret,
  };
}

/** Replace only the active token, preserving text after the caret. */
export function replaceComposerTrigger(text, trigger, value) {
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.end);
  const suffix = after && !/^\s/.test(after) ? " " : after ? "" : " ";
  const inserted = value + suffix;
  return { text: before + inserted + after, caret: before.length + inserted.length };
}
