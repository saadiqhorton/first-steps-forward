# Host Editor

## 1. Metadata
- **Name:** Host Editor
- **Category:** ADE / editor
- **Status:** active
- **Source:** `src/components/ade/host-editor.css`; code surface `src/components/ade/HighlightedCodeEditor.tsx`

## 2. Overview
- When to use: Host file tree + CodeMirror workbench chrome (search, dirty indicator, status, error strip).
- When not to use: Conversation markdown, browser page content, or plain textareas (Composer).

## 3. Anatomy
- `.ed-tree` / `.ed-tree-row` / `.ed-tree-open` / `.ed-tree-remove` / `.ed-dirty-dot`
- `.ed-search` with mono input
- `.ed-code-area` / `.ed-code-workbench` / `.ed-workbench-path` / `.ed-workbench-status`
- `.host-editor-error` banner with dismiss/retry button
- `HighlightedCodeEditor` mounts CodeMirror with syntax theme variables

## 4. Tokens used
- `--text-muted` / `--color-text-muted`, `--accent` / `--color-accent`
- `--radius-control`, `--duration-fast`, `--ease-standard`
- `--border` / `--color-border`, `--border-subtle` / `--color-border-subtle`, `--border-strong` / `--color-border-strong`
- `--danger` / `--color-danger`, `--danger-foreground` / `--color-danger-foreground`, `--surface` / `--color-surface`
- Code: `--code-background`, `--code-foreground`, `--code-gutter*`, `--syntax-*` (editor-specific)

## 5. Props/API
- CSS classes are applied by Files/Host editor parents (no single `HostEditor` React export)
- `HighlightedCodeEditor`: `path: string`, `value: string`, `onChange: (value: string) => void`, `onSave: () => void`

## 6. States
- tree row hover (background transition), dirty dot visible
- remove control hover/focus opacity
- error strip when host I/O fails
- CodeMirror active line / focus caret (`--accent`)
- disabled: N/A at CSS root

## 7. Code example
```tsx
import { HighlightedCodeEditor } from "@/components/ade/HighlightedCodeEditor";
import "@/components/ade/host-editor.css";

<div className="ed-code-workbench host-editor-code">
  <HighlightedCodeEditor path={path} value={value} onChange={setValue} onSave={save} />
</div>
```

## 8. Cross-references
- Related: FilesExplorer / SkillFileEditor consumers, Dialog for confirmations
