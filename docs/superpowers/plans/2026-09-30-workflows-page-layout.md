# Workflows Page Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `/p/$projectId/workflows` into an Enjoy-like browse + details layout while keeping ADE styling, and remove workflow Duplicate from the UI and API copy.

**Architecture:** Client-only filters/search/grouping over existing `listWorkflows()` data. The Workflows route becomes a horizontal split: browse column + optional details/editor pane. Run continues to navigate to conversations with `?workflow=<id>`. No new persistence fields.

**Tech Stack:** React, TanStack Router, existing ADE UI tokens/components (`WorkflowEditor`, `listWorkflows` / `deleteWorkflow`), Lucide icons.

**Spec:** `docs/superpowers/specs/2026-09-30-workflows-page-layout-design.md`

## Global Constraints

- Layout only — keep ADE paper/panel/amber; no dark theme.
- No Duplicate control; no collections / Scheduled / New collection.
- Built-ins: Run only (no Edit/Delete).
- Run = navigate to `/p/$projectId/conversations` with `search: { workflow: id }` (prefill, never auto-send).
- Commit locally after each task; never push (Lovable).
- Work on `main` only (no worktrees).
- App expected at `http://127.0.0.1:3100`.

## File map

| File | Role |
|------|------|
| `src/components/ade/workflows/workflowFilters.ts` | Pure filter/group/search helpers + icon accent picker |
| `src/components/ade/workflows/workflowFilters.test.mjs` | Unit tests for helpers |
| `src/components/ade/workflows/WorkflowBrowseCard.tsx` | Card UI (icon, title, description, play, selected) |
| `src/components/ade/workflows/WorkflowDetailsPane.tsx` | Details sidebar (close, tags, description/prompt, Edit/Run/Delete) |
| `src/routes/p.$projectId.workflows.tsx` | Page shell: filters, search, groups, selection, editor wiring |
| `src/local/workflows.mjs` | Neutral built-in error strings |
| `src/local/workflows.test.mjs` | Assert updated error strings |
| `src/components/ade/workflows/WorkflowCards.tsx` | Leave as start-screen compact cards (no duplicate; optional play alignment only if needed) |

---

### Task 1: Filter / group / search helpers

**Files:**
- Create: `src/components/ade/workflows/workflowFilters.ts`
- Create: `src/components/ade/workflows/workflowFilters.test.mjs`
- Modify: `package.json` only if the `test` script must register the new test file (follow how other UI/helper tests are included; if helpers are run via a glob, skip)

**Interfaces:**
- Produces:
  - `export type WorkflowFilter = "all" | "builtin" | "yours"`
  - `export function filterWorkflows(workflows: Workflow[], filter: WorkflowFilter, query: string): Workflow[]`
  - `export function groupWorkflows(workflows: Workflow[]): { builtIn: Workflow[]; yours: Workflow[] }`
  - `export function workflowAccent(id: string): string` — returns a stable Tailwind bg class from a small ADE-safe palette

