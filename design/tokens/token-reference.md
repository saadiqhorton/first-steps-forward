# Token reference (Layer 2)

Exhaustive list of tokens agents may use in component CSS.

- **Canonical Layer 2:** defined in `src/tokens.css` (every custom property there is listed below).
- **Layer 2 by convention:** Arc/ADE tokens (`--space-*`, `--text-*`, `--radius-*`, `--shadow-resting|raised|floating`, `--duration-*`, `--ease-*`, `--leading-*`, `--tracking-*`, `--control-height-*`, `--font-display|--font-body|--font-mono`) that components may reference even though they are declared in `foundation.css` / ADE `:root`.
- **Semantic color vocabulary (Layer 2 by convention):** existing ADE/Arc names (`--foreground`, `--background`, `--border`, `--border-subtle`, `--border-strong`, `--text-muted`, `--text-secondary`, `--surface`, `--surface-raised`, `--surface-muted`, `--ink`, `--paper`, `--panel`, `--line`, `--dim`, `--danger`, `--danger-foreground`, `--accent`, `--accent-strong`, `--accent-subtle`, `--accent-foreground`, `--success`, `--warning`, `--deck`, `--deck-foreground`, `--scrim`, `--focus-ring`, `--teal`, `--teal-deep`, `--amber`, `--amber-deep`, etc.) sit alongside `--color-*` aliases. Components may use either form; never raw hex/rgb/oklch literals.

Values below are **ADE-effective** (after `src/styles.css` overrides) unless noted. Dark values shown when they differ.

---

## Color (`src/tokens.css` → ADE `:root`)

| Token | Value / source | Usage |
| --- | --- | --- |
| `--color-text` | light `oklch(0.18 0.006 70)`; dark `oklch(0.95 0.012 90)` via --foreground | Primary text |
| `--color-text-secondary` | light `oklch(0.43 0.025 80)`; dark `oklch(0.78 0.016 85)` | Secondary labels |
| `--color-text-muted` | light `oklch(0.59 0.03 85)`; dark `oklch(0.65 0.022 85)` via --dim | Muted / hint text |
| `--color-bg` | light `oklch(0.945 0.02 90)`; dark `oklch(0.19 0.006 75)` via --paper | Page background |
| `--color-surface` | light `oklch(0.977 0.01 90)`; dark `oklch(0.215 0.007 75)` via --panel | Panel surface |
| `--color-surface-raised` | light same as surface; dark `oklch(0.24 0.008 75)` | Raised surface / popover |
| `--color-surface-muted` | light `oklch(0.92 0.02 88)`; dark `oklch(0.26 0.009 75)` | Recessed / muted fill |
| `--color-border` | light `oklch(0.86 0.03 85)`; dark `oklch(0.3 0.012 80)` via --line | Default border |
| `--color-border-subtle` | light `oklch(0.9 0.025 87)`; dark `oklch(0.255 0.01 80)` | Subtle border |
| `--color-border-strong` | light `oklch(0.78 0.035 82)`; dark `oklch(0.4 0.015 80)` | Strong border |
| `--color-link` | light `oklch(0.38 0.06 190)`; dark `oklch(0.84 0.07 185)` via --teal-deep | Links |
| `--color-accent` | light `oklch(0.69 0.15 65)`; dark `oklch(0.77 0.15 70)` via --amber | Brand accent |
| `--color-accent-strong` | light `oklch(0.55 0.13 65)`; dark `oklch(0.85 0.11 78)` via --amber-deep | Strong accent |
| `--color-accent-subtle` | light `color-mix(… amber 14%)`; dark `color-mix(… amber 18%)` | Accent wash |
| `--color-accent-foreground` | `oklch(0.18 0.006 70)` (both themes) | Text on accent |
| `--color-danger` | light `oklch(0.55 0.18 28)`; dark `oklch(0.72 0.17 28)` | Danger |
| `--color-danger-foreground` | light `oklch(0.985 0.008 90)`; dark `oklch(0.18 0.006 70)` | Text on danger |
| `--color-success` | light `oklch(0.47 0.07 190)`; dark `oklch(0.75 0.09 185)` via --teal | Success |
| `--color-warning` | light `oklch(0.55 0.13 65)`; dark `oklch(0.85 0.11 78)` via --amber-deep | Warning |
| `--color-deck` | light `oklch(0.18 0.006 70)`; dark `oklch(0.155 0.005 75)` | Code/log deck |
| `--color-deck-foreground` | light `oklch(0.945 0.02 90)`; dark `oklch(0.93 0.014 90)` | Text on deck |
| `--color-scrim` | light `oklch(0.18 0.006 70 / 0.45)`; dark `oklch(0.1 0.004 75 / 0.6)` | Overlay scrim |
| `--color-focus-ring` | `transparent` | Focus ring (intentionally empty) |

