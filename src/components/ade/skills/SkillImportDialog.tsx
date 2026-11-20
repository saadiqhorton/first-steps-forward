import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Github,
  Package,
  Search,
  Upload,
  XCircle,
} from "lucide-react";
import {
  findSkillsOnGithub,
  importSkillPackage,
  importSkillsFromGithub,
  previewSkillPackage,
  type GithubRepo,
  type GithubSkillCandidate,
  type Skill,
  type StagedSkill,
} from "@/lib/ade/skillsApi";
import { skillsQuery } from "@/lib/ade/queries";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";

type Props = {
  projectId: string;
  onClose: () => void;
  onImported: (skills: Skill[]) => void;
};

const DEFAULT_ROOT = "ade-project";

const ROOTS = [
  {
    id: DEFAULT_ROOT,
    label: "This project",
    path: ".ade/skills",
    hint: "Kept with the repository, in ADE's own folder.",
  },
  {
    id: "ade-user",
    label: "My ADE",
    path: "~/.ade/skills",
    hint: "Available in every project on this machine.",
  },
];

const MODES = [
  { value: "file", label: "A file" },
  { value: "github", label: "GitHub" },
];

const STATUS = {
  ready: { icon: CheckCircle2, label: "Ready", tone: "text-teal-deep" },
  warning: { icon: AlertTriangle, label: "Check", tone: "text-amber-deep" },
  invalid: { icon: XCircle, label: "Not a skill", tone: "text-danger" },
} as const;

const countLabel = (counts: Record<string, number>) => {
  const parts = Object.entries(counts)
    .filter(([kind]) => kind !== "instructions")
    .map(([kind, count]) => `${count} ${kind}`);
  return parts.length ? parts.join(" · ") : "SKILL.md only";
};

/**
 * Import skills. Either a `.skill` file or `.zip` from disk, or a GitHub
 * repository — where the skills are found, checked against the format, and
 * shown before anything is downloaded or written.
 */
