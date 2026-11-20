# Token reference (Layer 2)

Exhaustive list of tokens agents may use in component CSS.

- **Canonical Layer 2:** defined in `src/tokens.css` (every custom property there is listed below).
- **Layer 2 by convention:** Arc/ADE tokens (`--space-*`, `--text-*`, `--radius-*`, `--shadow-resting|raised|floating`, `--duration-*`, `--ease-*`, `--leading-*`, `--tracking-*`, `--control-height-*`, `--font-display|--font-body|--font-mono`) that components may reference even though they are declared in `foundation.css` / ADE `:root`.
- **Semantic color vocabulary (Layer 2 by convention):** existing ADE/Arc names (`--foreground`, `--background`, `--border`, `--border-subtle`, `--border-strong`, `--text-muted`, `--text-secondary`, `--surface`, `--surface-raised`, `--surface-muted`, `--ink`, `--paper`, `--panel`, `--line`, `--dim`, `--danger`, `--danger-foreground`, `--accent`, `--accent-strong`, `--accent-subtle`, `--accent-foreground`, `--success`, `--warning`, `--deck`, `--deck-foreground`, `--scrim`, `--focus-ring`, `--teal`, `--teal-deep`, `--amber`, `--amber-deep`, etc.) are the colour tokens. Components use them directly; never raw hex/rgb/oklch literals.

Values below are **ADE-effective** (after `src/styles.css` overrides) unless noted. Dark values shown when they differ.

---

## Color

Colours are not declared in `src/tokens.css`. Use the semantic names on `:root` in `src/styles.css` (`--foreground`, `--background`, `--surface`, `--surface-muted`, `--border`, `--text-muted`, `--text-secondary`, `--accent`, `--accent-strong`, `--accent-foreground`, `--danger`, `--success`, `--warning`, `--deck`, `--scrim`, and the rest). Light and dark values, and when to use each, are in [../foundations/color.md](../foundations/color.md). Workshop and terminal colour one-offs are listed under "Exact / workshop one-offs".

---

## Typography

| Token | Value / source | Usage |
| --- | --- | --- |
| `--font-family-mono` | `var(--font-mono, "IBM Plex Mono", monospace)` | Mono family alias |
| `--font-display` | `"Geist", …` via --font-geist (Arc/ADE) | Display family |
| `--font-body` | `"Inter", …` via --font-inter (Arc/ADE) | Body family |
| `--font-mono` | `"IBM Plex Mono", ui-monospace, monospace` (ADE `@theme`) | Mono family |
| `--font-weight-regular` | `400` | Regular weight |
| `--font-weight-medium` | `500` | Medium weight |
| `--font-weight-semibold` | `600` | Semibold weight |
| `--text-3xs` / `text-3xs` | `9px` | Tiny mono / workshop chrome (Tailwind utility: font-size only) |
| `--text-2xs` / `text-2xs` | `10px` | Dense mono labels (utility: font-size only) |
| `text-caption` | `11px` | Captions, host-editor chrome (utility: font-size only) |
| `text-ui` | `13px` | Workbench UI between xs and sm (utility: font-size only) |
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
| `--text-workspace-10` | `10px` | Workspace chrome type |
| `--text-workspace-11` | `11px` | Workspace chrome type |
| `--text-workspace-13` | `13px` | Workspace chrome type |
| `--text-workspace-20` | `20px` | Workspace chrome type |
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
| `--size-workspace-avatar` | `32px` | Workspace avatar |

---

## Radius

| Token | Value / source | Usage |
| --- | --- | --- |
| `--radius-control` | `0.625rem` (ADE; Arc `1.125rem`) | Controls |
| `--radius-panel` | `1rem` (ADE; Arc `1.625rem`) | Panels |
| `--radius-surface` | `1.25rem` (ADE; Arc `2.125rem`) | Large surfaces |
| `--radius-pill` | `9999px` | Pill / capsule |
| `--radius-xs` | `0.375rem` (6px); `rounded-xs` | Tiny corners |
| `--radius-sm` | `0.5rem` (8px); `rounded-sm` | Small corners |
| `rounded-md` | `var(--radius-control)` (10px) | Control radius (`@theme`) |
| `--radius-lg` | `0.75rem` (12px); `rounded-lg` | Medium-large corners |
| `--radius-xl` | `1rem` (16px); `rounded-xl` → `var(--radius-panel)` | Panel-sized corners |
| `rounded-2xl` | `var(--radius-surface)` (20px) | Surface radius (`@theme`) |
| `--radius-segment` | `calc(var(--radius-control) - 3px)` | Segmented control item |
| `--radius-workspace-4` | `4px` | Workspace radius |
| `--radius-workspace-6` | `6px` | Workspace radius (top-bar links) |
| `--radius-workspace-8` | `8px` | Workspace radius |
| `--radius-workspace-10` | `10px` | Workspace radius |

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
| `--shadow-workspace-menu` | `0 8px 24px rgba(0, 0, 0, 0.12)` | Workspace menu elevation |
| `--z-recessed` | `-1` | Behind parent |
| `--z-raised` | `1` | Raised stack |
| `--z-dropdown` | `50` | Dropdown |
| `--z-veil` | `2147483647` | Veil |
| `--z-workspace-menu` | `5` | Workspace menu |

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
| `--opacity-host-idle` | `0.45` | Host-editor idle chrome |
| `--opacity-host-search-icon` | `0.65` | Host-editor search icon |
| `--opacity-host-placeholder` | `0.55` | Host-editor placeholder |
| `--opacity-workspace-pulse` | `0.35` | Workspace pulse opacity |

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

