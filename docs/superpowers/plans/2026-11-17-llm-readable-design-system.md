# LLM-Readable Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a three-layer token system, LLM-readable `design/` docs, a CI-ready token audit script, and replace hardcoded visual values on enforce-path CSS with Layer 2 tokens.

**Architecture:** Keep Arc `foundation.css` + ADE `:root` / `@theme` in `styles.css` as Layer 1. Add `src/tokens.css` as Layer 2 aliases with fallbacks. Components and utilities (Layer 3) only use Layer 2. Audit scans all CSS; errors only on enforce paths; skip generated/hashed trees.

**Tech Stack:** CSS custom properties, Node.js (`scripts/token-audit.js`, ESM), Markdown under `design/`, existing Arc + ADE tokens, `AGENTS.md`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-17-llm-readable-design-system.md`
- No visual redesign — token swap and docs only
- Do not rewrite published git history (Lovable)
- Do not touch live `~/.ade` data
- Do not commit unless the human explicitly asks
- Enforce paths: `src/**/*.css`, `artifacts/*-workshop/**/*.css`, `cook-archive/**/*.css`
- Skip (report only): `node_modules/`, `.output/`, `.pack/`, `.claude/worktrees/`, `artifacts/shell-regression/static/assets/`
- Definition allowlist: custom-property definitions in `src/components/arc/foundation.css`, ADE token maps in `src/styles.css` `:root` / `@theme`, and all of `src/tokens.css`
- Layer 3 must use `var(--…)` for color, background, padding, margin, gap, border-radius, font-size, font-weight, box-shadow, z-index, transition, and non-zero border-width
- Success: `node scripts/token-audit.js` exits `0` with zero errors on enforce paths
- Local contract after changes that touch app code: `npm run typecheck && npm run lint && npm run build && npm test` (audit is the primary gate for this plan; full suite before claiming done)

## File map

| File | Responsibility |
| --- | --- |
| `src/tokens.css` | Layer 2 aliases (+ any missing Layer 1 primitives: z-index, font-weight, border-width, opacity, size) |
| `src/styles.css` | Import `tokens.css` after foundation; keep ADE Layer 1; tokenize Layer 3 rules |
| `src/components/arc/foundation.css` | Unchanged as Layer 1 source (definitions stay raw) |
| `src/components/arc/**/*.module.css` | Layer 3 → Layer 2 refs |
| `src/components/ade/**/*.css` | Layer 3 → Layer 2 refs |
| `artifacts/*-workshop/**/*.css`, `cook-archive/**/*.css` | Enforce-path token swap |
| `design/foundations/*.md` | Human/LLM foundation specs |
| `design/tokens/token-reference.md` | Master variable map |
| `design/components/*.md` | Specs for listed existing components |
| `scripts/token-audit.js` | CI audit |
| `scripts/token-audit.test.mjs` | Unit tests for classifier / suggestions |
| `AGENTS.md` | UI token instructions |
| `package.json` | Optional `"token-audit": "node scripts/token-audit.js"` script |

### Layer 2 alias naming (canonical)

Use these names in `tokens.css` and docs (map to existing Layer 1):

**Color:** `--color-text`, `--color-text-secondary`, `--color-text-muted`, `--color-bg`, `--color-surface`, `--color-surface-raised`, `--color-surface-muted`, `--color-border`, `--color-border-subtle`, `--color-border-strong`, `--color-link`, `--color-accent`, `--color-accent-strong`, `--color-accent-subtle`, `--color-accent-foreground`, `--color-danger`, `--color-danger-foreground`, `--color-success`, `--color-warning`, `--color-deck`, `--color-deck-foreground`, `--color-scrim`, `--color-focus-ring`

**Spacing:** alias `--space-1`…`--space-24` already on Layer 1; expose same names as Layer 2 (or `--spacing-*` aliases pointing at `--space-*`). Prefer keeping `--space-*` as the Layer 2 names agents use (document as such) to avoid double-rename churn. Add `--space-0: 0` if useful.

**Typography:** `--font-family-display`, `--font-family-body`, `--font-family-mono` → existing; sizes keep `--text-xs`…`--text-5xl`; add `--font-weight-regular: 400`, `--font-weight-medium: 500`, `--font-weight-semibold: 600`; line-height `--leading-display`, `--leading-body`; tracking as today.

**Radius:** `--radius-control`, `--radius-panel`, `--radius-surface`, `--radius-pill`, plus `--radius-xs/sm/md` if needed for ADE dense UI.

**Elevation:** `--shadow-resting`, `--shadow-raised`, `--shadow-floating`; component-specific shadows (process-key) get named tokens e.g. `--shadow-process-key`, `--shadow-process-key-hover`.

**Z-index:** `--z-base: 0`, `--z-raised: 1`, `--z-dropdown: 50`, `--z-sticky: 100`, `--z-overlay: 200`, `--z-modal: 300`, `--z-toast: 400`, `--z-veil: 2147483647`

**Motion:** `--duration-instant/fast/standard/considered/spring`, `--ease-enter/standard/exit/in-out/spring`

**Border width:** `--border-width-hairline: 1px`, `--border-width-thick: 2px`, `--border-width-heavy: 3px`

**Opacity:** `--opacity-disabled: 0.52`, `--opacity-hover: 0.91`, `--opacity-pressed: 0.84`, etc. as needed from audit

**Size (control/hit):** reuse `--control-height-*`; add `--size-hit-seam: 18px`, `--size-hit-collapse: 20px` when replacing panel seam hit areas

---

### Task 1: Inventory audit report

**Files:**
- Create: `docs/superpowers/specs/2026-11-17-token-audit-inventory.md` (one-shot report; optional to keep)
- Read: all enforce + skip CSS

**Interfaces:**
- Consumes: Global Constraints path lists
- Produces: Category totals and hottest files for Tasks 2–5

- [ ] **Step 1: Run inventory script**

```bash
node --input-type=module <<'EOF'
import fs from "node:fs";
import path from "node:path";
// Walk repo, classify skip vs enforce, count categories excluding --token: definitions
// Print markdown tables: by category, by file (enforce), skipped file list
EOF
```

Or implement the same logic inside a temporary `node` one-liner / Task 4's audit with `--inventory`.

Expected: foundation.css + styles.css token maps dominate color counts but are definition-allowlisted; hottest Layer 3 files include workshops, `host-editor.css`, `processes.css`, Arc modules, Layer 3 rules in `styles.css`.

- [ ] **Step 2: Paste summary into inventory markdown** (categories + top enforce files + skip list)

- [ ] **Step 3: Do not commit** unless human asks

---

### Task 2: Create `src/tokens.css` and wire import

**Files:**
- Create: `src/tokens.css`
- Modify: `src/styles.css` (add `@import "./tokens.css";` immediately after `@import "./components/arc/foundation.css";`)

**Interfaces:**
- Consumes: Layer 1 names from foundation + ADE `:root`
- Produces: All Layer 2 aliases listed in File map

- [ ] **Step 1: Write `src/tokens.css`**

```css
/**
 * Layer 2 — project aliases.
 * Components (Layer 3) must only use these names (or documented Layer-1-as-Layer-2
 * spacing/type tokens like --space-* and --text-*).
 * Layer 1 lives in foundation.css + ADE :root maps in styles.css.
 */
