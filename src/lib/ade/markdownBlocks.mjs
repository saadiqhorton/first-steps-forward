// Splits a reply that is still being written into its top-level blocks, so only the last one is
// parsed again for each new piece. Anything that could read differently in parts stays whole;
// the finished reply is always parsed as one document.

const LIST = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
/** Definitions and raw HTML reach across blocks. */
const CROSSES_BLOCKS = /^ {0,3}(?:\[[^\]\n]+\]:|<[A-Za-z!/?])/m;

/** @param {string} text @returns {string[]} blocks that render, in order, as `text` does */
export function markdownBlocks(text) {
  if (CROSSES_BLOCKS.test(text)) return [text];
  /** @type {string[]} */
  const blocks = [];
  /** @type {string[]} */
  let block = [];
  let hasList = false;
  let blank = false;
  /** @type {{ char: string, length: number } | null} the open code fence */
  let fence = null;
  for (const line of text.split("\n")) {
    if (!fence && blank && block.length && line.trim()) {
      // An indented line, or another list item, may belong to the list above it.
      const continues = /^\s/.test(line) || (hasList && LIST.test(line));
      if (!continues) {
        blocks.push(block.join("\n"));
        block = [];
        hasList = false;
      }
    }
    const marker = /^\s*(?:(?:[-*+]|\d{1,9}[.)])\s+|>\s?)*(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      const [, run, rest] = marker;
      if (!fence) {
        if (run[0] !== "`" || !rest.includes("`")) fence = { char: run[0], length: run.length };
      } else if (run[0] === fence.char && run.length >= fence.length && !rest.trim()) fence = null;
    }
    if (!fence && LIST.test(line)) hasList = true;
    blank = !line.trim();
    block.push(line);
  }
  if (block.length) blocks.push(block.join("\n"));
  return blocks;
}
