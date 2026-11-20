# Shell

## 1. Metadata
- **Name:** Shell
- **Category:** ADE / layout
- **Status:** active
- **Source:** `src/components/ade/Shell.tsx`

## 2. Overview
- When to use: App chrome wrapping routed project content — top bar, main column, resizable right/bottom docks, dialogs, browser preview host.
- When not to use: Standalone marketing pages or isolated storybook demos that do not need ADE layout persistence.

## 3. Anatomy
- `Shell` → `BrowserPreviewProvider` + `ShellInner`
- TopBar
- Resizable `Group` / `Panel` / `Separator` (main + right or bottom dock)
- Panel collapse handles on seams
- Persistent pane host DOM for terminal/computer portals
- Right rail / right pane tabs / processes / agent computer
- Shell-owned dialogs (add project, agents) via `ShellContext`

## 4. Tokens used
- Layout uses ADE utility classes: `bg-panel` / `--surface`, borders via `--line` / `--border`
- Seam/collapse hit sizes: `--size-hit-seam`, `--size-hit-collapse` (global CSS)
- Panel min sizes are pixel constants in source (`RIGHT_MIN_PX`, `BOTTOM_MIN_PX`), not tokens

## 5. Props/API
- `Shell({ children }: { children: ReactNode })`
- No other public props; layout, dock preference, and dialogs are internal + context (`useShell`)

## 6. States
- desktop vs narrow (`useIsDesktop`, `lg` breakpoint)
- right/bottom dock preference (`DOCK_PREF_KEY`)
- panels collapsed / expanded (persisted layouts)
- hover / disabled / error: N/A at shell root

## 7. Code example
```tsx
import { Shell } from "@/components/ade/Shell";

<Shell>
  <Outlet />
</Shell>
```

## 8. Cross-references
- Related: TopBar, BrowserChrome, ConversationList, Dialog (shell dialogs)
- Foundations: `design/foundations/elevation.md`