- [ ] **Step 1: Write failing tests** in `workflowFilters.test.mjs` (use `node:test` + `node:assert/strict`):

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterWorkflows,
  groupWorkflows,
  workflowAccent,
} from "./workflowFilters.ts"; // or .js build path — match repo convention for TS helpers under test

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
```

If the repo cannot import `.ts` from `node --test`, implement helpers as `workflowFilters.mjs` instead (plain JS with JSDoc) and test that file — prefer matching existing `src/local/*.mjs` test style over inventing a TS loader.

- [ ] **Step 2: Run tests — expect FAIL**

Run: `node --test src/components/ade/workflows/workflowFilters.test.mjs`

- [ ] **Step 3: Implement helpers**

```ts
export type WorkflowFilter = "all" | "builtin" | "yours";

export function filterWorkflows(workflows, filter, query) {
  const q = query.trim().toLowerCase();
  return workflows.filter((w) => {
    if (filter === "builtin" && !w.builtIn) return false;
    if (filter === "yours" && w.builtIn) return false;
    if (!q) return true;
    return (
      w.name.toLowerCase().includes(q) ||
      (w.description ?? "").toLowerCase().includes(q)
    );
  });
}

export function groupWorkflows(workflows) {
  return {
    builtIn: workflows.filter((w) => w.builtIn),
    yours: workflows.filter((w) => !w.builtIn),
  };
}

const ACCENTS = ["bg-amber/20", "bg-ink/10", "bg-danger/10", "bg-ink/5"];
export function workflowAccent(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * (i + 1)) % ACCENTS.length;
  return ACCENTS[h];
}
```

Adjust accent class names to real tokens that exist in the project CSS if `/20` variants are invalid.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/components/ade/workflows/workflowFilters.* package.json
git commit -m "$(cat <<'EOF'
feat(workflows): add browse filter and group helpers

Client-only All/Built-in/Yours filtering and search so the Workflows
page can match Enjoy's browse layout without new persistence.
EOF
)"
```

---

### Task 2: Neutralize built-in Duplicate API copy

**Files:**
- Modify: `src/local/workflows.mjs`
- Modify: `src/local/workflows.test.mjs`

**Interfaces:**
- Consumes: existing `upsertWorkflow` / delete guards
- Produces: error strings without “Duplicate”

- [ ] **Step 1: Update failing assertions** in `workflows.test.mjs` that expect `"Duplicate it instead."` to expect:
  - `"Built-in workflows can't be edited."`
  - `"Built-in workflows can't be deleted."`

- [ ] **Step 2: Run `node --test src/local/workflows.test.mjs` — expect FAIL** on those assertions

- [ ] **Step 3: Change the two error strings in `workflows.mjs`** to match

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/local/workflows.mjs src/local/workflows.test.mjs
git commit -m "$(cat <<'EOF'
fix(workflows): drop Duplicate suggestion from built-in errors

Built-ins stay read-only; copy no longer tells users to duplicate them.
EOF
)"
```

---

### Task 3: Browse card + details pane components

**Files:**
- Create: `src/components/ade/workflows/WorkflowBrowseCard.tsx`
- Create: `src/components/ade/workflows/WorkflowDetailsPane.tsx`

**Interfaces:**
- Consumes: `Workflow` from `@/lib/ade/types`, `workflowAccent`, TanStack `Link`
- Produces:
  - `WorkflowBrowseCard({ workflow, selected, projectId, onSelect })`
  - `WorkflowDetailsPane({ workflow, projectId, onClose, onEdit, onDelete })`

- [ ] **Step 1: Implement `WorkflowBrowseCard`**
  - Button/card selects on click (`onSelect`)
  - Show accent tile, name, `line-clamp-2` description
  - Play `Link` to `/p/$projectId/conversations` with `search={{ workflow: workflow.id }}` — `stopPropagation` on click so it doesn’t only select
  - Selected: stronger border (e.g. `border-amber` or `ring-1 ring-ink/30`)
  - No duplicate control

- [ ] **Step 2: Implement `WorkflowDetailsPane`**
  - Header “Workflow details” + close button calling `onClose`
  - Accent icon, eyebrow `Built-in` or `Yours`, title
  - Tags: agent label if `agentId`, permission label if set (`Any agent` / permission name as quiet pills)
  - Body: description then prompt in readable mono/pre-wrap
  - Footer: `Edit` + `Delete` only if `!workflow.builtIn`; always `Run` as amber `Link` (same route as card play)
  - ADE classes only

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`  
Expected: PASS for these files

- [ ] **Step 4: Commit**

```bash
git add src/components/ade/workflows/WorkflowBrowseCard.tsx src/components/ade/workflows/WorkflowDetailsPane.tsx
git commit -m "$(cat <<'EOF'
feat(workflows): add browse card and details pane

Card + sidebar pieces for Enjoy-like browse/select without duplicate.
EOF
)"
```

---

### Task 4: Wire Workflows page layout

**Files:**
- Modify: `src/routes/p.$projectId.workflows.tsx` (replace list UI)

**Interfaces:**
- Consumes: helpers + `WorkflowBrowseCard` + `WorkflowDetailsPane` + existing `WorkflowEditor` / store APIs

- [ ] **Step 1: Rewrite page structure**
  - Outer: `flex min-h-0 flex-1 overflow-hidden`
  - Left: scrollable browse (`flex-1`) with title, filter chips, search input, `+ New workflow`
  - After filter+search: `groupWorkflows(filterWorkflows(...))`; render section headings only when non-empty; grid of `WorkflowBrowseCard`
  - Right: when `selected` or `editor !== null`, show pane (~`w-full max-w-md` / `min-w-[20rem]`) with border-l
    - If `editor !== null`, render `WorkflowEditor` in the pane (keep remount `key` behavior)
    - Else if `selected`, render `WorkflowDetailsPane`
  - Selection state: `selectedId: string | null`; derive `selected` from workflows list
  - Remove all Duplicate UI and the `duplicate()` helper
  - Empty filter results: short dim message
  - Keep `?new=1` → open editor behavior

- [ ] **Step 2: Lint + typecheck**

Run:
```bash
npx eslint src/routes/p.\$projectId.workflows.tsx src/components/ade/workflows/*.tsx src/components/ade/workflows/workflowFilters.*
npx tsc --noEmit -p tsconfig.json
```
Expected: PASS

- [ ] **Step 3: Manual browser check** at `http://127.0.0.1:3100/p/<projectId>/workflows`
  - Filters + search work
  - Select opens details; X closes
  - Run lands on conversations with prefill
  - New / Edit work for user workflows; built-ins have no Edit/Delete/Duplicate
  - No dark theme

- [ ] **Step 4: Commit**

```bash
git add src/routes/p.\$projectId.workflows.tsx
git commit -m "$(cat <<'EOF'
feat(ui): Enjoy-style workflows browse and details layout

Filters, search, grouped cards, and a details pane using ADE styling,
without duplicate or dark theme.
EOF
)"
```

---

### Task 5: Smoke start-screen cards + cleanup

**Files:**
- Modify only if needed: `src/components/ade/workflows/WorkflowCards.tsx`
- Grep for `Duplicate` / `duplicate(` under `src/` and remove leftovers

- [ ] **Step 1: Grep**

Run: `rg -n "Duplicate|duplicate\\(" src --glob '!**/workflows.test.mjs'`  
Expected: no Workflows UI duplicate affordance; tests only mention new error strings if at all

- [ ] **Step 2: Confirm start screen** still lists three cards and prefills on click (no regression required beyond keeping `WorkflowCards` API)

- [ ] **Step 3: Commit only if files changed**; otherwise skip empty commit

---

## Done when

- Spec success criteria met
- Tasks 1–4 committed on `main` (unpushed)
- Browser smoke on Workflows page passes
