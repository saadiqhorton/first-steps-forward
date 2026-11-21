# Color

Semantic colour names for ADE UI. Components use these names directly — never raw hex/rgb/oklch, and never the Layer 1 workbench names (`--ink`, `--amber`, `--neutral-*`) when a semantic role exists.

Source: ADE `:root` in `src/styles.css` (overrides Arc `foundation.css`). `src/tokens.css` does not redefine colours. Tailwind utilities such as `bg-accent` resolve through the `@theme` block in `src/styles.css`, which uses some of the same names with different meanings. Prefer the `var(--name)` form in component CSS.

## Tokens

| Name | Resolves to (light) | When to use |
| --- | --- | --- |
| `--foreground` | `oklch(0.18 0.006 70)` via `--ink` | Primary body copy and icons |
| `--text-secondary` | `oklch(0.43 0.025 80)` | Supporting labels, section chrome |
| `--text-muted` | `oklch(0.51 0.03 85)` via `--dim` | Hints, placeholders, de-emphasized meta |
| `--background` | `oklch(0.945 0.02 90)` via `--paper` | App / page background |
| `--surface` | `oklch(0.977 0.01 90)` via `--panel` | Panels, cards, content wells |
| `--surface-raised` | same as surface (light); raised panel (dark) | Menus, popovers, elevated sheets |
| `--surface-muted` | `oklch(0.92 0.02 88)` | Recessed tracks, hover fills, segmented rails |
| `--border` | `oklch(0.86 0.03 85)` via `--line` | Default dividers and control outlines |
| `--border-subtle` | `oklch(0.9 0.025 87)` | Soft separation inside dense chrome |
| `--border-strong` | `oklch(0.78 0.035 82)` | Emphasized edges, inputs needing stronger enclosure |
| `--teal-deep` | `oklch(0.38 0.06 190)` | Inline links and teal affordances |
| `--accent` | `oklch(0.69 0.15 65)` via `--amber` | Primary brand actions and highlights |
| `--accent-strong` | `oklch(0.55 0.13 65)` via `--amber-deep` | Pressed / stronger accent |
| `--accent-subtle` | `color-mix(… amber 14%, transparent)` | Accent wash / tinted fill |
| `--accent-foreground` | `oklch(0.18 0.006 70)` | Text/icons on accent fills (stays dark ink) |
| `--danger` | `oklch(0.55 0.18 28)` | Errors, destructive actions |
| `--danger-foreground` | `oklch(0.985 0.008 90)` | Text on danger fills (light theme) |
| `--success` | `oklch(0.47 0.07 190)` via `--teal` | Success / positive status |
| `--warning` | `oklch(0.55 0.13 65)` via `--amber-deep` | Warnings and caution |
| `--deck` | `oklch(0.18 0.006 70)` | Code/log/command surfaces (dark in both themes) |
| `--deck-foreground` | `oklch(0.945 0.02 90)` | Text on deck |
| `--scrim` | `oklch(0.18 0.006 70 / 0.45)` | Modal / overlay backdrop |
| `--focus-ring` | `transparent` (Arc `foundation.css`) | No visible outline from rules that use this token |
| `--border-width-hairline` | `1px` | Default borders and rules |
| `--border-width-thick` | `2px` | Emphasized outlines |
| `--border-width-heavy` | `3px` | Rare high-emphasis edges |

`--text-muted` light was darkened from `oklch(0.59 0.03 85)` to `oklch(0.51 0.03 85)` so muted text meets 4.5:1 on paper, panel and surface-muted (WCAG AA).

## Light / dark

- ADE remaps Layer 1 workbench hues under `:root[data-theme="dark"]`; the semantic names above follow automatically.
- Dark highlights: paper/panel shift to warm charcoal; amber/teal lighten; borders darken; `--deck` stays near-black for code.
- `--accent-foreground` remains dark ink in both themes (amber needs dark type on top).
- `--focus-ring` stays `transparent` in both themes. Components that use Tailwind ring utilities with a separate color (for example `ring-amber/35`) can still draw a visible ring.

## Do

- Prefer semantic roles (`--text-muted`, `--surface-muted`) over inventing new greys.
- Put interactive primary fills on `--accent` with `--accent-foreground`.
- Use `--deck` / `--deck-foreground` for code, logs, and terminal-like panes.

## Don't

- Don't use Layer 1 names (`--ink`, `--amber`, `--neutral-*`) in component CSS when a semantic name exists.
- Don't hard-code hex/oklch for UI chrome — theme flips will break.
- Don't draw custom focus outlines with `--focus-ring` expecting a visible ring (it resolves to nothing). Use an explicit semantic color where a component needs a visible ring.
