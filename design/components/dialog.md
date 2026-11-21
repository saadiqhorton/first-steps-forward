# Dialog

## 1. Metadata
- **Name:** Dialog
- **Category:** UI / overlay
- **Status:** active
- **Source:** `src/components/ui/dialog.tsx` (Radix Dialog)

## 2. Overview
- When to use: Modal flows that need overlay, focus trap, and title/description semantics.
- When not to use: Non-modal popovers (DropdownMenu); inline expanders (Collapsible).

## 3. Anatomy
- `Dialog` (Root) / `DialogTrigger` / `DialogPortal` / `DialogClose`
- `DialogOverlay` (scrim)
- `DialogContent` (centered panel + built-in close X)
- `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`

## 4. Tokens used
- Overlay: `bg-scrim` / `--scrim`, `z-50`
- Content: `bg-background` / `--background`, border, `shadow-lg` → `--shadow-floating`
- Close: opacity hover, `ring-ring` focus classes, and open accent wash utilities. `ring-ring` resolves through the transparent `--focus-ring` token, so it does not create a visible focus ring.

## 5. Props/API
- Root/Trigger/Close: Radix Dialog primitive props (`open`, `onOpenChange`, `asChild`, …)
- `DialogOverlay` / `DialogContent` / `DialogTitle` / `DialogDescription`: forward refs + `className` + primitive props
- `DialogHeader` / `DialogFooter`: `React.HTMLAttributes<HTMLDivElement>`

## 6. States
- open / closed (`data-state` animations: fade + zoom)
- overlay present while open; close button hover / focus / disabled
- error: N/A (content-specific)

## 7. Code example
```tsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

<Dialog>
  <DialogTrigger asChild>
    <button type="button">Open</button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Agents</DialogTitle>
    </DialogHeader>
  </DialogContent>
</Dialog>
```

## 8. Cross-references
- Related: Shell dialogs, Skill import/transfer dialogs, DropdownMenu