:root {
  /* Colors */
  --color-text: var(--foreground, oklch(0.18 0.006 70));
  --color-text-secondary: var(--text-secondary, oklch(0.43 0.025 80));
  --color-text-muted: var(--text-muted, oklch(0.59 0.03 85));
  --color-bg: var(--background, oklch(0.945 0.02 90));
  --color-surface: var(--surface, oklch(0.977 0.01 90));
  --color-surface-raised: var(--surface-raised, oklch(0.977 0.01 90));
  --color-surface-muted: var(--surface-muted, oklch(0.92 0.02 88));
  --color-border: var(--border, oklch(0.86 0.03 85));
  --color-border-subtle: var(--border-subtle, oklch(0.9 0.025 87));
  --color-border-strong: var(--border-strong, oklch(0.78 0.035 82));
  --color-link: var(--teal-deep, oklch(0.38 0.06 190));
  --color-accent: var(--accent, oklch(0.69 0.15 65));
  --color-accent-strong: var(--accent-strong, oklch(0.55 0.13 65));
  --color-accent-subtle: var(--accent-subtle, transparent);
  --color-accent-foreground: var(--accent-foreground, oklch(0.18 0.006 70));
  --color-danger: var(--danger, oklch(0.55 0.18 28));
  --color-danger-foreground: var(--danger-foreground, oklch(0.985 0.008 90));
  --color-success: var(--success, oklch(0.47 0.07 190));
  --color-warning: var(--warning, oklch(0.55 0.13 65));
  --color-deck: var(--deck, oklch(0.18 0.006 70));
  --color-deck-foreground: var(--deck-foreground, oklch(0.945 0.02 90));
  --color-scrim: var(--scrim, oklch(0.18 0.006 70 / 0.45));
  --color-focus-ring: var(--focus-ring, transparent);

  /* Typography aliases */
  --font-family-display: var(--font-display, "Geist", sans-serif);
  --font-family-body: var(--font-body, "Inter", sans-serif);
  --font-family-mono: var(--font-mono, "IBM Plex Mono", monospace);
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;

  /* Border widths */
  --border-width-hairline: 1px;
  --border-width-thick: 2px;
  --border-width-heavy: 3px;

  /* Z-index */
  --z-base: 0;
  --z-raised: 1;
  --z-dropdown: 50;
  --z-sticky: 100;
  --z-overlay: 200;
  --z-modal: 300;
  --z-toast: 400;
  --z-veil: 2147483647;

  /* Opacity */
  --opacity-disabled: 0.52;
  --opacity-hover: 0.91;
  --opacity-pressed: 0.84;
  --opacity-muted: 0.3;

  /* Hit / chrome sizes used by panel seams */
  --size-hit-seam: 18px;
  --size-hit-collapse: 20px;

  /* Process-key elevation (ADE) — values match current processes.css */
  --shadow-process-key: inset 0 1px 0 color-mix(in oklab, white 80%, transparent),
    0 2px 0 color-mix(in oklab, var(--ink) 6%, transparent),
    0 2px 4px oklch(0.18 0.006 70 / 0.05);
  --shadow-process-key-hover: inset 0 1px 0 color-mix(in oklab, white 85%, transparent),
    0 3px 0 color-mix(in oklab, var(--ink) 6%, transparent),
    0 4px 7px oklch(0.18 0.006 70 / 0.08);
  --shadow-process-key-active: inset 0 1px 0 color-mix(in oklab, white 55%, transparent),
    0 1px 0 color-mix(in oklab, var(--ink) 5%, transparent);
  --shadow-process-key-disabled: inset 0 1px 0 color-mix(in oklab, white 35%, transparent);
}

