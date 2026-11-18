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
- Color (CSS aliases → Layer 2): `--foreground` / `--color-text`, `--background` / `--color-bg`, `--surface` / `--color-surface`, `--surface-muted` / `--color-surface-muted`, `--border` / `--color-border`, `--text-secondary` / `--color-text-secondary`, `--danger` / `--color-danger`, `--focus-ring` / `--color-focus-ring`
- Disabled opacity uses `0.52` (matches `--opacity-disabled`)

## 5. Props/API
- Extends `ButtonHTMLAttributes<HTMLButtonElement>` (minus Motion drag/animation start clashes)
- `variant?: "primary" | "secondary" | "ghost" | "danger"` (default `"primary"`)
- `size?: "sm" | "md" | "lg"` (default `"md"`)
- `loading?: boolean` (default `false`) — sets `aria-busy`, keeps focusable, swallows click
- `disabled`, `className`, `children`, `ref` forwarded to button
- Popup anchors (`aria-haspopup`, `data-state`, `role="combobox"`) skip press scale

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
