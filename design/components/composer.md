# Composer

## 1. Metadata
- **Name:** Composer
- **Category:** ADE / input
- **Status:** active
- **Source:** `src/components/ade/Composer.tsx` (+ attachments/suggestions siblings)

## 2. Overview
- When to use: New task or follow-up message input with agent picker, context refs, attachments, and send.
- When not to use: Plain search fields or settings forms.

## 3. Anatomy
- `card-panel` container with optional `extra` header slot
- Context pills row; autosizing textarea
- Attachment strip + drag overlay (`ComposerAttachments`)
- Suggestions popover (`/` workflows-skills, `@` files)
- Footer: agent chip (opens `AgentPicker`), branch label, tool buttons, send / send-later / send-now
- Optional error alert strip

## 4. Tokens used
- Panel/border utilities (`border-line` / `--border`, `text-dim` / `--text-muted`)
- Focus ring: amber (`ring-amber/35` on panel when textarea focused)
- Danger text for `error`; disabled opacity on controls

## 5. Props/API
- `mode: "new" | "follow-up"`
- `selection: AgentSelection`, `onSelectionChange`
- `branch: string`
- `placeholder: string`
- `sending: boolean`
- `onSend: (text, files, delivery?, presentation?) => Promise<boolean>`
- Optional: `projectId`, `disabledReason`, `error`, `initialText`, `extra`, `agentLocked`, `running`, `workflow`, `onWorkflowRemove`, `onWorkflowSelect`, `sessionId`, `draftStorageKey`

## 6. States
- default, focus-within (panel ring), dragging files, sending, disabled (`disabledReason` / `!draftReady`)
- running turn (dual send actions), suggestions open, agent picker open
- error (footer `role="alert"`)

## 7. Code example
```tsx
import { Composer } from "@/components/ade/Composer";

<Composer
  mode="follow-up"
  projectId={projectId}
  sessionId={sessionId}
  selection={selection}
  onSelectionChange={setSelection}
  branch={branch}
  placeholder="Follow-up message"
  sending={sending}
  running={running}
  onSend={handleSend}
/>
```

## 8. Cross-references
- Related: SessionMessage, AgentPicker, ContextPills, BrowserChrome (feedback attach)
