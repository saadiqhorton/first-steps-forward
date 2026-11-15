import test from "node:test";
import assert from "node:assert/strict";
import { adapters } from "./adapters/index.mjs";
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

test("optionCapabilities lists model options and the agent's own permission modes", () => {
  const codexModel = {
    id: "gpt-6-astra",
    efforts: ["low", "medium", "high"],
    defaultEffort: "low",
    speeds: ["fast"],
  };
  const codex = optionCapabilities(adapters.codex, codexModel);
  assert.deepEqual(codex.efforts, ["low", "medium", "high"]);
  assert.deepEqual(codex.speeds, ["fast"]);
  assert.deepEqual(codex.permissions, ["plan", "build", "approve", "full"]);
  assert.equal(codex.permissionLabels.plan, "Read-only");
  assert.equal(
    codex.permissionNotes.build,
    "Codex workspace-write sandbox; approval requests follow Codex's non-interactive policy.",
  );
  assert.equal(
    codex.permissionNotes.plan,
    "Codex read-only sandbox: reads and answers, cannot edit files.",
  );

  const noModel = optionCapabilities(adapters.codex, undefined);
  assert.deepEqual(noModel.efforts, []);
  assert.deepEqual(noModel.speeds, []);
  assert.equal(noModel.effortNote, "Pick a model to choose effort.");

  const listedNoEfforts = optionCapabilities(adapters.opencode, {
    id: "opencode/big-pickle",
    efforts: [],
  });
  assert.deepEqual(listedNoEfforts.efforts, []);
  assert.equal(listedNoEfforts.effortNote, "");

  const openCode = optionCapabilities(adapters.opencode, {
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

  const pi = optionCapabilities(adapters.pi, {
    id: "opencode-go/x",
    efforts: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  });
  assert.equal(pi.effortNote, "Pi clamps the level to what the model supports.");
  assert.deepEqual(pi.speeds, []);
  assert.equal(pi.permissionNotes.build, "Pi tools: read, edit, write, grep, find, ls (no shell).");
  assert.equal(pi.permissionNotes.plan, "Pi read-only tools: read, grep, find, ls.");

  const claude = optionCapabilities(adapters.claude);
  assert.deepEqual(claude.permissions, ["manual", "build", "plan", "auto", "dont-ask", "bypass"]);
  assert.equal(claude.permissionLabels.build, "Accept edits");
  assert.equal(claude.permissionLabels["dont-ask"], "Don't ask");
  assert.equal(claude.permissionLabels.bypass, "Bypass permissions");
  assert.match(claude.permissionNotes.auto, /automatically/);
});

test("validateOptions accepts listed values and rejects unknown, flag-like, and unsupported ones", () => {
  const model = { id: "gpt-6-astra", efforts: ["low", "high"], speeds: ["fast"] };

  assert.deepEqual(
    validateOptions(adapters.codex, { effort: "high", speed: "fast", permission: "plan" }, model),
    {
      ok: true,
      value: { effort: "high", speed: "fast", permission: "plan" },
    },
  );
  assert.deepEqual(validateOptions(adapters.codex, {}, model), { ok: true, value: {} });
  for (const permission of ["manual", "build", "plan", "auto", "dont-ask", "bypass"]) {
    assert.deepEqual(validateOptions(adapters.claude, { permission }), {
      ok: true,
      value: { permission },
    });
  }
  assert.equal(validateOptions(adapters.codex, { permission: "manual" }).ok, false);
  assert.equal(validateOptions(adapters.opencode, { permission: "auto" }).ok, false);

  const unknownEffort = validateOptions(adapters.codex, { effort: "ultra" }, model);
  assert.equal(unknownEffort.ok, false);
  assert.match(unknownEffort.error, /effort/i);

  const flagLike = validateOptions(adapters.codex, { effort: "--x" }, model);
  assert.equal(flagLike.ok, false);
  assert.match(flagLike.error, /invalid|effort|--x/i);

  const openSpeed = validateOptions(
    adapters.opencode,
    { speed: "fast" },
    { id: "x", efforts: ["low"] },
  );
  assert.equal(openSpeed.ok, false);
  assert.match(openSpeed.error, /speed/i);

  const badPermission = validateOptions(
    adapters.pi,
    { permission: "yolo" },
    { id: "x", efforts: ["low"] },
  );
  assert.equal(badPermission.ok, false);
  assert.match(badPermission.error, /permission/i);
});
