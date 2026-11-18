# Token audit inventory (Step 1)

**Date:** 2026-11-17  
**Repo:** `first-steps-forward-llm-design`  
**Scope:** All `.css` files; enforce-path totals emphasized for Tasks 2–5.

## Method

- **Enforce:** `src/**/*.css`, `artifacts/*-workshop/**/*.css`, `cook-archive/**/*.css`
- **Skip (report only):** `node_modules/`, `.output/`, `.pack/`, `.claude/worktrees/`, `artifacts/shell-regression/static/assets/`
- **Layer-3-style rule:** skip lines matching `/^\s*--[\w-]+\s*:/` (standalone custom-property definition lines)
- **Categories:** `color` (hex/rgb/rgba/hsl/hsla/oklch), `spacing` (padding/margin/gap + px|rem), `fontSize`, `fontWeight` (numeric weights), `radius`, `shadow`, `zIndex`, `duration` (ms/s in transition/animation)

Counts are **line hits** (one line may contribute to multiple categories). Values inside `var(...)` fallbacks on non-definition lines are still counted for inventory breadth.

## File coverage

| Bucket | `.css` files |
| --- | ---: |
| All scanned | 40 |
| Enforce | 15 |
| Skip | 25 |

No `.css` files are present today under `.output/`, `.pack/`, `.claude/worktrees/`, or `artifacts/shell-regression/static/assets/` (skip patterns retained for CI).

## Category totals

### Enforce paths (rewrite target)

| Category | Hits |
| --- | ---: |
| color | 71 |
| spacing | 248 |
| fontSize | 135 |
| fontWeight | 40 |
| radius | 70 |
| shadow | 9 |
| zIndex | 10 |
| duration | 11 |
| **Sum** | **594** |

### Skip paths (informational)

| Category | Hits |
| --- | ---: |
| color | 28 |
| spacing | 51 |
| fontSize | 27 |
| fontWeight | 16 |
| radius | 13 |
| shadow | 4 |
| zIndex | 19 |
| duration | 8 |

### Repository-wide

| Category | Hits |
| --- | ---: |
| color | 99 |
| spacing | 299 |
| fontSize | 162 |
| fontWeight | 56 |
| radius | 83 |
| shadow | 13 |
| zIndex | 29 |
| duration | 19 |

**Observations:** Spacing and font-size dominate enforce-path debt. Color hits on enforce paths are concentrated in `foundation.css` (inline `:root[data-accent]` token maps on single lines) and production Layer 3 (`processes.css`, workshop CSS). Task 3 definition allowlist will exclude most foundation/`styles.css` `:root` maps; this inventory intentionally over-counts those for visibility.

## Top enforce-path files (Layer 3 hotspots)

| Rank | File | Total | color | spacing | fontSize | fontWeight | radius | shadow | zIndex | duration |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `artifacts/processes-workshop/shared.css` | 139 | 3 | 65 | 36 | 11 | 17 | 2 | 2 | 3 |
| 2 | `artifacts/responsive-panels-workshop/shared.css` | 112 | 12 | 51 | 28 | 6 | 11 | 2 | 0 | 2 |
| 3 | `artifacts/processes-workshop/workshop.css` | 91 | 0 | 44 | 29 | 5 | 10 | 1 | 1 | 1 |
| 4 | `artifacts/agent-computer-workshop/fidelity.css` | 66 | 2 | 29 | 17 | 2 | 15 | 1 | 0 | 0 |
| 5 | `artifacts/skills-workspace-workshop/shared.css` | 61 | 0 | 30 | 17 | 5 | 6 | 0 | 2 | 1 |
| 6 | `src/components/arc/foundation.css` | 35 | 35 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 7 | `artifacts/composer-reference-workshop/workshop.css` | 21 | 3 | 6 | 4 | 2 | 3 | 1 | 1 | 1 |
| 8 | `src/styles.css` | 21 | 6 | 0 | 2 | 7 | 3 | 0 | 2 | 1 |
| 9 | `src/components/ade/host-editor.css` | 15 | 0 | 13 | 0 | 0 | 2 | 0 | 0 | 0 |
| 10 | `src/components/ade/processes/processes.css` | 12 | 9 | 0 | 0 | 0 | 1 | 2 | 0 | 0 |
| 11 | `src/components/arc/segmented-control/segmented-control.module.css` | 11 | 1 | 5 | 1 | 1 | 1 | 0 | 2 | 0 |
| 12 | `src/components/arc/button/button.module.css` | 5 | 0 | 1 | 1 | 1 | 0 | 0 | 0 | 2 |
| 13 | `cook-archive/2026-11-15-agent-selector/harness/stage.css` | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| 14 | `src/components/arc/theme-switch/theme-switch.module.css` | 2 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| — | `src/components/arc/text-shimmer/text-shimmer.module.css` | 0 | — | — | — | — | — | — | — | — |

