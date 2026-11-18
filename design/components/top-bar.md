# Top Bar

## 1. Metadata
- **Name:** TopBar
- **Category:** ADE / chrome
- **Status:** active
- **Source:** `src/components/ade/TopBar.tsx`

## 2. Overview
- When to use: Persistent ADE header — brand, project switcher, agents settings, theme, service status.
- When not to use: In-pane toolbars (browser chrome, composer footer).

## 3. Anatomy
- Header row (`h-10`, border-b, panel background)
- ADE home link
- Desktop: project tabs with initial badge + busy pulse; mobile: `ProjectsMenu`
- Add-project icon button
- Trailing: ProjectsMenu (desktop), Agents settings, ThemeSwitch (`iconOnly`), optional “Local service disconnected”

## 4. Tokens used
- Surfaces/borders via utilities: `bg-panel` / `--color-surface`, `border-line` / `--color-border`
- Text: `text-ink` / `--color-text`, `text-dim` / `--color-text-muted`
- Accent focus: amber outline; busy: teal pulse
- ThemeSwitch overridden to match ghost icon buttons

## 5. Props/API
- `isDesktop: boolean` — project strip vs compact ProjectsMenu

## 6. States
- project link active (`aria-current="page"` + GlideIndicator)
- project busy (teal pulse when session working/verifying)
- icon button hover / focus-visible
- service disconnected badge when `hydrated && !serviceAvailable`
- disabled / error: N/A

## 7. Code example
```tsx
import { TopBar } from "@/components/ade/TopBar";

<TopBar isDesktop={isDesktop} />
```

## 8. Cross-references
- Related: Shell, ThemeSwitch, ProjectsMenu, Dialog (`openDialog`)
