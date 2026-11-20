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
- Workspace nav (`sm` and up): Inbox (lucide `Inbox`) and Luna (lucide `MessageCircle`) links using `.topbar-workspace-link` (12px, 6px radius; active/hover = ink 6% fill). Luna shows `.topbar-assistant-dot`: amber for unseen replies, teal pulsing while Luna is working.
- Desktop: project tabs (13px) with a 20px mono initial tinted with the project colour, active = ink 6% pill + medium weight, teal busy pulse; mobile: `ProjectsMenu`
- Add-project icon button
- Trailing: “Projects” menu (`ProjectsMenu`, desktop), Agents settings, ThemeSwitch (`iconOnly`), optional “Local service disconnected”

## 4. Tokens used
- Surfaces/borders via utilities: `bg-panel` / `--surface`, `border-line` / `--border`
- Text: `text-ink` / `--foreground`, `text-dim` / `--text-muted`
- Busy: teal pulse; Luna dot: amber (unseen reply) / teal (working)
- Focus: no outline renders. The `focus-visible:outline-amber` classes in `TopBar.tsx` have no effect because `src/components/arc/foundation.css` sets `outline: none !important` on all focus states.
- ThemeSwitch overridden to match ghost icon buttons

## 5. Props/API
- `isDesktop: boolean` — project strip vs compact ProjectsMenu

## 6. States
- project link active (`aria-current="page"` + GlideIndicator)
- project busy (teal pulse when session working/verifying)
- icon button hover (no visible focus outline; see Tokens)
- service disconnected badge when `hydrated && !serviceAvailable`
- disabled / error: N/A

## 7. Code example
```tsx
import { TopBar } from "@/components/ade/TopBar";

<TopBar isDesktop={isDesktop} />
```

## 8. Cross-references
- Related: Shell, ThemeSwitch, ProjectsMenu, Dialog (`openDialog`)
