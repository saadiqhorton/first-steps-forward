import test from "node:test";
import assert from "node:assert/strict";
import { applyMessageDelta } from "./messageDelta.mjs";
import { createMessageStream } from "../../local/message-stream.mjs";

const user = { id: "u", role: "user", text: "Hi", at: 1 };
const meta = { id: "a", role: "agent", at: 2 };

test("pieces build one message and leave the others' identity alone", () => {
  let messages = applyMessageDelta([user], { offset: 0, append: "Hel", message: meta });
  messages = applyMessageDelta(messages, { offset: 3, append: "lo", message: meta });
  assert.equal(messages.length, 2);
  assert.equal(messages[1].text, "Hello");
  assert.equal(messages[0], user, "an untouched message must stay the same object (memo)");
});

test("a piece already fetched is not added twice", () => {
  const fetched = [user, { ...meta, text: "Hello wor" }];
  const next = applyMessageDelta(fetched, { offset: 5, append: " world", message: meta });
  assert.equal(next[1].text, "Hello world");
  assert.equal(applyMessageDelta(next, { offset: 0, append: "Hello world", message: meta }), next);
});

test("a missed piece asks for a refetch instead of leaving a hole", () => {
  assert.equal(applyMessageDelta([user], { offset: 4, append: "x", message: meta }), null);
});

test("a stream sends only what was added since the last push", () => {
  let due = null;
  const sent = [];
  const stream = createMessageStream((event, key, build) => {
    due ??= () => {
      due = null;
      const data = build();
      if (data) sent.push([event, key, data.offset, data.append]);
    };
  }, "message-delta");
  const message = { ...meta, text: "One" };
  stream.update("s", message);
  message.text += " two";
  stream.update("s", message);
  due();
  message.text += " three";
  stream.update("s", message);
  due();
  stream.update("s", message);
  due();
  assert.deepEqual(sent, [
    ["message-delta", "a", 0, "One two"],
    ["message-delta", "a", 7, " three"],
  ]);
});
