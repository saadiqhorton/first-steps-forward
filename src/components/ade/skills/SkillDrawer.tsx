import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  Copy,
  Folder,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  SKILL_FILE,
  SKILL_FILE_KINDS,
  validateSkillDescription,
  validateSkillName,
} from "@/shared/skill-format.mjs";
import { copySkill, deleteSkill, saveSkill, type Skill } from "@/lib/ade/skillsApi";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { MarkdownDocument } from "@/components/ade/files/MarkdownDocument";
import { skillsQuery } from "@/lib/ade/queries";
import { askConfirm } from "@/lib/ade/userNotices";
import { skillRootLabel } from "./skillHelpers";
import { SkillFileEditor } from "./SkillFileEditor";
import { SkillTransferDialog } from "./SkillTransferDialog";

export type SkillDrawerView = "details" | "edit" | "files";

type Props = {
  projectId: string;
  skill: Skill;
  view: SkillDrawerView;
  openFile: string | null;
  onClose: () => void;
  onView: (view: SkillDrawerView) => void;
  onOpenFile: (path: string) => void;
  onRemoved: () => void;
  /** A skill that was moved or copied elsewhere, so the gallery can follow it. */
  onTransferred: (skill: Skill, mode: "copy" | "move") => void;
};

/** A metadata value that is a single URL becomes a link; anything else stays text. */
function MetadataValue({ value }: { value: string }) {
  const text = value.trim();
  if (/^https?:\/\/\S+$/i.test(text))
    return (
      <a
        href={text}
        target="_blank"
        rel="noreferrer noopener"
        className="break-all text-teal-deep underline decoration-teal-deep/40 underline-offset-2 hover:decoration-teal-deep"
      >
        {text}
      </a>
    );
  return <span className="break-all">{text}</span>;
}

type MetadataRow = { id: string; key: string; value: string };

/** The metadata map as editable rows. */
function rowsFor(metadata: Record<string, string> | undefined): MetadataRow[] {
  return Object.entries(metadata ?? {}).map(([key, value], index) => ({
    id: `row-${index}-${key}`,
    key,
    value,
  }));
}

/** The rows back as a map. Rows without a key are dropped. */
function metadataValue(rows: MetadataRow[]): Record<string, string> {
  const value: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) value[key] = row.value;
  }
  return value;
}

