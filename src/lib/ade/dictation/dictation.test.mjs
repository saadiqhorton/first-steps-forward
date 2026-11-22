import test from "node:test";
import assert from "node:assert/strict";
import {
  NO_RECOGNITION,
  NOT_SECURE,
  composeDictation,
  dictationSupport,
  errorMessage,
  listMics,
  micRoutingSupported,
  resolveMic,
} from "./dictation.mjs";

test("support checks the secure context before speech recognition", () => {
  assert.deepEqual(
    dictationSupport({ hasRecognition: true, isSecureContext: true, hasMediaDevices: true }),
    { ok: true, canPickMic: true },
  );
  assert.deepEqual(
    dictationSupport({ hasRecognition: true, isSecureContext: true, hasMediaDevices: false }),
    { ok: true, canPickMic: false },
  );
  assert.deepEqual(
    dictationSupport({ hasRecognition: false, isSecureContext: false, hasMediaDevices: false }),
    { ok: false, reason: NOT_SECURE },
  );
  assert.deepEqual(
    dictationSupport({ hasRecognition: false, isSecureContext: true, hasMediaDevices: true }),
    { ok: false, reason: NO_RECOGNITION },
  );
  assert.match(NOT_SECURE, /HTTPS \(Tailscale\)/);
  assert.match(NO_RECOGNITION, /Chrome, Edge or Safari/);
});

test("error codes map to plain messages; benign codes are not shown", () => {
  assert.equal(errorMessage("aborted"), null);
  assert.equal(errorMessage("no-speech"), null);
  assert.equal(errorMessage("not-allowed"), errorMessage("NotAllowedError"));
  assert.match(errorMessage("not-allowed"), /blocked for this site.*site settings/);
  assert.match(errorMessage("service-not-allowed"), /speech service/);
  assert.match(errorMessage("audio-capture"), /No microphone found/);
  assert.equal(errorMessage("NotFoundError"), errorMessage("audio-capture"));
  assert.match(errorMessage("NotReadableError"), /in use by another app/);
  assert.match(errorMessage("network"), /couldn't reach its speech service.*Embedded browsers/);
  assert.match(errorMessage("language-not-supported"), /language/);
  assert.equal(errorMessage("bad-grammar"), "Dictation stopped: bad-grammar.");
  assert.equal(errorMessage(undefined), "Dictation stopped: unknown error.");
  assert.equal(errorMessage("constructor"), "Dictation stopped: constructor.");
});

test("dictation lands at the caret with single spacing", () => {
  assert.deepEqual(composeDictation({ before: "", after: "", finals: ["hello"] }), {
    text: "hello",
    caret: 5,
  });
  assert.deepEqual(
    composeDictation({ before: "Hello", after: " world", finals: [" big", " blue "] }),
    { text: "Hello big blue world", caret: 14 },
  );
  assert.deepEqual(
    composeDictation({ before: "Hello ", after: "world", finals: ["big"], interim: "blu" }),
    { text: "Hello big blu world", caret: 13 },
  );
  // Chrome's later results start with a space; joined interims must not double it.
  assert.deepEqual(
    composeDictation({ before: "", after: "", finals: ["the birch"], interim: "a  canoe slid" }),
    { text: "the birch a canoe slid", caret: 22 },
  );
  assert.deepEqual(composeDictation({ before: "Done", after: ".", finals: ["now"] }), {
    text: "Done now.",
    caret: 8,
  });
  assert.deepEqual(composeDictation({ before: "line\n", after: "", finals: ["next"] }), {
    text: "line\nnext",
    caret: 9,
  });
  assert.deepEqual(composeDictation({ before: "ab", after: "cd", finals: [" "], interim: "" }), {
    text: "abcd",
    caret: 2,
  });
  assert.deepEqual(composeDictation({ before: "", after: "tail", finals: [], interim: "say" }), {
    text: "say tail",
    caret: 3,
  });
});

test("mic list drops browser aliases and labels unnamed mics", () => {
  const named = listMics([
    { kind: "audioinput", deviceId: "default", label: "Default" },
    { kind: "audioinput", deviceId: "communications", label: "Communications" },
    { kind: "audioinput", deviceId: "a1", label: "USB Mic" },
    { kind: "videoinput", deviceId: "v1", label: "Camera" },
    { kind: "audioinput", deviceId: "a2", label: "Headset" },
  ]);
  assert.deepEqual(named, {
    mics: [
      { id: "a1", label: "USB Mic" },
      { id: "a2", label: "Headset" },
    ],
    labelsHidden: false,
  });
  assert.deepEqual(
    listMics([
      { kind: "audioinput", deviceId: "x", label: "" },
      { kind: "audioinput", deviceId: "y", label: "" },
    ]),
    {
      mics: [
        { id: "x", label: "Microphone 1" },
        { id: "y", label: "Microphone 2" },
      ],
      labelsHidden: true,
    },
  );
  assert.deepEqual(listMics([{ kind: "audioinput", deviceId: "", label: "" }]), {
    mics: [],
    labelsHidden: true,
  });
  assert.deepEqual(listMics(undefined), { mics: [], labelsHidden: true });
});

test("a saved mic is used when connected and falls back to the default when not", () => {
  const mics = [{ id: "a1", label: "USB Mic" }];
  assert.deepEqual(resolveMic(mics, ""), { deviceId: "", missing: false });
  assert.deepEqual(resolveMic(mics, "a1"), { deviceId: "a1", missing: false });
  assert.deepEqual(resolveMic(mics, "gone"), { deviceId: "", missing: true });
  assert.deepEqual(resolveMic([], "gone", false), { deviceId: "gone", missing: false });
});

test("mic routing needs Chromium-based 135 or newer", () => {
  assert.equal(micRoutingSupported([{ brand: "Chromium", version: "154" }]), true);
  assert.equal(micRoutingSupported([{ brand: "Microsoft Edge", version: "135" }]), true);
  assert.equal(micRoutingSupported([{ brand: "Chromium", version: "134" }]), false);
  assert.equal(micRoutingSupported([{ brand: "Not A Brand", version: "99" }]), false);
  assert.equal(micRoutingSupported(undefined), false);
  assert.equal(micRoutingSupported([{ brand: "Chromium", version: "154" }], true), false);
});
