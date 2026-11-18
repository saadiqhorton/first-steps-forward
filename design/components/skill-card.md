# Skill Card

## 1. Metadata
- **Name:** SkillCard
- **Category:** ADE / skills
- **Status:** active
- **Source:** `src/components/ade/skills/SkillCard.tsx`

## 2. Overview
- When to use: Selectable skill tile in the skills workspace grid.
- When not to use: Workflow browse cards or conversation list rows.

## 3. Anatomy
- `card-panel` button (`aria-pressed`)
- Icon badge (Sparkles); optional “check” warnings chip; file-count chip
- Name + description
- Kind count chips (or “name + description only”)
- Footer: scope/root label + updated date

## 4. Tokens used
- `card-panel`, `border-line` / `--color-border`
- Selected: `border-amber` + `ring-amber/40`; hover `border-ink/25`
- Amber icon wash (`bg-amber/15`, `text-amber-deep`); `text-dim` / `--color-text-muted`

## 5. Props/API
- `skill: Skill` (from `@/lib/ade/skillsApi`)
- `selected: boolean`
- `onSelect: (skill: Skill) => void`

## 6. States
- default, hover, selected (`aria-pressed`), warnings present
- focus: native button focus
- disabled / error: N/A

## 7. Code example
```tsx
import { SkillCard } from "@/components/ade/skills/SkillCard";

<SkillCard skill={skill} selected={skill.id === selectedId} onSelect={setSelected} />
```

## 8. Cross-references
- Related: SkillsWorkspace, SkillDrawer, Dialog (import/transfer)