export function SkillDrawer({
  projectId,
  skill,
  view,
  openFile,
  onClose,
  onView,
  onOpenFile,
  onRemoved,
  onTransferred,
}: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [body, setBody] = useState(skill.body);
  const [license, setLicense] = useState(skill.license);
  const [compatibility, setCompatibility] = useState(skill.compatibility);
  const [allowedTools, setAllowedTools] = useState(skill.allowedTools);
  const [metadataRows, setMetadataRows] = useState(() => rowsFor(skill.metadata));
  const [transferring, setTransferring] = useState(false);
  const [bodyMode, setBodyMode] = useState<"source" | "document">("source");
  const [docMode, setDocMode] = useState<"source" | "document">("document");

  useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setBody(skill.body);
    setLicense(skill.license);
    setCompatibility(skill.compatibility);
    setAllowedTools(skill.allowedTools);
    setMetadataRows(rowsFor(skill.metadata));
  }, [skill]);

  const nameError = validateSkillName(name);
  const descriptionError = validateSkillDescription(description);
  const dirty =
    name !== skill.name ||
    description !== skill.description ||
    body !== skill.body ||
    license !== skill.license ||
    compatibility !== skill.compatibility ||
    allowedTools !== skill.allowedTools ||
    JSON.stringify(metadataValue(metadataRows)) !== JSON.stringify(skill.metadata ?? {});

  const grouped = useMemo(() => {
    const byKind = new Map<string, typeof skill.files>();
    for (const file of skill.files) {
      const list = byKind.get(file.kind) ?? [];
      list.push(file);
      byKind.set(file.kind, list);
    }
    return [...byKind.entries()];
  }, [skill]);

  /** SKILL.md is edited in the skill's details, not as a bundled file. */
  const bundledFiles = useMemo(
    () => skill.files.filter((file) => file.path !== SKILL_FILE),
    [skill.files],
  );

  const mockBody = (value: Skill) => value.body ?? "";

  const addMetadataRow = () =>
    setMetadataRows((rows) => [
      ...rows,
      { id: `row-${rows.length}-${rows.length}`, key: "", value: "" },
    ]);

  const updateMetadataRow = (id: string, patch: { key?: string; value?: string }) =>
    setMetadataRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const removeMetadataRow = (id: string) =>
    setMetadataRows((rows) => rows.filter((row) => row.id !== id));

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: skillsQuery(projectId).queryKey });
  };

  const save = useMutation({
    mutationFn: () =>
      saveSkill(projectId, {
        rootId: skill.rootId,
        folder: skill.folder,
        name: name.trim(),
        description: description.trim(),
        body,
        license: license.trim(),
        compatibility: compatibility.trim(),
        allowedTools: allowedTools.trim(),
        metadata: metadataValue(metadataRows),
      }),
    onSuccess: async () => {
      await refresh();
      onView("details");
    },
  });

  const copy = useMutation({
    mutationFn: () => copySkill(projectId, "ade-project", skill.rootId, skill.folder),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async () => {
      const confirmed = await askConfirm({
        title: `Delete “${skill.name}”?`,
        description: "The skill folder is removed from disk. This cannot be undone.",
        confirmLabel: "Delete",
      });
      if (!confirmed) return;
      await deleteSkill(projectId, skill.rootId, skill.folder);
      await refresh();
      onRemoved();
    },
  });

  const error = save.error ?? copy.error ?? remove.error;

  return (
    <aside
      className={`absolute inset-y-0 right-0 z-10 flex h-full flex-col border-l border-line bg-panel shadow-xl ${
        view === "files" ? "w-full max-w-4xl" : "w-full max-w-xl"
      }`}
      aria-label={`Skill ${skill.name}`}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-mono text-[13px] font-medium">{skill.name}</h2>
          <p className="mt-0.5 truncate font-mono text-[10.5px] text-dim">{skill.location}</p>
        </div>
        <button
          type="button"
          className="grid size-7 shrink-0 place-items-center rounded-md text-dim transition hover:bg-ink/[0.04] hover:text-ink"
          onClick={onClose}
          aria-label="Close skill"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>

      {error ? (
        <p className="mx-4 mt-3 shrink-0 rounded bg-danger/10 p-2 text-[12px] text-danger">
          {error.message}
        </p>
      ) : null}

      {view === "files" ? (
        <SkillFileEditor
          projectId={projectId}
          skill={skill}
          openFile={openFile}
          onOpenFile={onOpenFile}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {skill.warnings.map((warning) => (
            <p
              key={warning}
              className="mb-3 flex items-start gap-2 rounded-md bg-amber/12 p-2 text-[12px] text-amber-deep"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {warning}
            </p>
          ))}

          {skill.scope === "detected" && (
            <p className="mb-3 flex items-start gap-2 rounded-md bg-ink/[0.04] p-2 text-[12px] text-dim">
              <Folder className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              ADE only found this skill in {skillRootLabel(skill).toLowerCase()}. It is read-only
              here — copy it into this project&apos;s own ADE folder to change it.
            </p>
          )}

          {view === "edit" ? (
            <>
              <section className="mb-5">
                <label className="label-mono block" htmlFor="skill-name">
                  Name
                </label>
                <input
                  id="skill-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-2 w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-[13px]"
                />
                {nameError ? (
                  <p className="mt-1 text-[11px] text-danger">{nameError}</p>
                ) : (
                  <p className="mt-1 text-[11px] text-dim">
                    Lowercase letters, numbers and single hyphens. The folder name follows it.
                  </p>
                )}
              </section>

              <section className="mb-5">
                <label className="label-mono block" htmlFor="skill-description">
                  Description
                </label>
                <textarea
                  id="skill-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                  className="mt-2 w-full resize-y rounded-md border border-line bg-paper px-3 py-2 text-[13px] leading-relaxed"
                />
                {descriptionError ? (
                  <p className="mt-1 text-[11px] text-danger">{descriptionError}</p>
                ) : (
                  <p className="mt-1 text-[11px] text-dim">
                    Say what the skill does and when to use it. This is all an agent reads until the
                    skill turns on.
                  </p>
                )}
              </section>

              <section className="mb-5">
                <label className="label-mono block" htmlFor="skill-body">
                  Instructions
                </label>
                <SegmentedControl
                  label="Instructions view"
                  value={bodyMode}
                  onValueChange={(next) => setBodyMode(next as "source" | "document")}
                  options={[
                    { value: "source", label: "Source" },
                    { value: "document", label: "Document" },
                  ]}
                />
                {bodyMode === "source" ? (
                  <textarea
                    id="skill-body"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    rows={9}
                    placeholder="## Steps"
                    className="mt-2 w-full resize-y rounded-md border border-line bg-paper px-3 py-2 font-mono text-[12px] leading-relaxed"
                  />
                ) : (
                  <div className="mt-2 min-h-40 rounded-md border border-line bg-paper px-4 py-3">
                    <MarkdownDocument content={body || "*Nothing written yet.*"} />
                  </div>
                )}
                <p className="mt-1 text-[11px] text-dim">
                  The body of {SKILL_FILE}. Keep it short and move detail into references/.
                </p>
              </section>

              <section className="mb-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="label-section">Metadata</div>
                  <button
                    type="button"
                    className="btn-quiet inline-flex items-center gap-1 px-2 py-1 text-[11px]"
                    onClick={addMetadataRow}
                    data-focus="add-metadata"
                  >
                    <Plus className="size-3" aria-hidden />
                    Add a key
                  </button>
                </div>
                {metadataRows.length ? (
                  metadataRows.map((row) => (
                    <div
                      key={row.id}
                      className="mb-1.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] items-center gap-2"
                    >
                      <input
                        value={row.key}
                        onChange={(event) => updateMetadataRow(row.id, { key: event.target.value })}
                        placeholder="author"
                        aria-label="Metadata key"
                        className="rounded-md border border-line bg-paper px-2 py-1.5 font-mono text-[11.5px]"
                      />
                      <input
                        value={row.value}
                        onChange={(event) =>
                          updateMetadataRow(row.id, { value: event.target.value })
                        }
                        placeholder="ade"
                        aria-label="Metadata value"
                        className="rounded-md border border-line bg-paper px-2 py-1.5 font-mono text-[11.5px]"
                      />
                      <button
                        type="button"
                        className="grid size-6 place-items-center rounded-md text-dim transition hover:bg-danger/10 hover:text-danger"
                        aria-label={`Remove ${row.key || "metadata key"}`}
                        onClick={() => removeMetadataRow(row.id)}
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-[11px] text-dim">
                    Extra key and value pairs, like an author or a version. Any key another client
                    uses is kept as it is.
                  </p>
                )}
              </section>
            </>
          ) : (
            <>
              <section className="mb-5">
                <div className="label-section mb-1">Description</div>
                <p className="text-[13px] leading-relaxed">
                  {skill.description || "No description yet."}
                </p>
              </section>

              {skill.license || skill.compatibility || skill.allowedTools ? (
                <section className="mb-5 grid gap-2 sm:grid-cols-2">
                  {skill.license ? (
                    <div>
                      <div className="label-mono">License</div>
                      <div className="text-[12.5px]">{skill.license}</div>
                    </div>
                  ) : null}
                  {skill.compatibility ? (
                    <div>
                      <div className="label-mono">Compatibility</div>
                      <div className="text-[12.5px]">{skill.compatibility}</div>
                    </div>
                  ) : null}
                  {skill.allowedTools ? (
                    <div className="sm:col-span-2">
                      <div className="label-mono">Allowed tools</div>
                      <div className="font-mono text-[11.5px]">{skill.allowedTools}</div>
                    </div>
                  ) : null}
                </section>
              ) : null}

              <section className="mb-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="label-section">Instructions</div>
                  <SegmentedControl
                    label="Instructions view"
                    value={docMode}
                    onValueChange={(next) => setDocMode(next as "source" | "document")}
                    options={[
                      { value: "document", label: "Document" },
                      { value: "source", label: "Source" },
                    ]}
                  />
                </div>
                {docMode === "document" ? (
                  <div className="rounded-md border border-line bg-paper px-4 py-3">
                    <MarkdownDocument content={mockBody(skill) || "*No instructions yet.*"} />
                  </div>
                ) : (
                  <pre className="max-h-72 overflow-auto rounded-md bg-deck p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-deck-foreground">
                    {mockBody(skill)}
                  </pre>
                )}
              </section>

              {Object.keys(skill.metadata ?? {}).length ? (
                <section className="mb-4">
                  <div className="label-section mb-1">Metadata</div>
                  <dl className="grid gap-0.5">
                    {Object.entries(skill.metadata).map(([key, value]) => (
                      <div key={key} className="flex gap-2 font-mono text-[11.5px]">
                        <dt className="shrink-0 text-dim">{key}</dt>
                        <dd className="min-w-0">
                          <MetadataValue value={value} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}

              <section className="mb-4">
                <div className="label-section mb-2">Bundled files</div>
                {grouped.map(([kind, files]) => (
                  <div key={kind} className="mb-3">
                    <div className="label-mono mb-1">
                      {SKILL_FILE_KINDS[kind as keyof typeof SKILL_FILE_KINDS]} · {files.length}
                    </div>
                    <ul className="overflow-hidden rounded-md border border-line">
                      {files.map((file) => {
                        // SKILL.md is edited through the skill's own fields; a skill ADE
                        // only found has no fields to edit, so its row just reports itself.
                        const editableRow = file.path !== SKILL_FILE || skill.editable;
                        return (
                          <li key={file.path} className="border-b border-line last:border-b-0">
                            <button
                              type="button"
                              disabled={!editableRow}
                              onClick={() =>
                                file.path === SKILL_FILE ? onView("edit") : onOpenFile(file.path)
                              }
                              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[11.5px] transition not-disabled:hover:bg-ink/[0.04] disabled:cursor-default disabled:text-dim"
                            >
                              <span className="min-w-0 flex-1 truncate">{file.path}</span>
                              <span className="shrink-0 text-[10px] text-dim">
                                {file.path === SKILL_FILE && skill.editable
                                  ? "edit"
                                  : `${file.bytes} B`}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                {skill.files.length === 0 ? (
                  <p className="text-[12px] text-dim">This skill has no files yet.</p>
                ) : null}
                <p className="mt-3 text-[11px] text-dim">
                  An agent loads the name and description first, the body when the task matches, and
                  these files only when the instructions ask for them.
                </p>
              </section>
            </>
          )}
        </div>
      )}

      <footer className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
        {view === "files" ? (
          <button
            type="button"
            className="btn-quiet px-3 py-2 text-[13px]"
            onClick={() => onView("details")}
          >
            Back to the skill
          </button>
        ) : view === "edit" ? (
          <>
            <button
              type="button"
              className="btn-amber inline-flex items-center gap-1.5 px-3 py-2 text-[13px] disabled:opacity-50"
              disabled={!dirty || Boolean(nameError) || Boolean(descriptionError) || save.isPending}
              onClick={() => save.mutate()}
            >
              <Check className="size-3.5" aria-hidden />
              {save.isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="btn-quiet px-3 py-2 text-[13px]"
              onClick={() => onView("details")}
            >
              Cancel
            </button>
          </>
        ) : skill.editable ? (
          <>
            <button
              type="button"
              className="btn-amber inline-flex items-center gap-1.5 px-3 py-2 text-[13px]"
              onClick={() => onView("edit")}
            >
              <Pencil className="size-3.5" aria-hidden />
              Edit
            </button>
            <button
              type="button"
              className="btn-quiet inline-flex items-center gap-1.5 px-3 py-2 text-[13px]"
              onClick={() => onView("files")}
            >
              Edit files
            </button>
            <button
              type="button"
              className="btn-quiet inline-flex items-center gap-1.5 px-3 py-2 text-[13px]"
              onClick={() => setTransferring(true)}
            >
              <ArrowLeftRight className="size-3.5" aria-hidden />
              Move or copy
            </button>
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1.5 px-2 py-2 text-[12px] text-danger transition hover:bg-danger/10"
              onClick={() => remove.mutate()}
            >
              <Trash2 className="size-3.5" aria-hidden />
              Remove
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-amber inline-flex items-center gap-1.5 px-3 py-2 text-[13px]"
              onClick={() => setTransferring(true)}
            >
              <Copy className="size-3.5" aria-hidden />
              Move or copy
            </button>
            <button
              type="button"
              className="btn-quiet inline-flex items-center gap-1.5 px-3 py-2 text-[13px]"
              onClick={() => onView("files")}
            >
              View files
            </button>
            <span className="ml-auto text-[11px] text-dim">Read-only</span>
          </>
        )}
      </footer>

      {transferring ? (
        <SkillTransferDialog
          projectId={projectId}
          skill={skill}
          onClose={() => setTransferring(false)}
          onDone={(moved, mode) => {
            setTransferring(false);
            onTransferred(moved, mode);
          }}
        />
      ) : null}
    </aside>
  );
}
