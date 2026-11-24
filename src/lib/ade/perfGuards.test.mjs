// Slowdowns that came from one line each and are easy to bring back. Every check names its cost.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../../", import.meta.url));
const read = (file) => readFileSync(path.join(src, file), "utf8");
const files = (dir, match) =>
  readdirSync(path.join(src, dir), { recursive: true })
    .map((name) => path.join(dir, String(name)))
    .filter((name) => match.test(name) && !/\.test(-helper)?\.mjs$/.test(name));

test("no stylesheet uses body:has or :root:has, which restyle the whole page on every change", () => {
  for (const file of ["styles.css", ...files("components", /\.css$/)]) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(css, /(?:^|[\s,}])(?:body|html|:root|\*):has\(/, file);
  }
});

test("long views do not tick every second: the clock lives in small components", () => {
  for (const file of ["SessionView", "ConversationList", "WorkspaceChat", "Shell", "TopBar"]) {
    const source = read(`components/ade/${file}.tsx`);
    const main = source.slice(source.search(new RegExp(`export function ${file}\\b`)));
    assert.doesNotMatch(main, /\buseNow\(/, `${file} re-renders every second`);
  }
});

test("messages are memoized: an unmemoized one parses its Markdown again on every render", () => {
  assert.match(read("components/ade/SessionMessage.tsx"), /export const SessionMessage = memo\(/);
});

test("the page listens for every event the server sends, so nothing has to be polled", () => {
  const store = read("lib/ade/store.tsx");
  const sent = new Set();
  // The agent browser has an EventEmitter of its own.
  for (const file of files("local", /\.mjs$/).filter((name) => !/browser-/.test(name)))
    for (const [, scope] of read(file).matchAll(
      /\b(?:eventHub\.|\b)emit\(["'`]([a-z-]+)(?=[:"'`])(?![^)]*,)/g,
    ))
      sent.add(scope);
  assert.ok(sent.has("workspace-assistant") && sent.has("logs"), [...sent].join());
  for (const scope of sent) assert.ok(store.includes(`"${scope}"`), `${scope} has no listener`);
});

test("nothing saves the workspace without handling the failure", () => {
  for (const file of files("local", /\.mjs$/))
    assert.doesNotMatch(read(file), /\bvoid (?:save|persist)\((?:\w*)\);/, file);
});
