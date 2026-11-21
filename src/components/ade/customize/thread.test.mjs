import test from "node:test";
import assert from "node:assert/strict";
import { threadItems } from "./thread.mjs";

const m = (id, role, text) => ({ id, role, text });
const isFix = (message) => message.role === "user" && message.text.startsWith("ADE ran");
const kinds = (items) => items.map((item) => `${item.kind}:${item.message?.id ?? item.attempts}`);

const thread = [
  m("1", "user", "Add a Copy log button"),
  m("2", "agent", "Added it."),
  m("3", "user", "ADE ran its checks. Tests failed"),
  m("4", "agent", "Fixed the test."),
];

test("a change whose checks now pass folds the automatic attempts into one item", () => {
  const items = threadItems(thread, isFix, true);
  assert.deepEqual(kinds(items), ["message:1", "resolved:1", "message:4"]);
  assert.deepEqual(
    items[1].messages.map((x) => x.id),
    ["2", "3"],
  );
});

test("the fold counts every automatic attempt and stops at what the person typed", () => {
  const items = threadItems(
    [
      m("0", "user", "First request"),
      m("0a", "agent", "Done."),
      m("1", "user", "Also add a tooltip"),
      m("2", "agent", "Added."),
      m("3", "user", "ADE ran its checks. Lint failed"),
      m("4", "agent", "Tried."),
      m("5", "user", "ADE ran the checks. Lint failed"),
      m("6", "agent", "Fixed."),
    ],
    isFix,
    true,
  );
  assert.deepEqual(kinds(items), [
    "message:0",
    "message:0a",
    "message:1",
    "resolved:2",
    "message:6",
  ]);
});

test("a failed change keeps the attempts and marks repeated identical replies", () => {
  const items = threadItems(
    [
      ...thread.slice(0, 3),
      m("4", "agent", "Added it."),
      m("5", "user", "ADE ran its checks. x"),
      m("6", "agent", " Added it. "),
    ],
    isFix,
    false,
  );
  assert.deepEqual(kinds(items), ["message:1", "message:2", "fix:3", "same:4", "fix:5", "same:6"]);
});

test("a thread without automatic attempts is unchanged", () => {
  const plain = [m("1", "user", "Hi"), m("2", "agent", "Hello")];
  assert.deepEqual(kinds(threadItems(plain, isFix, true)), ["message:1", "message:2"]);
});
