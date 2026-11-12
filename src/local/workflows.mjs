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
    description: "Turn my feature request into an implementation plan grounded in this repository.",
    permission: "plan",
    prompt: `Turn my feature request into an implementation plan grounded in this repository.

1. Read the request, repository guidance, and relevant code. If no feature was provided or clearly identified in the current conversation, ask which feature to plan. Restate the user problem, desired behavior, and explicit non-goals.
2. Trace the nearest existing flow and identify reusable components, state, storage, APIs, permissions, and tests. Link to the actual files or symbols that would change. Do not propose new infrastructure before checking what exists.
3. Identify decisions that materially change scope or architecture. Use documented conventions for routine choices; separate assumptions from questions that genuinely block implementation.
4. Break the work into small, ordered steps, each with its user-visible outcome, likely files, dependencies, and acceptance checks. Include failure states, compatibility, and migration work where the existing architecture requires them. Respect any design workshop requirements for new UI.
5. Propose focused tests for the risky behavior and a validation path through the affected packages. Explain any rollout or rollback requirement using the project's actual release process.

Deliver a concise plan with acceptance criteria, ordered tasks, open decisions, and the smallest useful first slice. This workflow plans the change; it does not implement it or create tracker issues unless I ask.`,
  },
  {
    id: "builtin-accessibility-pass",
    builtIn: true,
    name: "Accessibility pass",
    description:
      "Checks a real user journey for keyboard, labeling, and contrast problems, then fixes confirmed issues.",
    permission: "build",
    prompt: `Make one important user journey easier to use with a keyboard and assistive technology.

1. Use the journey I named, or choose the main task from the app's routes and documentation. State its start, end, and screens. Read the project's design and accessibility guidance first.
2. Run the interface if the environment supports it. Check tab order, visible focus, accessible names, form labels and errors, dialog focus and dismissal, and focus after navigation. Measure text contrast in supported themes instead of guessing from screenshots.
3. Use existing accessibility tooling when available. Inspect the markup as well: automated checks alone do not establish accessibility. If you cannot run the interface or a screen reader, distinguish source findings from unverified behavior.
4. Fix confirmed issues within this journey using existing components and patterns. Preserve intended behavior and appearance. Add regression coverage for changed keyboard or naming behavior where the project has suitable tests.
5. Repeat the affected checks after fixing them.

Return the changes, validation performed, and remaining findings with location, impact, and reproduction steps. Do not claim full accessibility compliance from this limited pass.`,
  },
  {
    id: "builtin-second-opinion-review",
    builtIn: true,
    name: "Second-opinion review",
    description:
      "Reviews a branch for concrete regressions and reports only findings it can explain with evidence.",
    permission: "plan",
    prompt: `Review my current branch as a careful teammate before it merges.

1. Read the repository guidance and identify the intended behavior from the pull request, task, or commits. Use the PR's target branch, or determine the default branch and its merge base. State the comparison and whether you included uncommitted changes. If the base is ambiguous, resolve it before reviewing the wrong diff.
2. Read the changed code and enough callers, data models, and tests to understand its effects. Focus on correctness, data loss, authorization, compatibility, and missing failure handling introduced by this change.
3. Verify candidate findings with a focused test or a concrete execution path. Distinguish confirmed bugs from questions that require more context. Do not pad the review with naming preferences, unrelated cleanup, or speculative risks.
4. Run relevant existing checks when feasible. State checks you could not run and why; passing checks do not prove the absence of bugs.

Return findings ordered by severity, each with file and line, trigger, user impact, and a minimal suggested fix. Keep findings independent so I can act on them separately. If there are none, say so and describe the remaining test gaps. Do not change the branch as part of the review unless I asked for fixes too.`,
  },
  {
    id: "builtin-tidy-the-repo",
    builtIn: true,
    name: "Tidy the repo",
    description:
      "Checks suspected dead code and stale tasks, then proposes a small cleanup backed by usage evidence.",
    permission: "plan",
    prompt: `Find a small, credible cleanup opportunity in this repository.

1. Read package boundaries, public exports, build configuration, generated-file rules, and existing lint or unused-code tooling. Use that tooling when available before relying on text search.
2. Look for unused files, exports, dependencies, and obsolete TODOs. For each candidate, check tests, scripts, dynamic imports, plugin registration, code generation, and documented external consumers. Absence from a simple search is not proof of dead code.
3. Use Git history to understand age and intent where helpful. Treat old TODOs and branches as leads, not automatic deletion candidates. If reviewing branches, check merge status and open pull requests; do not delete local or remote branches.
4. Select up to five candidates with the strongest evidence. For each, list its location, why it appears obsolete, possible consumers, expected benefit, and the checks needed to remove it safely. Separate confirmed dead code from unresolved questions.

Return a ranked cleanup proposal and one recommended first batch. This run is an audit: leave files intact unless I explicitly requested applying a cleanup. When applying an authorized batch, preserve unrelated changes and run the affected tests and build checks.`,
  },
  {
    id: "builtin-project-handoff",
    builtIn: true,
    name: "Hand off a project",
    description:
      "Captures the current state, open decisions, and exact next steps so someone else can pick up the work.",
    permission: "plan",
    prompt: `Write a handoff that lets another person or agent resume this work without guessing.

1. Identify the task being handed over from my request and current project context. Inspect the working tree, branch, recent changes, and relevant notes. If several unrelated tasks are active, ask which one to cover.
2. State the goal, agreed scope, and acceptance criteria. Separate completed work from work in progress, proposed work, and known failures. Link to relevant files, comments, pull requests, and decisions.
3. Record the current revision, relevant uncommitted changes, required environment, and commands to run or validate the affected area. Do not include secrets. If a check has a recorded result, include when and against which state it ran; otherwise mark it unverified.
4. Explain important decisions and rejected approaches only where they prevent repeated mistakes. Identify blockers, unresolved questions, and the evidence already gathered for them.
5. Give the next three concrete actions in order, including how the recipient will know the task is done. Mention active local services or temporary files only if they matter to resuming the work.

Deliver a self-contained handoff under 700 words. Keep it in the conversation unless I named a destination. Do not clean up, reset, or commit work merely to make the handoff look finished.`,
  },
  {
    id: "builtin-feature-brief",
    builtIn: true,
    name: "Write a feature brief",
    description:
      "Turns a rough idea into a clear user problem, bounded scope, and observable acceptance criteria.",
    permission: "plan",
    prompt: `Turn my idea into a feature brief that a teammate can evaluate and build from.

1. Identify the idea from my request or the current conversation. If it is missing, ask for it. Read relevant product notes, existing behavior, and customer evidence before expanding the scope.
2. Describe the target user, the task they are trying to complete, the current obstacle, and why solving it matters. Separate supporting evidence from assumptions. Do not invent customer demand, market size, or business impact.
3. Define the smallest useful outcome and explicit non-goals. Describe the main journey, important empty and error states, and what should happen to existing users or data. Reference related behavior the project already supports.
4. Write observable acceptance criteria, including meaningful failure cases. Avoid vague requirements such as "fast," "intuitive," or "seamless" without a concrete definition. Propose a success signal and how it could be measured, clearly labeling any target as a proposal.
5. List dependencies and open decisions, separating questions that block development from details that can be resolved during implementation. Avoid choosing architecture or drawing new UI unless the decision requires it.

Deliver a brief under 800 words with problem, scope, behavior, acceptance criteria, and open questions. This describes what to build and why; implementation sequencing belongs in a separate engineering plan.`,
  },
  {
    id: "builtin-fix-failing-check",
    builtIn: true,
    name: "Fix a failing check",
    description:
      "Follows a CI failure back to its cause, reproduces it locally, and verifies the smallest repair.",
    permission: "build",
    prompt: `Diagnose and fix one failing test, build, lint, or type check.

1. Use the failure log or CI run I provided. Otherwise inspect the latest failing run for the current branch if a CI connection is available. If neither exists, ask for the failing command and output; do not run every expensive check hoping to discover the intended failure.
2. Identify the failing revision, command, runtime, dependency versions, and first meaningful error. Separate the cause from downstream failures, and check whether a newer run already passed.
3. Reproduce the smallest failing command in the appropriate package with the recorded environment as closely as possible. Distinguish a code regression from infrastructure, missing credentials, stale generated files, or an environment mismatch.
4. Trace the cause through the relevant changes and callers. Make the smallest repair that preserves intended behavior. Do not silence the check, weaken assertions, skip a test, or update snapshots solely to make the run green.
5. Run the failing check again, then the affected tests and required dependent-package checks. If the failure is intermittent, repeat the targeted case and report the number of attempts rather than declaring it fixed after one pass.

Return the root cause and evidence, repair, exact validation results, and anything still blocked. If local reproduction is impossible, provide a specific next diagnostic step instead of a speculative patch.`,
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