---

## Typography

| Token | Value / source | Usage |
| --- | --- | --- |
| `--font-family-display` | `var(--font-display, "Geist", sans-serif)` | Display family alias |
| `--font-family-body` | `var(--font-body, "Inter", sans-serif)` | Body family alias |
| `--font-family-mono` | `var(--font-mono, "IBM Plex Mono", monospace)` | Mono family alias |
| `--font-display` | `"Geist", …` via --font-geist (Arc/ADE) | Display family |
| `--font-body` | `"Inter", …` via --font-inter (Arc/ADE) | Body family |
| `--font-mono` | `"IBM Plex Mono", ui-monospace, monospace` (ADE `@theme`) | Mono family |
| `--font-weight-regular` | `400` | Regular weight |
| `--font-weight-medium` | `500` | Medium weight |
| `--font-weight-semibold` | `600` | Semibold weight |
| `--text-3xs` | `9px` | Workshop mono / chrome below xs |
| `--text-2xs` | `10px` | Workshop mono / chrome below xs |
| `--text-xs` | `0.75rem` | Extra-small type |
| `--text-sm` | `0.875rem` | Small / default UI |
| `--text-base` | `1rem` | Base body |
| `--text-lg` | `1.125rem` | Large body |
| `--text-xl` | `1.375rem` | XL heading |
| `--text-2xl` | `1.75rem` | 2XL heading |
| `--text-3xl` | `2.25rem` | 3XL heading |
| `--text-4xl` | `3.25rem` | 4XL display |
| `--text-5xl` | `4.5rem` | 5XL display |
| `--text-editor` | `11px` | Host-editor / mono chrome size |
| `--text-workshop-h2` | `32px` | Workshop option heading clamp max |
| `--text-markdown-h1` | `1.25em` | Markdown relative h1 |
| `--text-markdown-h2` | `1.12em` | Markdown relative h2 |
| `--text-composer-13` | `13px` | Composer-reference workshop type |
| `--text-composer-15` | `15px` | Composer-reference workshop type |
| `--text-composer-20` | `20px` | Composer-reference workshop type |
| `--text-composer-25` | `25px` | Composer-reference workshop type |
| `--text-composer-42` | `42px` | Composer-reference workshop type |
| `--text-composer-50` | `50px` | Composer-reference workshop type |
| `--leading-display` | `1.1` | Display line-height |
| `--leading-body` | `1.4` | Body line-height |
| `--tracking-display` | `-0.03em` | Display tracking |
| `--tracking-body` | `0` (ADE override; Arc was `-0.01em`) | Body tracking |

---

## Spacing & sizing

| Token | Value / source | Usage |
| --- | --- | --- |
| `--space-0` | `0` | Zero spacing (markdown / compact) |
| `--space-1` | `0.25rem` | 4px gap |
| `--space-2` | `0.5rem` | 8px gap |
| `--space-3` | `0.75rem` | 12px gap |
| `--space-4` | `1rem` | 16px gap |
| `--space-5` | `1.25rem` | 20px gap |
| `--space-6` | `1.5rem` | 24px gap |
| `--space-8` | `2rem` | 32px gap |
| `--space-10` | `2.5rem` | 40px gap |
| `--space-12` | `3rem` | 48px gap |
| `--space-16` | `4rem` | 64px gap |
| `--space-20` | `5rem` | 80px gap |
| `--space-24` | `6rem` | 96px gap |
| `--space-code-pad-y` | `0.1em` | Inline code pad Y |
| `--space-code-pad-x` | `0.25em` | Inline code pad X |
| `--space-segment-track` | `3px` | Segmented control track pad |
| `--space-segment-gap` | `2px` | Segmented control gap |
| `--space-segment-label-gap` | `6px` | Segmented label gap |
| `--space-segment-pad-x` | `13px` | Segmented item pad X |
| `--space-segment-pad-x-sm` | `10px` | Segmented item pad X (sm) |
| `--space-focus-offset` | `3px` | Arc focus ring offset |
| `--control-height-sm` | `2.25rem` | Compact control height |
| `--control-height-md` | `2.75rem` | Default control height |
| `--control-height-lg` | `3.125rem` | Large control height |
| `--size-hit-seam` | `18px` | Panel seam hit size |
| `--size-hit-collapse` | `20px` | Collapse hit size |
| `--size-theme-switch` | `38px` | Theme-switch icon-only control |
| `--size-icon-md` | `20px` | Medium icon size |
| `--size-icon-sm` | `18px` | Small icon size |

