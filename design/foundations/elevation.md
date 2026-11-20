# Elevation

Shadows and stacking. Use Arc’s three elevation shadows for general UI; ADE process-key shadows only for process-key chrome. Z-index tokens live in Layer 2 for stacking order.

Sources: `--shadow-resting|raised|floating` in `src/components/arc/foundation.css` (dark overrides included); `--shadow-process-key*` and `--z-*` in `src/tokens.css`.

## Tokens

| Name | Resolves to (light) | When to use |
| --- | --- | --- |
| `--shadow-resting` | `0 1px 2px oklch(0% 0 0 / .035)` | Subtle lift on resting controls / selected segments |
| `--shadow-raised` | `0 6px 18px … / .065, 0 1px 3px … / .035` | Hovered cards, mid elevation |
| `--shadow-floating` | `0 20px 48px … / .105, 0 3px 10px … / .045` | Popovers, menus, floating panels |
| `--shadow-process-key` | inset highlight + 2px shelf + soft blur | Default process-key keycap |
| `--shadow-process-key-hover` | taller shelf + stronger blur | Process-key hover |
| `--shadow-process-key-active` | compressed inset + short shelf | Process-key pressed |
| `--shadow-process-key-disabled` | muted inset only | Process-key disabled |
| `--z-raised` | `1` | Slightly above siblings |
| `--z-dropdown` | `50` | Menus / dropdowns |
| `--z-veil` | `2147483647` | Full-screen veil / blocking layer |

## Light / dark

- Arc shadows deepen in dark theme (`--shadow-resting|raised|floating`).
- `--shadow-process-key*` has dedicated dark values in `tokens.css` (stronger black shelf / blur; no ink mix).
- Z-index tokens are theme-invariant.

## Do

- Climb the resting → raised → floating ladder; don’t invent new shadow stacks for ordinary UI.
- Pair floating shadows with `--z-dropdown` for menus and popovers.
- Keep process-key shadows on process-key components only.

## Don't

- Don't apply `--shadow-process-key*` to generic buttons or cards.
- Don't hard-code `z-index: 9999` — use `--z-*`.
- Don't stack multiple floating shadows on nested surfaces (muddy depth).
