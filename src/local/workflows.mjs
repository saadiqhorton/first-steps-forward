import { randomUUID } from "node:crypto";

const PERMISSIONS = new Set(["build", "plan"]);

export const BUILT_IN_WORKFLOWS = [
  {
    id: "builtin-design-workshop",
    builtIn: true,
    name: "Design workshop",
    description: "Build an interactive design workshop for the interface.",
    permission: "build",
    prompt:
      "Run a design workshop for: <describe the screen or feature>.\n\nCreate three distinct directions as disposable preview files under .ade/workshop/ — do not change production code. For each direction, summarize the idea and its trade-offs so I can pick one.",
  },
  {
    id: "builtin-explain-codebase",
    builtIn: true,
    name: "Explain this codebase",
    description: "Write a practical introduction to this codebase for a new contributor.",
    permission: "plan",
    prompt:
      "Write a practical introduction to this codebase for a new contributor: what it does, how it is structured, how to run it, and where to start for common changes. Read the code; do not modify any files.",
  },
  {
    id: "builtin-plan-feature",
    builtIn: true,
    name: "Plan the next feature",
    description: "Turn my feature request into an implementation plan.",
    permission: "plan",
    prompt:
      "Turn this feature request into an implementation plan: <describe the feature>.\n\nRead the relevant code, then list the files to change, the steps in order, the risks, and how to verify it. Do not modify any files yet.",
  },
];

const builtinIds = new Set(BUILT_IN_WORKFLOWS.map((workflow) => workflow.id));

export function listWorkflows(stored) {
  const custom = [...(stored ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  return [...BUILT_IN_WORKFLOWS, ...custom];
}

export function validateWorkflow(input, agentIds) {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid workflow." };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (name.length < 1 || name.length > 80)
    return { ok: false, error: "Name must be between 1 and 80 characters." };
  if (description.length > 200)
    return { ok: false, error: "Description must be 200 characters or fewer." };
  if (prompt.length < 1 || prompt.length > 8000)
    return { ok: false, error: "Prompt must be between 1 and 8000 characters." };

  const value = { name, description, prompt };

  if (input.agentId !== undefined && input.agentId !== null && input.agentId !== "") {
    if (typeof input.agentId !== "string" || !(agentIds ?? []).includes(input.agentId))
      return { ok: false, error: "Choose a known agent." };
    value.agentId = input.agentId;
  }

  if (input.permission !== undefined && input.permission !== null && input.permission !== "") {
    if (typeof input.permission !== "string" || !PERMISSIONS.has(input.permission))
      return { ok: false, error: "Permission must be build or plan." };
    value.permission = input.permission;
  }

  return { ok: true, value };
}

export function upsertWorkflow(stored, input, { id, agentIds } = {}) {
  const validated = validateWorkflow(input, agentIds ?? []);
  if (!validated.ok) return { ok: false, error: validated.error, status: 400 };

  const current = [...(stored ?? [])];

  if (id === undefined) {
    const workflow = {
      id: `wf-${randomUUID()}`,
      builtIn: false,
      ...validated.value,
    };
    return { ok: true, stored: [...current, workflow], workflow };
  }

  if (builtinIds.has(id))
    return {
      ok: false,
      status: 400,
      error: "Built-in workflows can't be edited. Duplicate it instead.",
    };

  const index = current.findIndex((workflow) => workflow.id === id);
  if (index < 0) return { ok: false, status: 404, error: "Workflow not found." };

  const workflow = {
    ...current[index],
    ...validated.value,
    id,
    builtIn: false,
  };
  const next = [...current];
  next[index] = workflow;
  return { ok: true, stored: next, workflow };
}

export function deleteWorkflow(stored, id) {
  if (builtinIds.has(id))
    return {
      ok: false,
      status: 400,
      error: "Built-in workflows can't be deleted. Duplicate it instead.",
    };
  const current = [...(stored ?? [])];
  const index = current.findIndex((workflow) => workflow.id === id);
  if (index < 0) return { ok: false, status: 404, error: "Workflow not found." };
  current.splice(index, 1);
  return { ok: true, stored: current };
}
