# Status Pill

## 1. Metadata
- **Name:** StatusPill
- **Category:** ADE / feedback
- **Status:** active
- **Source:** `src/components/ade/StatusPill.tsx`

## 2. Overview
- When to use: Compact session status with color dot and optional shimmer on active work.
- When not to use: Form validation messages or generic badges without session semantics.

## 3. Anatomy
- `role="status"` row
- Colored dot (optionally `animate-pulse-soft`)
- `TextShimmer` label mapped from status

## 4. Tokens used
- Semantic utilities: teal / teal-deep / amber-deep / danger / dim
- Type: `text-xs` or `13px` for `md`
- Shimmer inherits text color (see TextShimmer)

## 5. Props/API
- `status: SessionStatus` — `working | verifying | ready | complete | stopped | blocked`
- `size?: "sm" | "md"` (default `"sm"`)
- `needsYou?: boolean` — when `working`, shows “Needs you” (amber) instead of “Working”

## 6. States
- Per-status label/color; pulsing shimmer for working/verifying
- needsYou override
- hover / disabled / error: N/A

## 7. Code example
```tsx
import { StatusPill } from "@/components/ade/StatusPill";

<StatusPill status={session.status} needsYou={needsYou(session)} />
```

## 8. Cross-references
- Related: TextShimmer, ConversationList
