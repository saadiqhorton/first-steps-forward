# Text Shimmer

## 1. Metadata
- **Name:** TextShimmer
- **Category:** Arc / feedback
- **Status:** active
- **Source:** `src/components/arc/text-shimmer/text-shimmer.tsx`, `src/components/arc/text-shimmer/text-shimmer.module.css`

## 2. Overview
- When to use: Short ongoing-status lines (“Working”, “Thinking”) with a calm highlight sweep.
- When not to use: Long body copy, static labels, or primary CTA text.

## 3. Anatomy
- Outer tag (`as`) with `data-state` and `aria-busy` when active
- Stage wrapper positioning the label
- Label span with label crossfade on children change; a masked highlight band swept by CSS transforms (compositor only: no per-frame JavaScript or repaint)

## 4. Tokens used
- `--ts-highlight` ← `--text-shimmer-highlight` or `currentColor`
- `--ts-base` ← `--text-shimmer-base` or mix of `currentColor` with `--text-muted`
- Motion durations/eases via Arc `motionTokens` (maps to `--duration-*`, `--ease-*`)

## 5. Props/API
- `children: string` (one short line)
- `active?: boolean` (default `true`)
- `duration?: number` seconds per sweep (default `1.8`)
- `as?: "span" | "p" | "div" | "h2" | "h3" | "h4"` (default `"span"`)
- `className?: string`, `id?: string`

## 6. States
- active (`data-state="active"`, `aria-busy`), idle (`data-state="idle"`)
- no sweep under reduced motion; browsers pause it off-screen and in hidden pages
- hover / disabled / error: N/A

## 7. Code example
```tsx
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";

<TextShimmer active={status === "working"}>Working</TextShimmer>
```

## 8. Cross-references
- Related: StatusPill, Shell busy indicators
- Foundations: `design/foundations/motion.md`
