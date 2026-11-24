import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownBlocks } from "./markdownBlocks.mjs";

const render = (text) =>
  renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm] }, text));
// Whitespace between blocks is not shown.
const flat = (html) => html.replace(/>\s+</g, "><").trim();
const inBlocks = (text) => flat(markdownBlocks(text).map(render).join(""));

const SAMPLES = {
  prose: "## Result\n\nChanged `src/a.ts` and **tests**.\n\nMore *text* here.\nSame paragraph.",
  tightList: "Done:\n\n- one\n- two\n- three\n\nAfter.",
  looseList: "- one\n\n- two\n\n  still two\n\n- three\n\nAfter.",
  listAfterText: "Steps:\n1. a\n\n2. b\n\n3. c\n\nEnd.",
  nested: "- a\n  - b\n\n    deep\n  - c\n\n- d\n\n> quote\n\nEnd",
  twoLists: "- a\n- b\n\n1. x\n2. y\n",
  code: "Text\n\n```ts\nconst a = 1;\n\n\nfunction f() {}\n\n- not a list\n```\n\nAfter",
  tilde: "~~~\n```\n\ninside\n~~~\n\nAfter",
  longFence: "````md\n```js\n\nx\n```\n\n````\n\nAfter",
  fenceInList: "- item\n\n  ```js\n  a\n\n  b\n  ```\n\n- next\n\nAfter",
  fenceOnListLine: "- ```js\n  a\n\n  b\n  ```\n\nAfter\n\nMore",
  fenceInQuote: "> ```\n> a\n>\n> b\n> ```\n\nAfter",
  indented: "Para\n\n    code line\n\n    more code\n\nAfter",
  table: "Before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nAfter",
  tasks: "- [x] done\n- [ ] todo\n\nEnd",
  rules: "A\n\n---\n\nB\n\n***\n\nC",
  setext: "Title\n=====\n\nSub\n---\n\nText",
  quotes: "> a\n\n> b\n\n> - c\n>\n> - d",
  references: "See [one] and [two][2].\n\nText\n\n[one]: https://a.example\n[2]: https://b.example",
  footnotes: "Text[^1] here.\n\nMore\n\n[^1]: A note.\n",
  html: "<div>\n\n**bold**\n\n</div>\n\n<!-- c\n\nd -->\n\nEnd",
  windows: "A\r\n\r\n- x\r\n\r\n- y\r\n\r\nB",
  links: "Visit https://example.com now.\n\nAnd <https://b.example>.",
  blankStart: "\n\n\nText\n\n\n\nMore\n\n",
  starsList: "* a\n\n* b\n\n+ c\n\n+ d\n\nEnd",
  parenList: "1) a\n\n2) b\n\nEnd",
};

test("a reply in blocks reads exactly as the whole reply", () => {
  for (const [name, text] of Object.entries(SAMPLES))
    assert.equal(inBlocks(text), flat(render(text)), name);
  const all = Object.entries(SAMPLES)
    .filter(([name]) => !["references", "footnotes", "html"].includes(name))
    .map(([, text]) => text)
    .join("\n\n");
  assert.equal(inBlocks(all), flat(render(all)), "all together");
});

test("it does at every point while the reply is being written", () => {
  for (const [name, text] of Object.entries(SAMPLES))
    for (let end = 1; end <= text.length; end++)
      assert.equal(
        inBlocks(text.slice(0, end)),
        flat(render(text.slice(0, end))),
        `${name} at ${end}: ${JSON.stringify(text.slice(Math.max(0, end - 20), end))}`,
      );
});

test("finished blocks stay the same text as more is written", () => {
  const text = SAMPLES.code + "\n\n" + SAMPLES.prose;
  let before = [];
  for (let end = 1; end <= text.length; end++) {
    const blocks = markdownBlocks(text.slice(0, end));
    for (let i = 0; i < before.length - 1; i++)
      if (i < blocks.length - 1) assert.equal(blocks[i].trimEnd(), before[i].trimEnd());
    before = blocks;
  }
  assert.ok(before.length > 5);
});
