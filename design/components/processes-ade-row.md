# Processes Ade Row

## 1. Metadata
- **Name:** AdeRow
- **Category:** ADE / processes
- **Status:** active
- **Source:** `src/components/ade/processes/AdeRow.tsx`; related keycap chrome in `src/components/ade/processes/processes.css`

## 2. Overview
- When to use: Read-only process list row for this ADE window or another loopback ADE; opens address in browser preview when available.
- When not to use: Editable process controls or generic list rows outside Processes pane.

## 3. Anatomy
- Full-width button row
- Teal status dot
- Name + mono address/note line
- External-link icon
- Sibling chrome: `.process-key` in `processes.css` (raised keycap for inline process chips elsewhere in Processes UI)

## 4. Tokens used
- AdeRow: Tailwind `text-dim` / `--color-text-muted`, teal dot, hover `bg-ink/[0.03]`
- `.process-key`: `--panel` / `--color-surface`, `--line` / `--color-border`, `--ink` mixes; prefers `--shadow-process-key*` Layer 2 aliases when migrating styles

## 5. Props/API
- `name: string`
- `note: string`
- `address: string | null` — when null, button is disabled and label notes unavailable address

## 6. States
- default, hover (when enabled), disabled (`!address`)
- focus: native button focus
- active / error: N/A
- `.process-key`: hover raise, active press, disabled shadow flatten; dark theme overrides

## 7. Code example
```tsx
import { AdeRow } from "@/components/ade/processes/AdeRow";

<AdeRow name="This ADE" note="this window" address={window.location.origin} />
```

## 8. Cross-references
- Related: ProcessesPane, BrowserChrome (preview open)