export function SkillImportDialog({ projectId, onClose, onImported }: Props) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<"file" | "github">("file");
  const [file, setFile] = useState<File | null>(null);
  const [rootId, setRootId] = useState(DEFAULT_ROOT);
  const [staged, setStaged] = useState<StagedSkill[] | null>(null);

  const [url, setUrl] = useState("");
  const [found, setFound] = useState<{ repo: GithubRepo; skills: GithubSkillCandidate[] } | null>(
    null,
  );
  const [chosen, setChosen] = useState<string[]>([]);

  const preview = useMutation({
    mutationFn: (picked: File) => previewSkillPackage(projectId, picked),
    onSuccess: (skills) => setStaged(skills),
  });

  const importPackage = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("Choose a package first.");
      return importSkillPackage(projectId, rootId, file);
    },
    onSuccess: async (skills) => {
      await queryClient.invalidateQueries({ queryKey: skillsQuery(projectId).queryKey });
      onImported(skills);
    },
  });

  const find = useMutation({
    mutationFn: () => findSkillsOnGithub(projectId, url),
    onSuccess: (result) => {
      setFound(result);
      // Preselect the skills that pass validation; invalid ones stay off.
      setChosen(
        result.skills.filter((skill) => skill.status !== "invalid").map((skill) => skill.folder),
      );
    },
  });

  const importFromGithub = useMutation({
    mutationFn: () => importSkillsFromGithub(projectId, { url, folders: chosen, rootId }),
    onSuccess: async (skills) => {
      await queryClient.invalidateQueries({ queryKey: skillsQuery(projectId).queryKey });
      onImported(skills);
    },
  });

  const error = preview.error ?? importPackage.error ?? find.error ?? importFromGithub.error;
  const busy = importPackage.isPending || importFromGithub.isPending;

  const importable = (found?.skills ?? []).filter((skill) => chosen.includes(skill.folder));
  const canImport = mode === "file" ? Boolean(file) : importable.length > 0;

  const toggle = (folder: string) =>
    setChosen((current) =>
      current.includes(folder) ? current.filter((item) => item !== folder) : [...current, folder],
    );

  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-scrim p-6">
      <div
        role="dialog"
        aria-label="Import skills"
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-medium">Import skills</h2>
            <p className="mt-0.5 text-(length:--text-xs) text-dim">
              A package from disk, or a GitHub repository. Nothing is written until you choose.
            </p>
          </div>
          <button
            type="button"
            className="grid size-7 shrink-0 place-items-center rounded-lg text-dim transition hover:bg-ink/[0.04] hover:text-ink"
            onClick={onClose}
            aria-label="Close import"
          >
            <span aria-hidden>×</span>
          </button>
        </div>

        <div className="shrink-0 px-4 pt-3">
          <SegmentedControl
            label="Import from"
            value={mode}
            onValueChange={(next) => setMode(next as "file" | "github")}
            options={MODES}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {mode === "file" ? (
            <>
              <button
                type="button"
                onClick={() => input.current?.click()}
                className="flex w-full flex-col items-center gap-1.5 rounded-md border border-dashed border-line px-4 py-6 text-ui text-dim transition hover:border-amber hover:text-ink"
              >
                <Upload className="size-5" aria-hidden />
                {file ? (
                  <span className="font-mono text-(length:--text-xs) text-ink">{file.name}</span>
                ) : (
                  <span>Choose a .skill file or a .zip archive</span>
                )}
                <span className="text-caption">
                  Every skill inside needs a SKILL.md with a name and a description.
                </span>
              </button>
              <input
                ref={input}
                type="file"
                accept=".skill,.zip,application/zip"
                className="hidden"
                onChange={(event) => {
                  const picked = event.target.files?.[0] ?? null;
                  setFile(picked);
                  setStaged(null);
                  if (picked) preview.mutate(picked);
                }}
              />

              {staged ? (
                <div className="mt-4">
                  <div className="label-mono mb-1.5">
                    {staged.length} skill{staged.length === 1 ? "" : "s"} found
                  </div>
                  <div className="grid gap-1.5">
                    {staged.map((skill) => (
                      <div key={skill.folder} className="rounded-md border border-line px-3 py-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-mono text-(length:--text-xs)">{skill.name}</span>
                          <span className="font-mono text-2xs text-dim">
                            {skill.files.length} file{skill.files.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        {skill.description ? (
                          <p className="mt-0.5 line-clamp-2 text-(length:--text-xs) text-dim">
                            {skill.description}
                          </p>
                        ) : null}
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {skill.files.map((entry) => (
                            <span
                              key={entry.path}
                              className="rounded-full border border-line px-1.5 py-0.5 font-mono text-2xs text-dim"
                            >
                              {entry.path}
                            </span>
                          ))}
                        </div>
                        {skill.warnings.map((warning) => (
                          <p
                            key={warning}
                            className="mt-1.5 flex items-start gap-1.5 text-caption text-amber-deep"
                          >
                            <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                            {warning}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (url.trim()) find.mutate();
                }}
                className="flex gap-2"
              >
                <div className="relative min-w-0 flex-1">
                  <Github
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-dim"
                    aria-hidden
                  />
                  <input
                    value={url}
                    onChange={(event) => {
                      setUrl(event.target.value);
                      setFound(null);
                      setChosen([]);
                    }}
                    placeholder="https://github.com/owner/repo, or owner/repo"
                    aria-label="GitHub repository or folder"
                    className="w-full rounded-lg border border-line bg-paper py-2 pr-3 pl-9 font-mono text-(length:--text-xs) text-ink placeholder:font-sans placeholder:text-dim"
                  />
                </div>
                <button
                  type="submit"
                  className="btn-quiet inline-flex shrink-0 items-center gap-1.5 px-3 py-2 text-ui disabled:opacity-50"
                  disabled={!url.trim() || find.isPending}
                >
                  <Search className="size-3.5" aria-hidden />
                  {find.isPending ? "Finding…" : "Find skills"}
                </button>
              </form>
              <p className="mt-1.5 text-caption text-dim">
                Paste a repository, or a link to one folder. ADE finds every SKILL.md, including in
                monorepos and nested skill collections, then checks each one.
              </p>

              {find.isPending ? (
                <p className="mt-4 text-(length:--text-xs) text-dim">Reading the repository…</p>
              ) : null}

              {found ? (
                <div className="mt-4">
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="font-mono text-(length:--text-xs)">
                      {found.repo.owner}/{found.repo.name}
                      <span className="text-dim"> · {found.repo.ref}</span>
                    </span>
                    <span className="label-mono">
                      {found.skills.length} skill{found.skills.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="grid gap-1.5">
                    {found.skills.map((skill) => {
                      const status = STATUS[skill.status];
                      const StatusIcon = status.icon;
                      const disabled = skill.status === "invalid";
                      const selected = chosen.includes(skill.folder);
                      return (
                        <button
                          key={skill.folder || "root"}
                          type="button"
                          disabled={disabled}
                          aria-pressed={selected}
                          onClick={() => toggle(skill.folder)}
                          className={`rounded-md border px-3 py-2 text-left transition ${
                            disabled
                              ? "cursor-default border-line opacity-70"
                              : selected
                                ? "border-amber bg-amber/10"
                                : "border-line hover:border-ink/25"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={`mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded border ${
                                selected && !disabled
                                  ? "border-amber bg-amber text-[color:var(--accent-foreground)]"
                                  : "border-line"
                              }`}
                              aria-hidden
                            >
                              {selected && !disabled ? "✓" : ""}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <span className="font-mono text-(length:--text-xs) text-ink">
                                  {skill.name}
                                </span>
                                <span className="font-mono text-2xs text-dim">
                                  {skill.folder ? `${skill.folder}/` : "repository root"}
                                </span>
                                <span
                                  className={`ml-auto inline-flex items-center gap-1 font-mono text-2xs ${status.tone}`}
                                >
                                  <StatusIcon className="size-3" aria-hidden />
                                  {status.label}
                                </span>
                              </span>
                              {skill.description ? (
                                <span className="mt-0.5 block line-clamp-2 text-(length:--text-xs) text-dim">
                                  {skill.description}
                                </span>
                              ) : null}
                              <span className="mt-1 block font-mono text-2xs text-dim">
                                {skill.fileCount} file{skill.fileCount === 1 ? "" : "s"} ·{" "}
                                {countLabel(skill.counts)}
                              </span>
                              <span className="mt-0.5 block text-caption text-dim">
                                {skill.reason}
                              </span>
                              {[...skill.errors, ...skill.warnings].map((warning) => (
                                <span
                                  key={warning}
                                  className={`mt-1 flex items-start gap-1.5 text-caption ${
                                    skill.errors.includes(warning)
                                      ? "text-danger"
                                      : "text-amber-deep"
                                  }`}
                                >
                                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                                  {warning}
                                </span>
                              ))}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </>
          )}

          <div className="mt-4">
            <div className="label-mono mb-1.5">Install into</div>
            <div className="grid gap-1.5">
              {ROOTS.map((root) => (
                <button
                  key={root.id}
                  type="button"
                  onClick={() => setRootId(root.id)}
                  className={`rounded-md border px-3 py-2 text-left transition ${
                    rootId === root.id
                      ? "border-amber bg-amber/10"
                      : "border-line hover:border-ink/25"
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-ui">{root.label}</span>
                    <span className="font-mono text-caption text-dim">{root.path}</span>
                  </span>
                  <span className="mt-0.5 block text-(length:--text-xs) text-dim">{root.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-danger/10 p-2 text-(length:--text-xs) text-danger">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {error.message}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" className="btn-quiet px-3 py-2 text-ui" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-amber inline-flex items-center gap-1.5 px-3 py-2 text-ui disabled:opacity-50"
            disabled={!canImport || busy}
            onClick={() => (mode === "file" ? importPackage.mutate() : importFromGithub.mutate())}
          >
            <Package className="size-3.5" aria-hidden />
            {busy
              ? "Importing…"
              : mode === "file"
                ? "Import"
                : `Import ${importable.length || ""} skill${importable.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
