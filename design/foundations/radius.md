# Radius

Corner radii for controls, panels, and surfaces. ADE sizes Arc’s pill-like radii down for a dense workbench.

Sources: Arc `foundation.css` defines the Arc tokens; ADE `:root` in `src/styles.css` overrides control/panel/surface values. `src/tokens.css` defines `--radius-xs`, `--radius-sm`, `--radius-lg`, `--radius-xl`. The Tailwind `@theme` block in `src/styles.css` maps `rounded-xs` … `rounded-2xl` onto the same scale.

## Scale (Tailwind utilities)

The scale increases with each step.

| Utility | Resolves to | Token | When to use |
| --- | --- | --- | --- |
| `rounded-xs` | `6px` (`0.375rem`) | `--radius-xs` | Tiny corners (chips, tight inline marks) |
| `rounded-sm` | `8px` (`0.5rem`) | `--radius-sm` | Small corners |
| `rounded-md` | `10px` (`0.625rem`) | `var(--radius-control)` | Buttons, inputs, segmented controls |
| `rounded-lg` | `12px` (`0.75rem`) | `--radius-lg` | Medium containers between control and panel |
| `rounded-xl` | `16px` (`1rem`) | `var(--radius-panel)` | Panels, dialogs |
| `rounded-2xl` | `20px` (`1.25rem`) | `var(--radius-surface)` | Large sheets, floating surfaces |

## Tokens

| Name | Resolves to (ADE effective) | When to use |
| --- | --- | --- |
| `--radius-control` | `0.625rem` (10px) | Buttons, inputs, chips, segmented controls |
| `--radius-panel` | `1rem` (16px) | Panels, dialogs, medium containers |
| `--radius-surface` | `1.25rem` (20px) | Large sheets, floating surfaces |
| `--radius-pill` | `9999px` | Fully rounded pills / toggles |
| `--radius-xs` | `0.375rem` | Tiny corners |
| `--radius-sm` | `0.5rem` | Small corners |
| `--radius-lg` | `0.75rem` | Medium-large corners |
| `--radius-xl` | `1rem` | Panel-sized corners |

Arc foundation defaults (before ADE override): control `1.125rem`, panel `1.625rem`, surface `2.125rem`. Prefer the ADE-effective values above when documenting or mocking this app.

## Light / dark

Radius is theme-invariant.

## Do

- Prefer semantic `--radius-control` / `--radius-panel` / `--radius-surface` / `--radius-pill` in hand-written CSS, or the matching `rounded-*` utility.
- Keep nested radii coherent (inner ≈ outer − padding).
- Use `--radius-pill` only for intentionally capsule-shaped chrome.

## Don't

- Don't invent one-off `border-radius: 7px` values.
- Don't use Arc’s larger marketing radii for dense ADE chrome without an explicit product decision.
- Don't mix pill and sharp corners on the same interactive cluster without hierarchy.
