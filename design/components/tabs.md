# Tabs

## 1. Metadata
- **Name:** Tabs
- **Category:** UI / navigation
- **Status:** active
- **Source:** `src/components/ui/tabs.tsx` (Radix Tabs)

## 2. Overview
- When to use: Switch between peer content panes with a tab list and panels.
- When not to use: Compact in-track filters (SegmentedControl); browser page tabs (BrowserChromeRow).

## 3. Anatomy
- `Tabs` (Root)
- `TabsList` (pill track)
- `TabsTrigger` (per tab)
- `TabsContent` (panel)

## 4. Tokens used
- List: `bg-muted`, `text-muted-foreground`, `rounded-lg`
- Active trigger: `bg-background` / `--color-bg`, `text-foreground` / `--color-text`, shadow
- Focus rings: `ring-ring`, `ring-offset-background`
- Disabled opacity `50` / `--opacity-disabled`

## 5. Props/API
- All exports forward Radix Tabs props + `className` via `cn`
- Root: `value` / `defaultValue` / `onValueChange` / `orientation` (Radix)
- Trigger: `value` required; Content: `value` required

## 6. States
- active (`data-state=active` on trigger), inactive
- focus-visible ring; disabled (`pointer-events-none`, opacity)
- hover: N/A beyond cursor; error: N/A

## 7. Code example
```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

<Tabs defaultValue="diff">
  <TabsList>
    <TabsTrigger value="diff">Diff</TabsTrigger>
    <TabsTrigger value="activity">Activity</TabsTrigger>
  </TabsList>
  <TabsContent value="diff">…</TabsContent>
  <TabsContent value="activity">…</TabsContent>
</Tabs>
```

## 8. Cross-references
- Related: SegmentedControl, RightPaneTabs (ADE-specific), Dialog