Matches plan expectations: workshop `shared.css` / `workshop.css` files lead; `host-editor.css`, `processes.css`, Arc modules, and Layer 3 rules in `styles.css` follow. `foundation.css` color counts are definition-map noise for enforcement, not Layer 3 rewrites.

## Skipped CSS files (25)

| Path |
| --- |
| `node_modules/@chrome-devtools/devtools-app/chunk-kyst56dv.css` |
| `node_modules/@xterm/xterm/css/xterm.css` |
| `node_modules/nitro/dist/node_modules/youch/build/public/error_cause/style.css` |
| `node_modules/nitro/dist/node_modules/youch/build/public/error_info/style.css` |
| `node_modules/nitro/dist/node_modules/youch/build/public/error_metadata/style.css` |
| `node_modules/nitro/dist/node_modules/youch/build/public/error_stack/style.css` |
| `node_modules/nitro/dist/node_modules/youch/build/public/error_stack_source/style.css` |
| `node_modules/nitro/dist/node_modules/youch/build/public/header/style.css` |
| `node_modules/nitro/dist/node_modules/youch/build/public/layout/style.css` |
| `node_modules/playwright-core/lib/vite/dashboard/assets/codeMirrorModule--QdMvsKi.css` |
| `node_modules/playwright-core/lib/vite/dashboard/assets/index-AwgwcYie.css` |
| `node_modules/playwright-core/lib/vite/htmlReport/report.css` |
| `node_modules/playwright-core/lib/vite/recorder/assets/codeMirrorModule--QdMvsKi.css` |
| `node_modules/playwright-core/lib/vite/recorder/assets/index-BZpYJZ-P.css` |
| `node_modules/playwright-core/lib/vite/traceViewer/codeMirrorModule.-QdMvsKi.css` |
| `node_modules/playwright-core/lib/vite/traceViewer/defaultSettingsView.Bqk9acqE.css` |
| `node_modules/playwright-core/lib/vite/traceViewer/index.B_TqY17P.css` |
| `node_modules/playwright-core/lib/vite/traceViewer/uiMode.CyMfwkXJ.css` |
| `node_modules/playwright-core/lib/vite/traceViewer/xtermModule.kHJ-D0s7.css` |
| `node_modules/tailwindcss/index.css` |
| `node_modules/tailwindcss/preflight.css` |
| `node_modules/tailwindcss/theme.css` |
| `node_modules/tailwindcss/utilities.css` |
| `node_modules/tw-animate-css/dist/tw-animate.css` |
| `node_modules/tw-animate-css/dist/tw-animate-prefix.css` |

## Next steps (Tasks 2–5)

1. Stand up `src/tokens.css` (Layer 2) from spacing/type/color hotspots above.
2. Implement `scripts/token-audit.js` with definition allowlist for `foundation.css`, `styles.css` token maps, and future `tokens.css`.
3. Replace enforce-path raw values starting with workshop + `host-editor.css` / `processes.css` / Arc modules.