:root[data-theme="dark"] {
  --shadow-process-key: inset 0 1px 0 oklch(1 0 0 / 0.08),
    0 2px 0 oklch(0 0 0 / 0.28),
    0 2px 4px oklch(0 0 0 / 0.35);
  --shadow-process-key-hover: inset 0 1px 0 oklch(1 0 0 / 0.12),
    0 3px 0 oklch(0 0 0 / 0.3),
    0 4px 8px oklch(0 0 0 / 0.4);
  --shadow-process-key-active: inset 0 1px 0 oklch(1 0 0 / 0.06);
}
```

Also document in-file that Layer 2 **spacing/type/radius/shadow/motion** agents should use the existing `--space-*`, `--text-*`, `--radius-*`, `--shadow-resting|raised|floating`, `--duration-*`, `--ease-*` names (treated as Layer 2 by convention).

Extend the file with any additional tokens discovered in Task 1 (workshop-specific shadows/colors) as named aliases rather than leaving raw values in Layer 3.

- [ ] **Step 2: Wire import in `src/styles.css`**

After:

```css
@import "./components/arc/foundation.css";
```

add:

```css
@import "./tokens.css";
```

- [ ] **Step 3: Sanity-check import order**

```bash
rg -n '@import' src/styles.css | head
```

Expected: foundation then tokens near the top.

---

### Task 3: Token audit script + tests

**Files:**
- Create: `scripts/token-audit.js`
- Create: `scripts/token-audit.test.mjs`
- Modify: `package.json` — add `"token-audit": "node scripts/token-audit.js"`

**Interfaces:**
- Consumes: Layer 2 names from Task 2; path rules from Global Constraints
- Produces: CLI exit `0`/`1`; stdout lines `file:line: severity: violation → suggestion`

- [ ] **Step 1: Write failing tests**

```js
// scripts/token-audit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { classifyLine, suggestToken, isSkippedPath, isDefinitionAllowlisted } from "./token-audit.js";

