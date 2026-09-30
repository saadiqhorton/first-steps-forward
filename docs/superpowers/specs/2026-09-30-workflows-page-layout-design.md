# Workflows page Enjoy-layout (ADE styling)

**Date:** 2026-09-30  
**Status:** Approved (layout-only; keep ADE visual language)

## Goal

Make `/p/$projectId/workflows` structurally closer to Enjoy’s Workflows browse + details experience, using ADE’s existing paper/panel/amber styling. Do not introduce a dark theme on this page.

## Non-goals

- Dark / Enjoy color theme
- Collections, “+ New collection”, Scheduled filters
- Card “duplicate” / circular-arrow control
- New workflow persistence fields (categories, owners, schedules)
- Changing how Run works (still navigates to conversations with `?workflow=<id>`, prefill only, never auto-send)

## Current state

- Flat list of workflow rows with Use / Edit / Delete / Duplicate
- Inline `WorkflowEditor` above the list
- Start screen still uses compact `WorkflowCards` (keep working)

## Target layout

```
┌─────────────────────────────────────────────┬──────────────────────┐
│ Workflows                                   │ Workflow details  ✕  │
│ [All] [Built-in] [Yours]                    │ icon · Built-in/Yours│
│ [Search……………………]                            │ Title                │
│                                             │ tags (agent / perm)  │
│ Built-in                                    │ description + prompt │
│  ┌────────┐ ┌────────┐                      │                      │
│  │ card   │ │ card   │  (selected = ring)   │ [Edit]*  [Run]       │
│  └────────┘ └────────┘                      │                      │
│ Yours                                       │ *user-owned only     │
│  ┌────────┐                                 │                      │
│  └────────┘                                 │                      │
│ [+ New workflow]                            │                      │
└─────────────────────────────────────────────┴──────────────────────┘
```

Details pane is **inside the Workflows route** (split beside the browse column). It does not replace Shell Activity / Preview / Terminal.

## Behavior

| Action | Behavior |
|--------|----------|
| Filter chips | `All` / `Built-in` / `Yours` — client-only over `workflow.builtIn` |
| Search | Case-insensitive match on `name` + `description` |
| Groups | Sections labeled **Built-in** and **Yours** (omit empty section) |
| Card click | Select → open/update details pane |
| Card Run (play) | Same as today’s Use: link to conversations with `workflow` search |
| Details Run | Same |
| Details Edit | User-owned only → open `WorkflowEditor` (replace details body or full browse column; prefer details/editor in the right pane) |
| Details close (X) | Clear selection |
| New workflow | Opens editor (right pane or full-width replace of details) |
| Built-in Edit/Delete/Duplicate | Not offered. API copy must not say “Duplicate it instead.” |
| Delete | Available for user-owned from details (confirm), not as a primary card control |

## Card content

- Small accent icon tile (deterministic from `id`; ADE-friendly colors, not Enjoy neon)
- Title + 2-line clamped description
- Play control only (no duplicate)
- Selected: visible ring/border using existing ink/amber tokens

## Styling

Reuse ADE tokens (`bg-paper`, `bg-panel`, `border-line`, `btn-amber`, `btn-quiet`, `label-mono`, `font-display`). Cards may use `card-panel` or equivalent. No purple glow, no dark canvas.

## API / copy

Update built-in guard errors in `src/local/workflows.mjs` (and tests) from “Duplicate it instead.” to neutral wording, e.g. “Built-in workflows can’t be edited.” / “…can’t be deleted.”

## Success criteria

1. Workflows page shows filters, search, grouped cards, and a details sidebar on select.
2. No Duplicate control anywhere in the Workflows UI.
3. Run still prefills conversations; built-ins remain non-editable.
4. Light ADE look preserved; page readable on desktop and a narrow main pane.
5. Start-screen workflow cards still prefill as today.
