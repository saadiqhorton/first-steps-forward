# Segmented Control

## 1. Metadata
- **Name:** SegmentedControl
- **Category:** Arc / selection
- **Status:** active
- **Source:** `src/components/arc/segmented-control/segmented-control.tsx`, `src/components/arc/segmented-control/segmented-control.module.css`

## 2. Overview
- When to use: Mutually exclusive options in a compact track (filters, view modes).
- When not to use: Independent toggles; hierarchical navigation; long lists better served by Tabs or a menu.

## 3. Anatomy
- Root `role="group"` with optional `aria-label`
- Horizontally scrollable track with edge fade masks
- Option buttons (`aria-pressed`) with label + optional accessory
- Sliding selection highlight (`layoutId="selection"`)

## 4. Tokens used
- `--border`, `--surface-muted`, `--surface`
- `--text-muted`, `--foreground`
- `--radius-control`, `--control-height-sm`, `--text-sm`
- `--shadow-resting`, `--duration-fast`, `--ease-standard`, `--focus-ring`

## 5. Props/API
- `options: Segment[]` where `Segment = { value: string; label: string; accessory?: ReactNode }`
- `value: string`
- `onValueChange: (value: string) => void`
- `label?: string` (group accessible name)
- `onOptionIntent?: (value: string) => void` (pointer enter / focus prefetch)
- `className?: string`

## 6. States
- default, hover (option label), active/pressed (selected), focus-visible (roving tabindex on selected)
- dragging track (overflow), fade-start / fade-end
- disabled: N/A (no disabled prop)
- error: N/A

## 7. Code example
```tsx
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";

<SegmentedControl
  label="Filters"
  value={filter}
  onValueChange={setFilter}
  options={[
    { value: "all", label: "All" },
    { value: "working", label: "Working", accessory: <span>3</span> },
  ]}
/>
```

## 8. Cross-references
- Related: ConversationList filters, Tabs (Radix) for content panes
- Foundations: `design/foundations/motion.md`
