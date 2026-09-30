import { randomUUID } from "node:crypto";

const PERMISSIONS = new Set(["build", "plan"]);

export const BUILT_IN_WORKFLOWS = [
  {
    id: "builtin-design-workshop",
    builtIn: true,
    name: "Design Workshop",
    description:
      "Build an interactive design workshop for the interface, component, or motion I want to explore.",
    permission: "build",
    prompt: `Build an interactive design workshop for the interface, component, or motion I want to explore.

1. Read the relevant source, design guidance, components, and theme tokens. Understand the product's behavior and preserve choices I've already made. If the target is unclear, ask what I want to explore.
2. Create three to five meaningfully different directions with stable numbers, short names, and one-sentence tradeoffs. Vary shape, hierarchy, spacing, or interaction—not just colors unless color is the question. Keep sample content and surrounding chrome consistent. Reuse the project's visual language and prefer HTML, CSS, SVG, and existing icons.
3. Build a standalone comparison page at a distinct path such as \`artifacts/<workshop-name>/index.html\`, or use the environment's required hosting mechanism. Include a numbered overview, expanded options, back/previous/next navigation, and direct links to each option. Show small controls close up and in context. Add theme, color, or state controls only when relevant; motion studies need replay, pause, and speed controls.
4. Make the interaction being compared work with local sample data. Keep each option's state isolated, preserve keyboard focus, and make reset clear drafts, timers, and animations. Respect reduced motion. Keep explanations outside the simulated product and identify mock outcomes; previews must not trigger real account actions or messages.
5. Do one quick rendered check that the options are visible and the central interaction works. Fix review blockers, then open the preview and share its link with a brief recommendation. Keep workshop QA light unless project requirements say otherwise. Leave the preview available while I review.
6. Carry feedback into the same workshop without renumbering options or undoing accepted details. A request to iterate stays in the workshop; a clear choice to use a design authorizes applying that scope to the current product source. Preserve real data and behavior, run relevant checks, and review the integrated result. Favorites alone do not authorize implementation.

After the final decision and any integration checks, stop only the preview server you launched unless I ask to keep it running. Keep the workshop files for later reference.`,
  },
  {
    id: "builtin-explain-codebase",
    builtIn: true,
    name: "Explain this codebase",
    description: "Write a practical introduction to this codebase for a new teammate.",
    permission: "plan",
    prompt: `Write a practical introduction to this codebase for a new teammate.

1. Read the repository guidance, manifests, entry points, and existing architecture notes. Establish what the product does and which packages are maintained; distinguish prototypes and generated code.
2. Trace one representative user action from its entry point through business logic, storage or network boundaries, and back to the result. Link to the actual files and key symbols at each step.
3. Explain package responsibilities, important data models, and external services. Label uncertain relationships instead of inferring an architecture from folder names alone.
4. Extract the minimum setup, run, and test commands from the project's own configuration. State which commands you verified and which require credentials or services you do not have.
5. Suggest one small first contribution, where to make it, and how to check it. Include the conventions most likely to trip up a newcomer.

Deliver a linked guide under 1,000 words with a recommended reading order. Use diagrams only if they clarify the traced flow. Keep it in this conversation unless I requested a documentation file.`,
  },
  {
    id: "builtin-plan-feature",
    builtIn: true,
    name: "Plan the next feature",
    description:
      "Turn my feature request into an implementation plan grounded in this repository.",
    permission: "plan",
    prompt: `Turn my feature request into an implementation plan grounded in this repository.

1. Read the request, repository guidance, and relevant code. If no feature was provided or clearly identified in the current conversation, ask which feature to plan. Restate the user problem, desired behavior, and explicit non-goals.
2. Trace the nearest existing flow and identify reusable components, state, storage, APIs, permissions, and tests. Link to the actual files or symbols that would change. Do not propose new infrastructure before checking what exists.
3. Identify decisions that materially change scope or architecture. Use documented conventions for routine choices; separate assumptions from questions that genuinely block implementation.
4. Break the work into small, ordered steps, each with its user-visible outcome, likely files, dependencies, and acceptance checks. Include failure states, compatibility, and migration work where the existing architecture requires them. Respect any design workshop requirements for new UI.
5. Propose focused tests for the risky behavior and a validation path through the affected packages. Explain any rollout or rollback requirement using the project's actual deployment model.

Deliver a concise plan with acceptance criteria, ordered tasks, open decisions, and the smallest useful first slice. This workflow plans the change; it does not implement it or create tracker issues unless I ask.`,
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
      error: "Built-in workflows can't be edited.",
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
      error: "Built-in workflows can't be deleted.",
    };
  const current = [...(stored ?? [])];
  const index = current.findIndex((workflow) => workflow.id === id);
  if (index < 0) return { ok: false, status: 404, error: "Workflow not found." };
  current.splice(index, 1);
  return { ok: true, stored: current };
}
