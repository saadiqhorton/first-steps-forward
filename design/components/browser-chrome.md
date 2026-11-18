# Browser Chrome

## 1. Metadata
- **Name:** BrowserChromeRow
- **Category:** ADE / browser
- **Status:** active
- **Source:** `src/components/ade/browser/BrowserChromeRow.tsx`

## 2. Overview
- When to use: Docked browser toolbar — tabs, navigation, address bar, annotate/capture, more menu, optional device toolbar and feedback dialogs.
- When not to use: App TopBar or process list rows.

## 3. Anatomy
- Optional tablist (tab select/mute/close, new tab, profile select)
- Nav row: back / forward / reload-or-stop, address form, annotate, capture, float, more `<details>` menu
- Optional device toolbar form (presets, size, lock, rotate)
- Error / capture-error alerts
- Capture and annotation review dialogs (fixed bottom sheets)

## 4. Tokens used
- `bg-panel` / `--color-surface`, `bg-paper` / `--color-bg`, `border-line` / `--color-border`
- `text-ink` / `--color-text`, `text-dim` / `--color-text-muted`, `text-danger` / `--color-danger`
- Icon button hover/focus amber outline; loading amber pulse bar
- Elevation: `shadow-xl` on menus/dialogs → prefer `--shadow-floating` in new CSS

## 5. Props/API
- `frameRef: RefObject<HTMLDivElement | null>`
- `sessionId?: string`
- `running?: boolean` (feedback delivery “later” while turn runs)
- `profiles?: readonly { id: string; name: string }[]` (default `[]`)
- Behavior also reads browser preview / ADE store contexts (not props)

## 6. States
- controller “you” vs agent (`canOperate` gates nav/tabs)
- tab selected / recording / muted; address read-only when not operating
- nav loading; annotation mode pressed; recording active (danger tint)
- device toolbar open; fullscreen; menu open
- capture/annotation dialogs; sending feedback; `browserError` / `capture.error`
- disabled buttons when frame missing or not operating

## 7. Code example
```tsx
import { BrowserChromeRow } from "@/components/ade/browser/BrowserChromeRow";

<BrowserChromeRow
  frameRef={frameRef}
  sessionId={sessionId}
  running={running}
  profiles={profiles}
/>
```

## 8. Cross-references
- Related: Shell (BrowserPreviewProvider), Composer (feedback attach), Dialog patterns