test("skips generated paths", () => {
  assert.equal(isSkippedPath("artifacts/shell-regression/static/assets/styles-Y0YZqQE6.css"), true);
  assert.equal(isSkippedPath("src/styles.css"), false);
});

test("hardcoded hex in Layer 3 is error", () => {
  const r = classifyLine("  color: #ff00aa;", { file: "src/components/ade/x.css", lineNo: 1, inCustomPropDef: false });
  assert.equal(r?.severity, "error");
  assert.match(r.suggestion, /--color-/);
});

test("token definition raw value is allowed", () => {
  const r = classifyLine("  --ink: oklch(0.18 0.006 70);", {
    file: "src/styles.css",
    lineNo: 1,
    inCustomPropDef: true,
  });
  assert.equal(r, null);
});

test("raw duration is warning", () => {
  const r = classifyLine("  transition: opacity 120ms linear;", {
    file: "src/components/ade/x.css",
    lineNo: 1,
    inCustomPropDef: false,
  });
  assert.equal(r?.severity, "warning");
});
```

- [ ] **Step 2: Run tests — expect FAIL** (module missing)

```bash
node --test scripts/token-audit.test.mjs
```

- [ ] **Step 3: Implement `scripts/token-audit.js`**

Export:

- `isSkippedPath(relPath)`
- `isEnforcePath(relPath)`
- `isDefinitionAllowlisted(relPath, line)` — true if line matches `/^\s*--[\w-]+\s*:/` in foundation, tokens.css, or styles.css token maps (entire `:root` / `@theme` custom props in those files)
- `suggestToken(kind, rawValue)` — nearest map for colors/spacing/radius/duration/z-index/font-weight
- `classifyLine(line, ctx)` — returns `{ severity, violation, suggestion } | null`
- `auditFiles(rootDir)` — walk, scan, return `{ errors, warnings, skipped }`
- CLI: print each finding; `process.exit(errors.length ? 1 : 0)`

Detection rules (Layer 3 only):

| Kind | Pattern | Severity |
| --- | --- | --- |
| color | `#…`, `rgb(`, `rgba(`, `hsl(`, `hsla(`, `oklch(` outside `var(` | error |
| spacing | `padding|margin|gap|…` with `px`/`rem` not via `var(` | error |
| radius | `border-radius:` with length not `var(`/`50%`/`9999px` via token | error |
| shadow | `box-shadow:` not `none`/`var(` | error |
| z-index | `z-index: <number>` | error |
| border-width | `border(-…)?-width:` or `border: Npx` when N≠0 | error |
| font-size | `font-size:` with raw length/em | error |
| font-weight | `font-weight: <number>` | error |
| duration | `Ns`/`Nms` in transition/animation | warning |

