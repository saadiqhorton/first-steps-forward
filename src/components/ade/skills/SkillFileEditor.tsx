import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, FileWarning, Lock, Plus, RotateCcw, Trash2 } from "lucide-react";
import { SKILL_FILE, SKILL_FILE_KINDS } from "@/shared/skill-format.mjs";
import {
  createSkillFile,
  deleteSkillFile,
  readSkillFile,
  skillAssetUrl,
  writeSkillFile,
  type Skill,
} from "@/lib/ade/skillsApi";
import { skillFileQuery, skillsQuery } from "@/lib/ade/queries";
import { askConfirm } from "@/lib/ade/userNotices";
import { MarkdownDocument } from "@/components/ade/files/MarkdownDocument";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";

const MARKDOWN = /\.mdx?$/i;

type Props = {
  projectId: string;
  skill: Skill;
  openFile: string | null;
  onOpenFile: (path: string) => void;
};

/**
 * Every file inside a skill: text opens in the editor, markdown switches
 * between source and document, images and other binaries get a preview. A
 * skill ADE only found is shown read-only with the same viewer.
 */
export function SkillFileEditor({ projectId, skill, openFile, onOpenFile }: Props) {
  const queryClient = useQueryClient();
  const bundled = skill.files.filter((file) => file.path !== SKILL_FILE);
  const path =
    openFile && bundled.some((file) => file.path === openFile)
      ? openFile
      : (bundled[0]?.path ?? null);
  const entry = bundled.find((file) => file.path === path) ?? null;
  const editable = skill.editable;
  const text = entry ? entry.text !== false : true;

  const file = useQuery({
    queryKey: skillFileQuery(projectId, skill.rootId, skill.folder, path ?? "").queryKey,
    queryFn: () => readSkillFile(projectId, skill.rootId, skill.folder, path ?? ""),
    enabled: Boolean(path) && text,
    retry: false,
  });

  const [draft, setDraft] = useState<string | null>(null);
  const [newPath, setNewPath] = useState("");
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState(true);

  useEffect(() => {
    setDraft(null);
    setPreview(true);
  }, [path, skill.folder]);

  const content = file.data?.content ?? "";
  const version = file.data?.version ?? "";
  const value = draft ?? content;
  const dirty = editable && draft !== null && draft !== content;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: skillsQuery(projectId).queryKey });
  };

  const save = useMutation({
    mutationFn: () =>
      writeSkillFile(projectId, skill.rootId, skill.folder, path ?? "", value, version),
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({
        queryKey: skillFileQuery(projectId, skill.rootId, skill.folder, path ?? "").queryKey,
      });
      await refresh();
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const target = newPath.trim();
      await createSkillFile(projectId, skill.rootId, skill.folder, target);
      await refresh();
      return target;
    },
    onSuccess: (target) => {
      setNewPath("");
      setAdding(false);
      onOpenFile(target);
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const confirmed = await askConfirm({
        title: `Delete ${path}?`,
        description: "The file is removed from the skill folder.",
        confirmLabel: "Delete",
      });
      if (!confirmed) return;
      await deleteSkillFile(projectId, skill.rootId, skill.folder, path ?? "");
      await refresh();
    },
    onSuccess: () => {
      const next = bundled.find((file) => file.path !== path);
      onOpenFile(next?.path ?? "");
    },
  });

  const error = save.error ?? create.error ?? remove.error ?? file.error ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-56 shrink-0 flex-col border-r border-line">
        <div className="label-mono shrink-0 px-3 py-2">Files</div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {bundled.map((item) => (
            <li key={item.path}>
              <button
                type="button"
                onClick={() => onOpenFile(item.path)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-caption transition hover:bg-ink/[0.04] ${
                  item.path === path ? "bg-amber/12 text-ink" : "text-dim"
                }`}
                title={item.path}
              >
                <span className="min-w-0 flex-1 truncate">{item.path}</span>
                <span className="shrink-0 text-2xs opacity-70">
                  {item.image ? "image" : item.text === false ? "binary" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="shrink-0 border-t border-line p-2">
          {!editable ? (
            <p className="flex items-start gap-1.5 px-1 text-caption text-dim">
              <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
              Read-only here.
            </p>
          ) : adding ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (newPath.trim()) create.mutate();
              }}
              className="grid gap-1"
            >
              <input
                value={newPath}
                onChange={(event) => setNewPath(event.target.value)}
                placeholder="references/NOTE.md"
                autoFocus
                className="w-full rounded-lg border border-line bg-paper px-2 py-1 font-mono text-caption"
              />
              <div className="flex gap-1">
                <button
                  type="submit"
                  className="btn-amber px-2 py-1 text-caption"
                  disabled={!newPath.trim() || create.isPending}
                >
                  Add
                </button>
                <button
                  type="button"
                  className="btn-quiet px-2 py-1 text-caption"
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-1.5 py-1 text-(length:--text-xs) text-dim transition hover:text-ink"
              onClick={() => setAdding(true)}
            >
              <Plus className="size-3.5" aria-hidden />
              Add a file
            </button>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-(length:--text-xs) text-dim">
            {path}
          </span>
          {entry && text && MARKDOWN.test(entry.path) ? (
            <SegmentedControl
              label="File view"
              value={preview ? "document" : "source"}
              onValueChange={(next) => setPreview(next === "document")}
              options={[
                { value: "source", label: "Source" },
                { value: "document", label: "Document" },
              ]}
            />
          ) : null}
          {entry && !text ? (
            <a
              href={skillAssetUrl(projectId, skill.rootId, skill.folder, entry.path)}
              target="_blank"
              rel="noreferrer noopener"
              className="btn-quiet inline-flex items-center gap-1 px-2 py-1 text-caption"
            >
              <ExternalLink className="size-3" aria-hidden />
              Open
            </a>
          ) : null}
          {editable ? (
            <>
              {dirty ? (
                <button
                  type="button"
                  className="btn-quiet inline-flex items-center gap-1 px-2 py-1 text-caption"
                  onClick={() => setDraft(null)}
                >
                  <RotateCcw className="size-3" aria-hidden />
                  Revert
                </button>
              ) : null}
              <button
                type="button"
                className="btn-amber inline-flex items-center gap-1 px-2 py-1 text-caption disabled:opacity-50"
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate()}
              >
                <Check className="size-3" aria-hidden />
                {save.isPending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="grid size-6 place-items-center rounded-lg text-dim transition hover:bg-danger/10 hover:text-danger"
                aria-label={`Delete ${path}`}
                onClick={() => remove.mutate()}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </>
          ) : null}
        </div>

        {error ? (
          <p className="shrink-0 px-3 py-2 text-(length:--text-xs) text-danger">
            {error instanceof Error ? error.message : String(error)}
          </p>
        ) : null}

        {!path ? (
          <div className="grid flex-1 place-items-center text-(length:--text-xs) text-dim">
            This skill has no bundled files.
          </div>
        ) : !text ? (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {entry?.image ? (
              <img
                src={skillAssetUrl(projectId, skill.rootId, skill.folder, entry.path)}
                alt={entry.path}
                className="mx-auto max-h-full max-w-full rounded-lg border border-line bg-paper object-contain"
              />
            ) : (
              <div className="mx-auto mt-8 max-w-sm text-center">
                <FileWarning className="mx-auto size-6 text-dim" aria-hidden />
                <p className="mt-2 text-ui text-dim">
                  {entry ? `${entry.bytes} bytes, not text` : "Not text"} — there is nothing to edit
                  here, but the file stays in the skill folder.
                </p>
              </div>
            )}
          </div>
        ) : file.isLoading ? (
          <div className="grid flex-1 place-items-center font-mono text-(length:--text-xs) text-dim">
            Opening file…
          </div>
        ) : preview && entry && MARKDOWN.test(entry.path) ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <MarkdownDocument content={value || "*This file is empty.*"} />
          </div>
        ) : editable ? (
          <textarea
            value={value}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-[var(--code-background)] p-3 font-mono text-xs leading-relaxed text-[var(--code-foreground)] outline-none"
          />
        ) : (
          <pre className="min-h-0 flex-1 overflow-auto bg-[var(--code-background)] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-[var(--code-foreground)]">
            {value}
          </pre>
        )}

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-3 py-1.5 font-mono text-2xs text-dim">
          <span>{entry ? SKILL_FILE_KINDS[entry.kind] : ""}</span>
          <span>{!editable ? "Read-only" : dirty ? "Unsaved draft" : "Ready to edit"}</span>
        </div>
      </div>
    </div>
  );
}