---

## Radius

| Token | Value / source | Usage |
| --- | --- | --- |
| `--radius-control` | `0.625rem` (ADE; Arc `1.125rem`) | Controls |
| `--radius-panel` | `1rem` (ADE; Arc `1.625rem`) | Panels |
| `--radius-surface` | `1.25rem` (ADE; Arc `2.125rem`) | Large surfaces |
| `--radius-pill` | `9999px` | Pill / capsule |
| `--radius-xs` | `0.375rem` (`@theme` bridge / tokens.css) | Tiny radius utility |
| `--radius-sm` | `0.5rem` (`@theme` bridge / tokens.css) | Small radius utility |
| `--radius-md` | `0.75rem` (`@theme` bridge / tokens.css) | Medium radius utility |
| `--radius-lg` | `1rem` in tokens.css; `@theme` → `--radius-control` | Large / → control |
| `--radius-xl` | `var(--radius-panel)` | → panel |
| `--radius-2xl` | `var(--radius-surface)` | → surface |
| `--radius-segment` | `calc(var(--radius-control) - 3px)` | Segmented control item |

---

## Elevation & stacking

| Token | Value / source | Usage |
| --- | --- | --- |
| `--shadow-resting` | light `0 1px 2px oklch(0% 0 0 / .035)`; dark `… / .18` | Resting elevation |
| `--shadow-raised` | light `0 6px 18px … / .065, 0 1px 3px … / .035`; dark `0 8px 22px … / .22` | Raised elevation |
| `--shadow-floating` | light `0 20px 48px … / .105, 0 3px 10px … / .045`; dark `0 22px 55px … / .34` | Floating elevation |
| `--shadow-process-key` | ADE keycap stack (see `tokens.css`; dark override) | Process-key default |
| `--shadow-process-key-hover` | Hover keycap stack | Process-key hover |
| `--shadow-process-key-active` | Pressed keycap stack | Process-key active |
| `--shadow-process-key-disabled` | Muted inset only | Process-key disabled |
| `--shadow-inset-hairline` | `inset 0 0 0 1px var(--border)` | Quiet inset border (btn-quiet) |
| `--z-recessed` | `-1` | Behind parent |
| `--z-base` | `0` | Base stack |
| `--z-raised` | `1` | Raised stack |
| `--z-dropdown` | `50` | Dropdown |
| `--z-sticky` | `100` | Sticky |
| `--z-overlay` | `200` | Overlay |
| `--z-modal` | `300` | Modal |
| `--z-toast` | `400` | Toast |
| `--z-veil` | `2147483647` | Veil |

---

## Motion & opacity

| Token | Value / source | Usage |
| --- | --- | --- |
| `--duration-instant` | `120ms` | Instant |
| `--duration-fast` | `160ms` | Fast chrome |
| `--duration-standard` | `240ms` | Standard layout |
| `--duration-considered` | `480ms` | Enter / considered |
| `--duration-spring` | `580ms` | Spring transform |
| `--ease-enter` | `cubic-bezier(.16,1,.3,1)` | Enter ease |
| `--ease-standard` | `cubic-bezier(.22,1,.36,1)` | Standard ease |
| `--ease-exit` | `cubic-bezier(.7,0,.84,0)` | Exit ease |
| `--ease-in-out` | `cubic-bezier(.65,0,.35,1)` | In-out ease |
| `--ease-spring` | `linear(…)` settle curve | Spring ease |
| `--duration-spin` | `0.7s` | Spinner rotation period |
| `--opacity-disabled` | `0.52` | Disabled opacity |
| `--opacity-hover` | `0.91` | Hover opacity |
| `--opacity-pressed` | `0.84` | Pressed opacity |
| `--opacity-muted` | `0.3` | Muted opacity |
| `--opacity-host-idle` | `0.45` | Host-editor idle chrome |
| `--opacity-host-search-icon` | `0.65` | Host-editor search icon |
| `--opacity-host-placeholder` | `0.55` | Host-editor placeholder |

---

## Border widths

| Token | Value / source | Usage |
| --- | --- | --- |
| `--border-width-hairline` | `1px` | Default border |
| `--border-width-spinner` | `1.5px` | Spinner stroke |
| `--border-width-thick` | `2px` | Thick border |
| `--border-width-heavy` | `3px` | Heavy border |
| `--border-width-rail` | `4px` | Workshop rail / pane seam |