Ignore: `transparent`, `currentColor`, `none`, `inherit`, `0`, `0s`, comments, `url(`.

Suggestion table examples: `#7747ff` → `--color-accent` (or leave as accent definition); `8px` → `--space-2`; `120ms` → `--duration-instant`; `500` → `--font-weight-medium`; `z-index: 1` → `--z-raised`.

- [ ] **Step 4: Run tests — expect PASS**

```bash
node --test scripts/token-audit.test.mjs
```

- [ ] **Step 5: Add npm script**

```json
"token-audit": "node scripts/token-audit.js"
```

- [ ] **Step 6: Run audit (baseline — expect errors)**

```bash
npm run token-audit; echo exit:$?
```

---

### Task 4: Design foundations + token reference

**Files:**
- Create: `design/foundations/color.md`, `spacing.md`, `typography.md`, `radius.md`, `elevation.md`, `motion.md`
- Create: `design/tokens/token-reference.md`

**Interfaces:**
- Consumes: Final token list from Task 2
- Produces: Docs agents must read before UI work

- [ ] **Step 1: Write each foundations file** with: purpose, token table (name | resolves to | when to use), light/dark notes, do/don't

- [ ] **Step 2: Write `token-reference.md`** — exhaustive table of every Layer 2 (+ documented Layer-1-as-L2) variable, value/source, usage

- [ ] **Step 3: Spot-check names against `src/tokens.css`**

```bash
rg -o '--[a-z0-9-]+' src/tokens.css | sort -u | wc -l
rg -o '`--[a-z0-9-]+`' design/tokens/token-reference.md | sort -u | wc -l
```

---

### Task 5: Design component specs

**Files:** Create under `design/components/`:

- `button.md`, `segmented-control.md`, `theme-switch.md`, `text-shimmer.md`
- `shell.md`, `top-bar.md`, `composer.md`, `session-message.md`, `status-pill.md`, `conversation-list.md`, `processes-ade-row.md`, `host-editor.md`, `skill-card.md`, `browser-chrome.md`
- `dialog.md`, `dropdown-menu.md`, `tabs.md`

Each file template:

```markdown
# <Name>

## 1. Metadata
- **Name:**
- **Category:**
- **Status:** active
- **Source:** `path/to/component`

## 2. Overview
- When to use
- When not to use

## 3. Anatomy
- …

## 4. Tokens used
- `--color-…`, `--space-…`, …

## 5. Props/API
- (from TSX)

## 6. States
- default, hover, active, focus, disabled, error (N/A if none)

## 7. Code example
\`\`\`tsx
\`\`\`

## 8. Cross-references
- Related: …
```

- [ ] **Step 1: Read each component source** (tsx + css module) and fill specs — only real props/states
- [ ] **Step 2: Verify no fictional components**

---

### Task 6: Replace hardcoded values — `src/` product CSS

**Files:**
- Modify: `src/styles.css` (Layer 3 only — leave `:root` / `@theme` definitions)
- Modify: `src/components/ade/host-editor.css`
- Modify: `src/components/ade/processes/processes.css`
- Modify: `src/components/arc/button/button.module.css`
- Modify: `src/components/arc/segmented-control/segmented-control.module.css`
- Modify: `src/components/arc/theme-switch/theme-switch.module.css`
- Modify: `src/components/arc/text-shimmer/text-shimmer.module.css` (if any violations)

**Interfaces:**
- Consumes: Layer 2 tokens
- Produces: Cleaner audit for `src/`

- [ ] **Step 1: Replace in `processes.css`** — shadows → `--shadow-process-key*`, radius → `--radius-control` or nearest, durations → `--duration-instant`, easings → `--ease-standard`, borders → `--border-width-*`

- [ ] **Step 2: Replace in `host-editor.css`** — map px gaps/padding to `--space-*`, font sizes to `--text-*` or new `--text-editor: 11px` Layer 1 in tokens if 11px is intentional mono chrome size, weights to `--font-weight-*`

