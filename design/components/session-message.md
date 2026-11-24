# Session Message

## 1. Metadata
- **Name:** SessionMessage
- **Category:** ADE / content
- **Status:** active
- **Source:** `src/components/ade/SessionMessage.tsx`

## 2. Overview
- When to use: Render a single conversation message (user, agent, or system) with attachments and previewable links.
- When not to use: Live status chrome (use StatusPill) or the composer draft itself.

## 3. Anatomy
- Alignment wrapper (user end / agent start)
- Bubble: user muted surface, agent `card-panel`, system left-border notice
- Optional agent name label; context pills; markdown or pre for structured JSON
- Attachment chips / video players
- Collapsible long user prompt or structured agent dump

## 4. Tokens used
- `bg-surface-muted` / `--surface-muted`, `card-panel`, `border-line` / `--border`
- `text-ink` / `--foreground`, `text-dim` / `--text-muted`, `--text-secondary`
- Link focus teal; mono for structured blocks

## 5. Props/API
- `message: Message`
- `agentName?: string`
- `projectId?: string` (workspace file preview opens)
- `streaming?: boolean` (still being written: finished Markdown blocks are not parsed again)

## 6. States
- role variants: user / agent / system
- long user collapsed vs open; structured agent collapsed vs open
- hover on collapsible triggers; focus-visible on expand control
- disabled / error: N/A

## 7. Code example
```tsx
import { SessionMessage } from "@/components/ade/SessionMessage";

<SessionMessage message={message} agentName={agent?.name} projectId={projectId} />
```

## 8. Cross-references
- Related: Composer, ContextPills, Browser preview open helpers
