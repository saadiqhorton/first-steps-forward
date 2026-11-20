# Button

## 1. Metadata
- **Name:** Button
- **Category:** Arc / action
- **Status:** active
- **Source:** `src/components/arc/button/button.tsx`, `src/components/arc/button/button.module.css`

## 2. Overview
- When to use: Primary actions, secondary chrome actions, ghost icon/text actions, and destructive confirms.
- When not to use: Navigation that should be a link; segmented exclusive choices (use SegmentedControl); theme toggle (use ThemeSwitch).

## 3. Anatomy
- Root `<motion.button>` with variant + size classes
- Optional centered loader (spinner) when `loading`
- Label slot with morphing width and crossfading label phase (text and/or icon children)

## 4. Tokens used
- `--control-height-sm|md|lg`, `--radius-control`, `--space-2|3|4|5`
- `--text-sm`, `--leading-body`
- `--duration-fast|instant`, `--ease-standard`
- `--shadow-resting`
- Colour (semantic `:root` names): `--foreground`, `--background`, `--surface`, `--surface-muted`, `--border`, `--text-secondary`, `--danger`, `--focus-ring`
- Disabled opacity uses `0.52` (matches `--opacity-disabled`)

## 5. Props/API
- Extends `ButtonHTMLAttributes<HTMLButtonElement>` (minus Motion drag/animation start clashes)
- `variant?: "primary" | "secondary" | "ghost" | "danger"` (default `"primary"`)
- `size?: "sm" | "md" | "lg"` (default `"md"`)
- `loading?: boolean` (default `false`) — sets `aria-busy`, keeps focusable, swallows click
- `disabled`, `className`, `children`, `ref` forwarded to button
- Popup anchors (`aria-haspopup`, `data-state`, `role="combobox"`) skip press scale

### Utility classes (`btn-amber`, `btn-quiet`)
Most ADE actions use these CSS utilities from `src/styles.css`, not Arc Button. There are no `@/components/arc/button` imports under `src/`.
- `btn-amber`: amber fill (`--accent`), dark ink label (`--accent-foreground`), `--radius-control`, hover `--opacity-hover`, press `scale(.97)`. Use for the one primary CTA per view and for composer send. 47 occurrences in `.tsx` files.
- `btn-quiet`: surface fill (`--surface`), inset hairline (`--shadow-inset-hairline`), hover `--surface-muted`. 92 occurrences in `.tsx` files.
- Common sizes: `px-3 py-1.5 text-xs` (28px) and `px-3 py-2 text-ui` (36px).

## 6. States
- default, hover (fine pointer), active/press (scale + color), focus-visible, disabled, loading (`aria-busy`)
- error: N/A

## 7. Code example
```tsx
import { Button } from "@/components/arc/button/button";

<Button variant="primary" size="md" onClick={save}>
  Save
</Button>

<Button variant="ghost" size="sm" loading={pending} aria-label="Retry">
  Retry
</Button>
```

## 8. Cross-references
- Related: ThemeSwitch (wraps Button), Dialog triggers, DropdownMenu triggers
- Foundations: `design/foundations/spacing.md`, `design/tokens/token-reference.md`