- [ ] **Step 3: Replace Layer 3 in `styles.css`** — e.g. `.theme-veil` `z-index` → `var(--z-veil)`; panel seam `1px` → `var(--border-width-hairline)`; hit areas → `--size-hit-*`; markdown `font-weight: 500` → `var(--font-weight-medium)`; `border-radius: 12px` → nearest radius token; opacities → `--opacity-*`; keep `@keyframes` translate distances as warnings or add `--space-2` where `8px`

- [ ] **Step 4: Replace Arc modules** — `font-weight: 500` → `var(--font-weight-medium)`; `opacity: .52` → `var(--opacity-disabled)`; spinner border widths → tokens; `outline: 2px` → `--border-width-thick`

- [ ] **Step 5: Run audit filtered mentally for `src/`**

```bash
npm run token-audit 2>&1 | rg '^src/' | head -50
```

---

### Task 7: Replace hardcoded values — workshops + cook-archive

**Files:**
- Modify: `artifacts/agent-computer-workshop/fidelity.css`
- Modify: `artifacts/composer-reference-workshop/workshop.css`
- Modify: `artifacts/processes-workshop/shared.css`
- Modify: `artifacts/processes-workshop/workshop.css`
- Modify: `artifacts/responsive-panels-workshop/shared.css`
- Modify: `artifacts/skills-workspace-workshop/shared.css`
- Modify: `cook-archive/2026-11-15-agent-selector/harness/stage.css`

**Interfaces:**
- Consumes: Layer 2; may need workshop-local aliases added to `tokens.css` if values are intentional one-offs
- Produces: Enforce-path zero errors

- [ ] **Step 1: For each file, replace colors/spacing/type/radius/shadow/z/duration** with tokens; if a workshop is a standalone HTML demo without importing `tokens.css`, either (a) add a `<link>` / `@import` to a copied token snippet, or (b) prefix the file with `@import` path to `../../src/tokens.css` (and foundation if needed) so `var()` resolves in demos

- [ ] **Step 2: Prefer (b) relative `@import` to `src/tokens.css` + foundation when the workshop already mirrors ADE tokens**

- [ ] **Step 3: Re-run full audit**

```bash
npm run token-audit; echo exit:$?
```

Expected: exit `0` (warnings allowed on stderr/stdout but no errors)

---

### Task 8: AGENTS.md instructions + final verification

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add section** (keep AGENTS.md net size in check — short):

```markdown
## Design tokens (UI)

Before writing or modifying any UI code, read the relevant design file in `design/`. Use only tokens from `src/tokens.css` (Layer 2 aliases) and the documented Layer-2-by-convention tokens (`--space-*`, `--text-*`, `--radius-*`, `--shadow-resting|raised|floating`, `--duration-*`, `--ease-*`). Do not introduce raw hex/rgb/oklch, px spacing, bare font sizes/weights, radii, shadows, z-index, or transition durations in component CSS. Run `npm run token-audit` before committing. Zero errors required.
```

- [ ] **Step 2: Run token audit — zero errors**

```bash
npm run token-audit
```

Expected: exit code `0`

- [ ] **Step 3: Run full local contract**

```bash
npm run typecheck && npm run lint && npm run build && npm test
```

Expected: all pass

- [ ] **Step 4: Stop — do not commit** unless human asks; summarize findings + paths changed

---

## Spec coverage check

| Spec requirement | Task |
| --- | --- |
| Audit inventory | 1 |
| tokens.css three layers | 2 |
| design/foundations + token-reference | 4 |
| design/components for existing only | 5 |
| token-audit.js CI-ready | 3 |
| Replace hardcoded on enforce paths | 6–7 |
| AGENTS.md instruction | 8 |
| Scan all CSS / skip generated | 3 |
| Zero errors | 8 |

## Placeholder / consistency self-review

- Alias names fixed in File map; Tasks 2–7 use the same names
- No TBD steps
- Commits deferred to human request (user rule)
