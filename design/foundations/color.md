# Color

Semantic Layer 2 color aliases for ADE UI. Use only `--color-*` (and documented border widths) in components — never raw Layer 1 names like `--ink`, `--paper`, or `--amber`.

Source: `src/tokens.css` aliases → ADE `:root` maps in `src/styles.css` (overrides Arc `foundation.css`).

## Tokens

| Name | Resolves to (light) | When to use |
| --- | --- | --- |
| `--color-text` | `oklch(0.18 0.006 70)` via `--foreground` / `--ink` | Primary body copy and icons |
| `--color-text-secondary` | `oklch(0.43 0.025 80)` | Supporting labels, section chrome |
| `--color-text-muted` | `oklch(0.59 0.03 85)` via `--dim` | Hints, placeholders, de-emphasized meta |
| `--color-bg` | `oklch(0.945 0.02 90)` via `--paper` | App / page background |
| `--color-surface` | `oklch(0.977 0.01 90)` via `--panel` | Panels, cards, content wells |
| `--color-surface-raised` | same as surface (light); raised panel (dark) | Menus, popovers, elevated sheets |
| `--color-surface-muted` | `oklch(0.92 0.02 88)` | Recessed tracks, hover fills, segmented rails |
| `--color-border` | `oklch(0.86 0.03 85)` via `--line` | Default dividers and control outlines |
| `--color-border-subtle` | `oklch(0.9 0.025 87)` | Soft separation inside dense chrome |
| `--color-border-strong` | `oklch(0.78 0.035 82)` | Emphasized edges, inputs needing stronger enclosure |
| `--color-link` | `oklch(0.38 0.06 190)` via `--teal-deep` | Inline links and teal affordances |
| `--color-accent` | `oklch(0.69 0.15 65)` via `--amber` | Primary brand actions and highlights |
| `--color-accent-strong` | `oklch(0.55 0.13 65)` via `--amber-deep` | Pressed / stronger accent |
| `--color-accent-subtle` | `color-mix(… amber 14%, transparent)` | Accent wash / tinted fill |
| `--color-accent-foreground` | `oklch(0.18 0.006 70)` | Text/icons on accent fills (stays dark ink) |
| `--color-danger` | `oklch(0.55 0.18 28)` | Errors, destructive actions |
| `--color-danger-foreground` | `oklch(0.985 0.008 90)` | Text on danger fills (light theme) |
| `--color-success` | `oklch(0.47 0.07 190)` via `--teal` | Success / positive status |
| `--color-warning` | `oklch(0.55 0.13 65)` via `--amber-deep` | Warnings and caution |
| `--color-deck` | `oklch(0.18 0.006 70)` | Code/log/command surfaces (dark in both themes) |
| `--color-deck-foreground` | `oklch(0.945 0.02 90)` | Text on deck |
| `--color-scrim` | `oklch(0.18 0.006 70 / 0.45)` | Modal / overlay backdrop |
| `--color-focus-ring` | `transparent` | Intentionally empty — product: no focus rings |
| `--border-width-hairline` | `1px` | Default borders and rules |
| `--border-width-thick` | `2px` | Emphasized outlines |
| `--border-width-heavy` | `3px` | Rare high-emphasis edges |

## Light / dark

- ADE remaps Layer 1 workbench hues under `:root[data-theme="dark"]`; Layer 2 `--color-*` aliases follow automatically.
- Dark highlights: paper/panel shift to warm charcoal; amber/teal lighten; borders darken; `--color-deck` stays near-black for code.
- `--color-accent-foreground` remains dark ink in both themes (amber needs dark type on top).
- `--color-focus-ring` stays `transparent` in both themes.

## Do

- Prefer semantic roles (`--color-text-muted`, `--color-surface-muted`) over inventing new greys.
- Put interactive primary fills on `--color-accent` with `--color-accent-foreground`.
- Use `--color-deck` / `--color-deck-foreground` for code, logs, and terminal-like panes.

## Don't

- Don't use Layer 1 names (`--ink`, `--amber`, `--neutral-*`) in component CSS.
- Don't hard-code hex/oklch for UI chrome — theme flips will break.
- Don't draw custom focus outlines with `--color-focus-ring` expecting a visible ring (it resolves to nothing).
