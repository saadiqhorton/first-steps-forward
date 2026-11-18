# LLM-Readable Design System

**Status:** approved for planning  
**Date:** 2026-11-17  
**Approach:** Bridge Layer 2 (`src/tokens.css`) over Arc + ADE Layer 1

## Goal

Make the visual system readable to LLMs and enforceable in CI so UI improvements use one vocabulary instead of inventing raw values. This pass is token structure, docs, audit, and replacement — not a visual redesign.

## Architecture

### Layer 1 — Upstream primitives

Keep existing definition sites:

- `src/components/arc/foundation.css` — Arc neutrals, semantic colors, spacing, type, radius, elevation, motion, accent variants
- `src/styles.css` — ADE workbench palette (`--ink`, `--paper`, `--amber`, …), remaps of Arc semantics, `@theme` bridge to Tailwind

Raw visual values are allowed **only** when defining custom properties on these (and related) token maps.

### Layer 2 — Project aliases

New file: `src/tokens.css`, imported from `src/styles.css` after foundation.

- Aliases reference Layer 1 with fallbacks, e.g. `--color-text: var(--foreground, oklch(0.18 0.006 70))`
- Cover: colors (text, background, link, border, interactive states), spacing (≥8 steps), typography (families, sizes, weights, line heights), radius, elevation/shadow, z-index, motion/transitions
- Add tokens Arc/ADE lack today (z-index scale, font-weight tokens, shared opacities) as Layer 1 primitives inside `tokens.css` if needed, then alias them

### Layer 3 — Components

Component CSS, modules, and project utilities only reference Layer 2 aliases (`var(--color-*)`, `var(--space-*)`, etc.). No raw hex/rgb/oklch, px spacing, bare font sizes/weights, radii, shadows, z-index, or transition durations in Layer 3 rules.

## Scan vs enforce

| Mode | Paths |
| --- | --- |
| **Scan (inventory)** | Every `.css` file in the repo |
| **Enforce + rewrite** | `src/**/*.css`, `artifacts/*-workshop/**/*.css`, `cook-archive/**/*.css` |
| **Skip (report only)** | `node_modules/`, `.output/`, `.pack/`, `.claude/worktrees/`, hashed bundles under `artifacts/shell-regression/static/assets/` |
| **Definition allowlist** | Custom-property definition blocks in Layer 1/2 files (and fallbacks inside `var()`) |

## Deliverables

1. **Audit report** (Step 1) — hardcoded values by category, totals, hottest files (enforce paths emphasized; skip paths listed).
2. **`src/tokens.css`** — Layer 2 (+ any missing Layer 1 primitives).
3. **`design/`** markdown:
   - `design/foundations/` — `color.md`, `spacing.md`, `typography.md`, `radius.md`, `elevation.md`, `motion.md`
   - `design/tokens/token-reference.md` — master map of every CSS variable, value/source, when to use
   - `design/components/` — one file per major **existing** component (template: metadata, overview, anatomy, tokens, props/API, states, code example, cross-refs)
4. **`scripts/token-audit.js`** — scan CSS; print file, line, violation, suggestion; errors vs warnings; exit `1` if any errors on enforce paths.
5. **Replace** hardcoded values on enforce paths with Layer 2 tokens.
6. **`AGENTS.md`** section: before UI work, read `design/`; use only tokens from `tokens.css` (Layer 2); run token audit before commit; zero errors required.

### Component specs (existing only)

- Arc: Button, SegmentedControl, ThemeSwitch, TextShimmer
- ADE: Shell, TopBar, Composer, SessionMessage, StatusPill, ConversationList, Processes/AdeRow, HostEditor, SkillCard, BrowserChrome
- UI: Dialog, DropdownMenu, Tabs

Workshop CSS is tokenized where enforce applies; no component markdown unless it is a distinct reusable product component.

## Audit script behavior

- **Errors:** hardcoded colors; hardcoded spacing in padding/margin/gap (and similar); bare border-radius; bare box-shadow; bare z-index (outside allowlists); bare border widths that are not `0` (use `--border-width-*` tokens, including hairline `1px`)
- **Warnings:** raw durations, uncommon one-off sizes (width/height/icon) when a nearest token exists, bare opacities outside shared opacity tokens
- Non-violations: `transparent`, `currentColor`, `none`, `inherit`, `0`, `100%`/`50%` for layout geometry, `var(--…)`, and values inside custom-property **definitions** on allowlisted token files
- Suggestions map values to the closest Layer 2 token
- Exit code `1` if any **errors** remain on enforce paths after replacement

## Non-goals

- Visual redesign or layout changes
- Rewriting generated/hashed CSS under skip paths
- Forking Arc so upgrades require manual merges of moved primitives
- Committing secrets or touching live `~/.ade` data

## Success criteria

- Enforce-path audit: **zero errors**
- Components and utilities on enforce paths use `var(--…)` for color, background, padding, margin, gap, border-radius, font-size, font-weight, box-shadow, z-index, and transition
- `design/` docs match real tokens and real components
- `AGENTS.md` instructs agents to read design files and run the audit

## Sequencing

1. Inventory audit (report)
2. Author `tokens.css` + wire import
3. Write `design/` foundations + token reference + component specs
4. Ship `scripts/token-audit.js`
5. Replace hardcoded values on enforce paths
6. Update `AGENTS.md`; re-run audit to confirm zero errors
