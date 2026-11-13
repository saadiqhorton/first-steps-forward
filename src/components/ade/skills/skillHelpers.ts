import { SKILL_FILE_KINDS, SKILL_KIND_ORDER } from "@/shared/skill-format.mjs";
import { SKILL_ROOT_LABELS, type Skill } from "@/lib/ade/skillsApi";

/** How many files of each kind a skill bundles, in the order the format lists them. */
export function skillKindCounts(skill: Skill) {
  const counts = new Map<string, number>();
  for (const file of skill.files) counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1);
  return SKILL_KIND_ORDER.filter((kind) => counts.has(kind)).map((kind) => ({
    kind,
    count: counts.get(kind) ?? 0,
    label: SKILL_FILE_KINDS[kind],
  }));
}

/** The name of the folder a skill lives in, in words rather than a path. */
export function skillRootLabel(skill: Skill) {
  return SKILL_ROOT_LABELS[skill.rootId] ?? skill.rootId;
}