---

## Exact / workshop one-offs

Preserved prior px/em values for workshops and harness chrome. Prefer scale tokens (`--space-*`, `--text-*`, `--radius-*`) in product UI; use these only where the exact prior measure is intentional.

| Token | Value | Usage |
| --- | --- | --- |
| `--space-px-5` | `5px` | Workshop / harness micro spacing |
| `--space-px-7` | `7px` | Workshop / harness micro spacing |
| `--space-px-9` | `9px` | Workshop / harness micro spacing |
| `--space-px-11` | `11px` | Workshop / harness micro spacing |
| `--space-px-14` | `14px` | Workshop / harness micro spacing |
| `--space-px-15` | `15px` | Workshop / harness micro spacing |
| `--space-px-18` | `18px` | Workshop / harness micro spacing |
| `--space-px-22` | `22px` | Workshop / harness micro spacing |
| `--space-px-25` | `25px` | Workshop / harness micro spacing |
| `--space-px-26` | `26px` | Workshop / harness micro spacing |
| `--space-px-27` | `27px` | Workshop / harness micro spacing |
| `--space-px-28` | `28px` | Workshop / harness micro spacing |
| `--space-px-30` | `30px` | Workshop / harness micro spacing |
| `--space-px-45` | `45px` | Workshop / harness micro spacing |
| `--space-px-50` | `50px` | Workshop / harness micro spacing |
| `--space-px-60` | `60px` | Workshop / harness micro spacing |
| `--space-px-65` | `65px` | Workshop / harness micro spacing |
| `--space-px-80` | `80px` | Workshop / harness micro spacing |
| `--space-picker-claude` | `67px` | Agent picker Claude width |
| `--space-picker-codex` | `96px` | Agent picker Codex width |
| `--radius-composer-4` | `4px` | Composer-reference workshop radius |
| `--radius-composer-7` | `7px` | Composer-reference workshop radius |
| `--radius-composer-9` | `9px` | Composer-reference workshop radius |
| `--radius-composer-14` | `14px` | Composer-reference workshop radius |
| `--radius-bubble-tail` | `2px` | Speech-bubble tail corner |
| `--color-terminal-track` | `#171715` | Terminal scrollbar track |
| `--color-terminal-thumb` | `#5a8179` | Terminal scrollbar thumb |
| `--color-terminal-thumb-hover` | `#8dc4b7` | Terminal scrollbar thumb hover |
| `--color-diff-add` | `oklch(0.77 0.08 180)` | Diff add (workshop) |
| `--color-diff-del` | `oklch(0.73 0.15 29)` | Diff delete (workshop) |
| `--color-terminal-bg` | `#1d2928` | Terminal mock background |
| `--color-terminal-fg` | `oklch(0.93 0.014 90)` | Terminal mock foreground |
| `--color-terminal-prompt` | `#e1ad61` | Terminal prompt accent |
| `--color-screen-bg` | `#080909` | Computer screen background |
| `--color-desktop-from` | `#24302e` | Desktop gradient start |
| `--color-desktop-to` | `#121615` | Desktop gradient end |
| `--color-desktop-window` | `#f4efe2` | Desktop window fill |
| `--color-desktop-titlebar` | `#ddd5c3` | Desktop titlebar |
| `--color-desktop-dock` | `rgb(255 255 255 / 0.14)` | Desktop dock glass |
| `--shadow-desktop-window` | `0 8px 30px rgb(0 0 0 / 0.45)` | Desktop window elevation |
| `--shadow-desktop-note` | `0 2px 6px rgb(0 0 0 / 0.18)` | Desktop sticky note |
| `--shadow-workshop-chip` | inset + drop (see `tokens.css`) | Process-chip default |
| `--shadow-workshop-chip-hover` | inset + drop (see `tokens.css`) | Process-chip hover |
| `--shadow-workshop-chip-active` | inset only (see `tokens.css`) | Process-chip active |

---

## Foundations map

| Topic | Doc |
| --- | --- |
| Color | [../foundations/color.md](../foundations/color.md) |
| Spacing | [../foundations/spacing.md](../foundations/spacing.md) |
| Typography | [../foundations/typography.md](../foundations/typography.md) |
| Radius | [../foundations/radius.md](../foundations/radius.md) |
| Elevation | [../foundations/elevation.md](../foundations/elevation.md) |
| Motion | [../foundations/motion.md](../foundations/motion.md) |
