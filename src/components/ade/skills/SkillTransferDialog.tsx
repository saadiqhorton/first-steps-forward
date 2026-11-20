import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRightLeft } from "lucide-react";
import { copySkill, moveSkill, type Skill } from "@/lib/ade/skillsApi";
import { skillsQuery } from "@/lib/ade/queries";

const TARGETS = [
  {
    id: "ade-project",
    label: "This project",
    path: ".ade/skills",
    hint: "Travels with the repository, so the whole team gets it.",
  },
  {
    id: "ade-user",
    label: "My ADE",
    path: "~/.ade/skills",
    hint: "Available in every project on this machine.",
  },
];

type Props = {
  projectId: string;
  skill: Skill;
  onClose: () => void;
  onDone: (skill: Skill, mode: "copy" | "move") => void;
};

/**
 * Move or copy one skill into another of ADE's own folders — from a project
 * into the machine-wide set, or the other way round. Moving removes the
 * original; copying leaves it where it is.
 */
export function SkillTransferDialog({ projectId, skill, onClose, onDone }: Props) {
  const queryClient = useQueryClient();
  const targets = TARGETS.filter((target) => target.id !== skill.rootId);
  const [rootId, setRootId] = useState(targets[0]?.id ?? "");
  const movable = skill.editable && skill.scope === "ade";

  const finish = async (moved: Skill, mode: "copy" | "move") => {
    await queryClient.invalidateQueries({ queryKey: skillsQuery(projectId).queryKey });
    onDone(moved, mode);
  };

  const copy = useMutation({
    mutationFn: () => copySkill(projectId, rootId, skill.rootId, skill.folder),
    onSuccess: (moved) => finish(moved, "copy"),
  });

  const move = useMutation({
    mutationFn: () => moveSkill(projectId, rootId, skill.rootId, skill.folder),
    onSuccess: (moved) => finish(moved, "move"),
  });

  const target = TARGETS.find((entry) => entry.id === rootId);
  const error = copy.error ?? move.error;
  const busy = copy.isPending || move.isPending;

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-scrim p-6">
      <div
        role="dialog"
        aria-label="Move or copy skill"
        className="w-full max-w-md overflow-hidden rounded-xl border border-line bg-panel shadow-xl"
      >
        <div className="px-4 pt-4">
          <h2 className="text-[15px] font-medium">Move or copy</h2>
          <p className="mt-0.5 font-mono text-caption text-dim">{skill.location}</p>
        </div>

        <div className="px-4 py-4">
          <div className="label-mono mb-1.5">To</div>
          <div className="grid gap-1.5">
            {targets.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setRootId(entry.id)}
                className={`rounded-md border px-3 py-2 text-left transition ${
                  rootId === entry.id
                    ? "border-amber bg-amber/10"
                    : "border-line hover:border-ink/25"
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-ui">{entry.label}</span>
                  <span className="font-mono text-caption text-dim">{entry.path}</span>
                </span>
                <span className="mt-0.5 block text-(length:--text-xs) text-dim">{entry.hint}</span>
              </button>
            ))}
          </div>

          <p className="mt-3 text-(length:--text-xs) text-dim">
            {movable ? (
              <>
                <ArrowRightLeft className="mr-1 inline size-3 align-[-1px]" aria-hidden />
                Moving writes the skill to {target?.path} and removes it from {skill.location}.
              </>
            ) : (
              <>
                This skill lives outside ADE&apos;s own folders, so it can be copied but not moved —
                ADE will not delete another client&apos;s files.
              </>
            )}
          </p>

          {error ? (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-danger/10 p-2 text-(length:--text-xs) text-danger">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {error.message}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" className="btn-quiet px-3 py-2 text-ui" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-quiet px-3 py-2 text-ui disabled:opacity-50"
            onClick={() => copy.mutate()}
            disabled={!rootId || busy}
          >
            {copy.isPending ? "Copying…" : "Copy"}
          </button>
          <button
            type="button"
            className="btn-amber px-3 py-2 text-ui disabled:opacity-50"
            onClick={() => move.mutate()}
            disabled={!rootId || busy || !movable}
            title={movable ? undefined : "ADE will not delete a folder it does not own"}
          >
            {move.isPending ? "Moving…" : "Move"}
          </button>
        </div>
      </div>
    </div>
  );
}
