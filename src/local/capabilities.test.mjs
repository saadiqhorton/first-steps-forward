import test from "node:test";
import assert from "node:assert/strict";
import { PERMISSIONS, OPTION_VALUE, optionCapabilities, validateOptions } from "./capabilities.mjs";

test("PERMISSIONS and OPTION_VALUE are fixed shapes", () => {
  assert.deepEqual(PERMISSIONS, ["build", "plan"]);
  assert.ok(OPTION_VALUE.test("high"));
  assert.ok(OPTION_VALUE.test("xhigh"));
  assert.ok(OPTION_VALUE.test("build"));
  assert.ok(!OPTION_VALUE.test("--x"));
  assert.ok(!OPTION_VALUE.test("-c"));
  assert.ok(!OPTION_VALUE.test("HasCaps"));
  assert.ok(!OPTION_VALUE.test(""));
});

test("optionCapabilities lists efforts/speeds from the model and always offers permissions", () => {
  const codexModel = {
    id: "gpt-6-astra",
    efforts: ["low", "medium", "high"],
    defaultEffort: "low",
    speeds: ["fast"],
  };
  const codex = optionCapabilities("codex", codexModel);
  assert.deepEqual(codex.efforts, ["low", "medium", "high"]);
  assert.deepEqual(codex.speeds, ["fast"]);
  assert.deepEqual(codex.permissions, ["build", "plan"]);
  assert.equal(
    codex.permissionNotes.build,
    "Codex workspace-write sandbox: can edit files in this project.",
  );
  assert.equal(
    codex.permissionNotes.plan,
    "Codex read-only sandbox: reads and answers, cannot edit files.",
  );

  const noModel = optionCapabilities("codex", undefined);
  assert.deepEqual(noModel.efforts, []);
  assert.deepEqual(noModel.speeds, []);
  assert.equal(noModel.effortNote, "Pick a model to choose effort.");

  const listedNoEfforts = optionCapabilities("opencode", {
    id: "opencode/big-pickle",
    efforts: [],
  });
  assert.deepEqual(listedNoEfforts.efforts, []);
  assert.equal(listedNoEfforts.effortNote, "");

  const openCode = optionCapabilities("opencode", {
    id: "opencode/ling",
    efforts: ["low", "high"],
  });
  assert.deepEqual(openCode.efforts, ["low", "high"]);
  assert.deepEqual(openCode.speeds, []);
  assert.equal(openCode.speedNote, "OpenCode has no speed setting.");
  assert.equal(
    openCode.permissionNotes.build,
    "Make changes using your configured OpenCode permissions.",
  );
  assert.equal(
    openCode.permissionNotes.plan,
    "OpenCode plan agent: file edits and shell commands need approval, which ADE's non-interactive runs decline.",
  );

  const pi = optionCapabilities("pi", {
    id: "opencode-go/x",
    efforts: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  });
  assert.equal(pi.effortNote, "Pi clamps the level to what the model supports.");
  assert.deepEqual(pi.speeds, []);
  assert.equal(pi.permissionNotes.build, "Pi tools: read, edit, write, grep, find, ls (no shell).");
  assert.equal(pi.permissionNotes.plan, "Pi read-only tools: read, grep, find, ls.");
});

test("validateOptions accepts listed values and rejects unknown, flag-like, and unsupported ones", () => {
  const model = { id: "gpt-6-astra", efforts: ["low", "high"], speeds: ["fast"] };

  assert.deepEqual(
    validateOptions("codex", { effort: "high", speed: "fast", permission: "plan" }, model),
    {
      ok: true,
      value: { effort: "high", speed: "fast", permission: "plan" },
    },
  );
  assert.deepEqual(validateOptions("codex", {}, model), { ok: true, value: {} });

  const unknownEffort = validateOptions("codex", { effort: "ultra" }, model);
  assert.equal(unknownEffort.ok, false);
  assert.match(unknownEffort.error, /effort/i);

  const flagLike = validateOptions("codex", { effort: "--x" }, model);
  assert.equal(flagLike.ok, false);
  assert.match(flagLike.error, /invalid|effort|--x/i);

  const openSpeed = validateOptions("opencode", { speed: "fast" }, { id: "x", efforts: ["low"] });
  assert.equal(openSpeed.ok, false);
  assert.match(openSpeed.error, /speed/i);

  const badPermission = validateOptions(
    "pi",
    { permission: "yolo" },
    { id: "x", efforts: ["low"] },
  );
  assert.equal(badPermission.ok, false);
  assert.match(badPermission.error, /permission/i);
});
