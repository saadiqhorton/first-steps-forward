# Radius

Corner radii for controls, panels, and surfaces. ADE sizes Arc’s pill-like radii down for a dense workbench.

Sources: Arc `foundation.css` defines the tokens; ADE `:root` in `src/styles.css` overrides control/panel/surface values. Tailwind `@theme` also bridges `--radius-xs`…`--radius-2xl` for utilities.

## Tokens

| Name | Resolves to (ADE effective) | When to use |
| --- | --- | --- |
| `--radius-control` | `0.625rem` | Buttons, inputs, chips, segmented controls |
| `--radius-panel` | `1rem` | Panels, dialogs, medium containers |
| `--radius-surface` | `1.25rem` | Large sheets, floating surfaces |
| `--radius-pill` | `9999px` | Fully rounded pills / toggles |
| `--radius-xs` | `0.375rem` | Tailwind bridge — tiny corners |
| `--radius-sm` | `0.5rem` | Tailwind bridge — small corners |
| `--radius-md` | `0.75rem` | Tailwind bridge — medium corners |
| `--radius-lg` | `var(--radius-control)` | Tailwind bridge → control |
| `--radius-xl` | `var(--radius-panel)` | Tailwind bridge → panel |
| `--radius-2xl` | `var(--radius-surface)` | Tailwind bridge → surface |

Arc foundation defaults (before ADE override): control `1.125rem`, panel `1.625rem`, surface `2.125rem`. Prefer the ADE-effective values above when documenting or mocking this app.

## Light / dark

Radius is theme-invariant.

## Do

- Prefer semantic `--radius-control` / `--radius-panel` / `--radius-surface` / `--radius-pill` in hand-written CSS.
- Keep nested radii coherent (inner ≈ outer − padding).
- Use `--radius-pill` only for intentionally capsule-shaped chrome.

## Don't

- Don't invent one-off `border-radius: 7px` values.
- Don't use Arc’s larger marketing radii for dense ADE chrome without an explicit product decision.
- Don't mix pill and sharp corners on the same interactive cluster without hierarchy.
