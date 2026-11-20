# Theme Switch

## 1. Metadata
- **Name:** ThemeSwitch
- **Category:** Arc / action
- **Status:** active
- **Source:** `src/components/arc/theme-switch/theme-switch.tsx`, `src/components/arc/theme-switch/theme-switch.module.css`

## 2. Overview
- When to use: Toggle light/dark preference with a documented transition variant.
- When not to use: Arbitrary boolean switches; non-theme settings.

## 3. Anatomy
- Arc `Button` (`secondary`, `sm`) as the control
- Stacked Sun / Moon icons in an icon wrap (active icon at opacity 1)
- Optional “Switch theme” text label when not `iconOnly`

## 4. Tokens used
- Inherits Button tokens; local: `--space-3`, `--duration-instant`, `--ease-standard`
- `--border-strong`, `--surface-muted`

## 5. Props/API
- `theme: Theme` (`"light" | "dark"` from `@/lib/theme`)
- `onThemeChange: (next: Theme, variant: ThemeSwitchVariant, trigger: HTMLElement) => void`
- `variant?: "reveal" | "eclipse" | "split" | "rise"` (default `"reveal"`) — passed to callback for page transition
- `label?: string` (defaults to `Switch to ${next} mode`)
- `iconOnly?: boolean` (default `false`)

## 6. States
- default, hover, focus-visible (via Button), `aria-pressed` when theme is dark
- hydration settle: icons swap without transition until `settled`
- disabled / error: N/A

## 7. Code example
```tsx
import { ThemeSwitch } from "@/components/arc/theme-switch/theme-switch";

<ThemeSwitch
  theme={theme}
  variant="reveal"
  iconOnly
  onThemeChange={(next) => setTheme(next)}
/>
```

## 8. Cross-references
- Related: Button, TopBar (overrides to ghost icon chrome)
- Foundations: `design/foundations/color.md`
