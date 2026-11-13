import { AlertTriangle, Folder, Sparkles } from "lucide-react";
import type { Skill } from "@/lib/ade/skillsApi";
import { skillKindCounts, skillRootLabel } from "./skillHelpers";

export function SkillCard({
  skill,
  selected,
  onSelect,
}: {
  skill: Skill;
  selected: boolean;
  onSelect: (skill: Skill) => void;
}) {
  const counts = skillKindCounts(skill);
  const extras = counts.filter((entry) => entry.kind !== "instructions");
  return (
    <button
      type="button"
      onClick={() => onSelect(skill)}
      aria-pressed={selected}
      className={`card-panel group relative flex flex-col items-start gap-2 p-4 pb-10 text-left transition ${
        selected ? "border-amber ring-1 ring-amber/40" : "hover:border-ink/25"
      }`}
    >
      <span className="flex w-full items-center gap-2">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-md bg-amber/15 text-amber-deep"
          aria-hidden
        >
          <Sparkles className="size-4" />
        </span>
        {skill.warnings.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber/50 px-2 py-0.5 font-mono text-[10px] text-amber-deep">
            <AlertTriangle className="size-3" aria-hidden />
            check
          </span>
        )}
        <span className="ml-auto rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-dim">
          {skill.files.length} {skill.files.length === 1 ? "file" : "files"}
        </span>
      </span>
      <span className="w-full min-w-0 pr-6">
        <h3 className="break-words text-[14px] font-medium leading-snug">{skill.name}</h3>
        <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-dim">
          {skill.description || "No description yet."}
        </p>
      </span>
      <span className="flex flex-wrap gap-1">
        {extras.length > 0 ? (
          extras.map((entry) => (
            <span
              key={entry.kind}
              className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-dim"
            >
              {entry.count} {entry.label.toLowerCase()}
            </span>
          ))
        ) : (
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-dim">
            name + description only
          </span>
        )}
      </span>
      <span className="absolute right-4 bottom-3 left-4 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-dim">
          {skill.scope === "detected" && <Folder className="size-3" aria-hidden />}
          {skillRootLabel(skill)}
        </span>
        <span className="font-mono text-[10px] text-dim">
          {new Date(skill.updatedAt).toLocaleDateString()}
        </span>
      </span>
    </button>
  );
}
