# Spacing

Spacing and control sizing from Arc foundation, treated as Layer 2 by convention. Use `--space-*` for gaps/padding/margins; use `--control-height-*` and `--size-hit-*` for interactive chrome.

Source: `--space-*` / `--control-height-*` in `src/components/arc/foundation.css`; `--size-hit-*` in `src/tokens.css`.

## Tokens

| Name | Resolves to | When to use |
| --- | --- | --- |
| `--space-1` | `0.25rem` (4px) | Hairline gaps, icon-to-label tightness |
| `--space-2` | `0.5rem` (8px) | Compact control gaps, dense lists |
| `--space-3` | `0.75rem` (12px) | Default small padding, sm control inset |
| `--space-4` | `1rem` (16px) | Standard padding and button horizontal inset |
| `--space-5` | `1.25rem` (20px) | Comfortable control padding (lg) |
| `--space-6` | `1.5rem` (24px) | Section padding inside panels |
| `--space-8` | `2rem` (32px) | Medium section rhythm |
| `--space-10` | `2.5rem` (40px) | Large section gaps |
| `--space-12` | `3rem` (48px) | Pane / column breathing room |
| `--space-16` | `4rem` (64px) | Page-scale vertical rhythm |
| `--space-20` | `5rem` (80px) | Sparse marketing-scale gaps (rare in workbench) |
| `--space-24` | `6rem` (96px) | Maximum scale spacer |
| `--control-height-sm` | `2.25rem` | Compact controls (segmented, dense tools) |
| `--control-height-md` | `2.75rem` | Default buttons and inputs |
| `--control-height-lg` | `3.125rem` | Emphasized / touch-friendly controls |
| `--size-hit-seam` | `18px` | Panel seam hit target |
| `--size-hit-collapse` | `20px` | Collapse / chrome hit target |

## Light / dark

Spacing tokens are theme-invariant (rem/px lengths). Visual density comes from color/elevation, not from changing `--space-*`.

## Do

- Stick to the scale — prefer neighbouring steps over inventing `13px`.
- Pair control height with matching horizontal padding (`--space-3` / `--space-4` / `--space-5`).
- Use `--size-hit-*` only for ADE panel chrome hit areas.

## Don't

- Don't mix ad-hoc pixel paddings with the scale in the same component.
- Don't shrink hit targets below `--size-hit-*` / `--control-height-sm` for pointer UI.
- Don't redefine `--space-*` locally — change layout structure instead.
