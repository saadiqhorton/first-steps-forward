# Conversation List

## 1. Metadata
- **Name:** ConversationList
- **Category:** ADE / navigation
- **Status:** active
- **Source:** `src/components/ade/ConversationList.tsx`

## 2. Overview
- When to use: Project conversations sidebar — search, filter, select session, show completed toggle.
- When not to use: Global project switcher (TopBar) or message timeline (SessionView).

## 3. Anatomy
- Header + new conversation link
- Search input
- SegmentedControl filters (All / Needs you / Working / Unread) with count accessories
- Scrollable session links (title, agent · date, StatusPill, elapsed, unread dot)
- Footer count + “Show completed” checkbox

## 4. Tokens used
- `bg-panel` / `--surface`, `bg-paper` / `--background`, `border-line` / `--border`
- `text-ink` / `--foreground`, `text-dim` / `--text-muted`
- Active row: `bg-surface-muted` + GlideIndicator; unread amber; working elapsed teal
- SegmentedControl call-site overrides for compact filter chrome

## 5. Props/API
- No props — reads route params/search and ADE store (`useAdeState`, `useViewed`, search query)

## 6. States
- filter selection, search empty vs results, active session highlight, unread
- working/verifying elapsed timer; empty list message
- checkbox show completed; hover on rows / icon button
- disabled / error: N/A (search query may be loading via react-query)

## 7. Code example
```tsx
import { ConversationList } from "@/components/ade/ConversationList";

// Routed under /p/$projectId/conversations
<ConversationList />
```

## 8. Cross-references
- Related: SegmentedControl, StatusPill, Shell
