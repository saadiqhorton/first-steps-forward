import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILT_IN_WORKFLOWS,
  deleteWorkflow,
  listWorkflows,
  upsertWorkflow,
  validateWorkflow,
} from "./workflows.mjs";

const AGENTS = ["codex", "claude"];

test("built-in workflows use the Enjoy-style starter prompts", () => {
  assert.equal(BUILT_IN_WORKFLOWS.length, 3);
  assert.deepEqual(
    BUILT_IN_WORKFLOWS.map((w) => w.id),
    ["builtin-design-workshop", "builtin-explain-codebase", "builtin-plan-feature"],
  );
  assert.equal(BUILT_IN_WORKFLOWS[0].name, "Design Workshop");
  assert.equal(
    BUILT_IN_WORKFLOWS[0].description,
    "Build an interactive design workshop for the interface, component, or motion I want to explore.",
  );
  assert.equal(BUILT_IN_WORKFLOWS[0].permission, "build");
  assert.match(BUILT_IN_WORKFLOWS[0].prompt, /artifacts\/<workshop-name>\/index\.html/);
  assert.match(BUILT_IN_WORKFLOWS[0].prompt, /Favorites alone do not authorize implementation/);
  assert.equal(BUILT_IN_WORKFLOWS[1].name, "Explain this codebase");
  assert.equal(
    BUILT_IN_WORKFLOWS[1].description,
    "Write a practical introduction to this codebase for a new teammate.",
  );
  assert.equal(BUILT_IN_WORKFLOWS[1].permission, "plan");
  assert.match(BUILT_IN_WORKFLOWS[1].prompt, /under 1,000 words/);
  assert.match(BUILT_IN_WORKFLOWS[1].prompt, /Keep it in this conversation/);
  assert.equal(BUILT_IN_WORKFLOWS[2].name, "Plan the next feature");
  assert.equal(
    BUILT_IN_WORKFLOWS[2].description,
    "Turn my feature request into an implementation plan grounded in this repository.",
  );
  assert.equal(BUILT_IN_WORKFLOWS[2].permission, "plan");
  assert.match(BUILT_IN_WORKFLOWS[2].prompt, /smallest useful first slice/);
  assert.match(BUILT_IN_WORKFLOWS[2].prompt, /does not implement it/);
  for (const workflow of BUILT_IN_WORKFLOWS) {
    assert.equal(workflow.builtIn, true);
    assert.ok(workflow.prompt.length <= 8000);
    assert.ok(workflow.description.length <= 200);
  }
});

test("listWorkflows puts built-ins first, then stored workflows sorted by name", () => {
  const stored = [
    { id: "wf-z", name: "Zebra", description: "", prompt: "z", builtIn: false },
    { id: "wf-a", name: "Alpha", description: "", prompt: "a", builtIn: false },
  ];
  const listed = listWorkflows(stored);
  assert.deepEqual(
    listed.map((w) => w.id),
    ["builtin-design-workshop", "builtin-explain-codebase", "builtin-plan-feature", "wf-a", "wf-z"],
  );
  assert.deepEqual(
    listWorkflows(undefined).map((w) => w.id),
    ["builtin-design-workshop", "builtin-explain-codebase", "builtin-plan-feature"],
  );
});

test("validateWorkflow enforces length limits, trims, and checks agent/permission", () => {
  const ok = validateWorkflow(
    {
      name: "  Ship it  ",
      description: "  do the thing  ",
      prompt: "  implement feature  ",
      agentId: "codex",
      permission: "build",
    },
    AGENTS,
  );
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, {
    name: "Ship it",
    description: "do the thing",
    prompt: "implement feature",
    agentId: "codex",
    permission: "build",
  });

  assert.equal(validateWorkflow({ name: "", description: "", prompt: "x" }, AGENTS).ok, false);
  assert.equal(
    validateWorkflow({ name: "n", description: "d".repeat(201), prompt: "x" }, AGENTS).ok,
    false,
  );
  assert.equal(
    validateWorkflow({ name: "n".repeat(81), description: "", prompt: "x" }, AGENTS).ok,
    false,
  );
  assert.equal(validateWorkflow({ name: "n", description: "", prompt: "" }, AGENTS).ok, false);
  assert.equal(
    validateWorkflow({ name: "n", description: "", prompt: "p".repeat(8001) }, AGENTS).ok,
    false,
  );
  assert.equal(
    validateWorkflow({ name: "n", description: "", prompt: "x", agentId: "missing" }, AGENTS).ok,
    false,
  );
  assert.equal(
    validateWorkflow({ name: "n", description: "", prompt: "x", permission: "admin" }, AGENTS).ok,
    false,
  );

  const optional = validateWorkflow({ name: "Only name", description: "", prompt: "go" }, AGENTS);
  assert.equal(optional.ok, true);
  assert.equal(optional.value.agentId, undefined);
  assert.equal(optional.value.permission, undefined);
  assert.equal(optional.value.description, "");
});

test("upsertWorkflow creates, updates, and protects built-ins", () => {
  const created = upsertWorkflow(
    [],
    { name: "Mine", description: "", prompt: "do it" },
    {
      agentIds: AGENTS,
    },
  );
  assert.equal(created.ok, true);
  assert.match(created.workflow.id, /^wf-/);
  assert.equal(created.workflow.builtIn, false);
  assert.equal(created.stored.length, 1);

  const updated = upsertWorkflow(
    created.stored,
    {
      name: "Renamed",
      description: "now different",
      prompt: "do more",
      permission: "plan",
    },
    { id: created.workflow.id, agentIds: AGENTS },
  );
  assert.equal(updated.ok, true);
  assert.equal(updated.workflow.name, "Renamed");
  assert.equal(updated.workflow.permission, "plan");
  assert.equal(updated.stored.length, 1);

  const builtin = upsertWorkflow(
    [],
    { name: "Nope", description: "", prompt: "x" },
    {
      id: "builtin-design-workshop",
      agentIds: AGENTS,
    },
  );
  assert.equal(builtin.ok, false);
  assert.equal(builtin.status, 400);
  assert.equal(builtin.error, "Built-in workflows can't be edited.");

  const missing = upsertWorkflow(
    [],
    { name: "Nope", description: "", prompt: "x" },
    {
      id: "wf-missing",
      agentIds: AGENTS,
    },
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 404);

  const invalid = upsertWorkflow(
    [],
    { name: "", description: "", prompt: "" },
    {
      agentIds: AGENTS,
    },
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 400);
});

test("deleteWorkflow removes stored workflows and protects built-ins", () => {
  const seeded = [
    { id: "wf-keep", name: "Keep", description: "", prompt: "k", builtIn: false },
    { id: "wf-gone", name: "Gone", description: "", prompt: "g", builtIn: false },
  ];
  const deleted = deleteWorkflow(seeded, "wf-gone");
  assert.equal(deleted.ok, true);
  assert.deepEqual(
    deleted.stored.map((w) => w.id),
    ["wf-keep"],
  );

  const builtin = deleteWorkflow(seeded, "builtin-explain-codebase");
  assert.equal(builtin.ok, false);
  assert.equal(builtin.status, 400);
  assert.equal(builtin.error, "Built-in workflows can't be deleted.");

  const missing = deleteWorkflow(seeded, "wf-missing");
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 404);
});
