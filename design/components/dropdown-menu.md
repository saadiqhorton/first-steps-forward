# Dropdown Menu

## 1. Metadata
- **Name:** DropdownMenu
- **Category:** UI / overlay
- **Status:** active
- **Source:** `src/components/ui/dropdown-menu.tsx` (Radix Dropdown Menu)

## 2. Overview
- When to use: Compact action/choice menus anchored to a trigger; supports checkbox, radio, and submenus.
- When not to use: Full-page navigation; modal confirmations (Dialog); exclusive filter tracks (SegmentedControl).

## 3. Anatomy
- Root / Trigger / Portal / Group / Sub / RadioGroup
- `DropdownMenuContent` / `DropdownMenuSubContent`
- Items: Item, CheckboxItem, RadioItem, Label, Separator, Shortcut, SubTrigger

## 4. Tokens used
- `z-50` (prefer `--z-dropdown`), `bg-popover`, `text-popover-foreground`, border, `shadow-md|lg`
- Focus/open item: `bg-accent` / accent-foreground utilities
- Disabled: `data-[disabled]:opacity-50` (aligns with `--opacity-disabled`)
- Separator: `bg-muted`

## 5. Props/API
- Primitive props from Radix on each export
- Extra: `inset?: boolean` on `DropdownMenuSubTrigger`, `DropdownMenuItem`, `DropdownMenuLabel` (adds `pl-8`)
- `DropdownMenuContent`: `sideOffset` default `4`
- `DropdownMenuShortcut`: span HTML attributes

## 6. States
- open / closed (animate in/out, side slides)
- item focus / highlighted; checkbox/radio checked (indicators)
- disabled items; submenu open (`data-state=open` on SubTrigger)
- error: N/A

## 7. Code example
```tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <button type="button">More</button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem onSelect={onCopy}>Copy</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

## 8. Cross-references
- Related: Dialog, Button (as trigger), Tabs