## Pixel spacing (`--space-px-*`)

Defined in `src/tokens.css`. Exact prior px values for workshop and harness chrome; prefer `--space-*` scale tokens in product UI.

| Token | Value |
| --- | --- |
| `--space-px-2` | `2px` |
| `--space-px-5` | `5px` |
| `--space-px-7` | `7px` |
| `--space-px-9` | `9px` |
| `--space-px-10` | `10px` |
| `--space-px-11` | `11px` |
| `--space-px-14` | `14px` |
| `--space-px-15` | `15px` |
| `--space-px-18` | `18px` |
| `--space-px-20` | `20px` |
| `--space-px-22` | `22px` |
| `--space-px-25` | `25px` |
| `--space-px-26` | `26px` |
| `--space-px-27` | `27px` |
| `--space-px-28` | `28px` |
| `--space-px-30` | `30px` |
| `--space-px-45` | `45px` |
| `--space-px-50` | `50px` |
| `--space-px-60` | `60px` |
| `--space-px-65` | `65px` |
| `--space-px-80` | `80px` |

---

## Exact / workshop one-offs

Preserved prior px/em values for workshops and harness chrome. Prefer scale tokens (`--space-*`, `--text-*`, `--radius-*`) in product UI; use these only where the exact prior measure is intentional.

| Token | Value | Usage |
| --- | --- | --- |
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

## Doop canvas names

The Doop canvas "ADE Design System" uses Tailwind-namespace names, so its frames resolve like the app's `@theme` names. Values match `src/styles.css`; only the names differ from the Layer 2 names above.

| Doop canvas token | Code name (`@theme`) | Layer 2 variable |
| --- | --- | --- |
| `--color-ink` | `--color-ink` | `--ink` / `--foreground` |
| `--color-paper` | `--color-paper` | `--paper` / `--background` |
| `--color-panel` | `--color-panel` | `--panel` / `--surface` |
| `--color-line` | `--color-line` | `--line` / `--border` |
| `--color-dim` | `--color-dim` | `--dim` / `--text-muted` |
| `--color-amber` / `--color-amber-deep` | `--color-amber` / `--color-amber-deep` | `--accent` / `--accent-strong` |
| `--color-primary-foreground` | `--color-primary-foreground` | `--accent-foreground` |
| `--color-teal` / `--color-teal-deep` | `--color-teal` / `--color-teal-deep` | `--success` / `--teal-deep` |
| `--color-destructive-foreground` | `--color-destructive-foreground` | `--danger-foreground` |

- Code's `--color-accent` is the shadcn hover fill (`--surface-muted`), not amber, so the canvas does not use that name for amber.
- Spacing: the canvas `--spacing-N` matches `--space-N` in value (for example `--spacing-4` = `--space-4` = 1rem).
- Radius, type, leading, tracking and font names are the same on the canvas as in code.
- The canvas `--color-focus-ring` has an amber value, but `--focus-ring` is `transparent` in code. Do not treat the canvas value as a real focus ring.

## Foundations map

| Topic | Doc |
| --- | --- |
| Color | [../foundations/color.md](../foundations/color.md) |
| Spacing | [../foundations/spacing.md](../foundations/spacing.md) |
| Typography | [../foundations/typography.md](../foundations/typography.md) |
| Radius | [../foundations/radius.md](../foundations/radius.md) |
| Elevation | [../foundations/elevation.md](../foundations/elevation.md) |
| Motion | [../foundations/motion.md](../foundations/motion.md) |
