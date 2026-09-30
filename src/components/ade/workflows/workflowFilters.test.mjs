import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterWorkflows,
  groupWorkflows,
  workflowAccent,
} from "./workflowFilters.mjs";

const sample = [
  { id: "builtin-a", name: "Design workshop", description: "workshop", builtIn: true, prompt: "x" },
  { id: "wf-1", name: "Ship notes", description: "release checklist", builtIn: false, prompt: "y" },
];

describe("filterWorkflows", () => {
  it("filters builtin / yours", () => {
    assert.equal(filterWorkflows(sample, "builtin", "").length, 1);
    assert.equal(filterWorkflows(sample, "yours", "").length, 1);
  });
  it("searches name and description case-insensitively", () => {
    assert.equal(filterWorkflows(sample, "all", "SHIP").length, 1);
    assert.equal(filterWorkflows(sample, "all", "workshop").length, 1);
  });
});

describe("groupWorkflows", () => {
  it("splits built-in vs yours", () => {
    const g = groupWorkflows(sample);
    assert.equal(g.builtIn.length, 1);
    assert.equal(g.yours.length, 1);
  });
});

describe("workflowAccent", () => {
  it("is stable for the same id", () => {
    assert.equal(workflowAccent("builtin-a"), workflowAccent("builtin-a"));
  });
});
