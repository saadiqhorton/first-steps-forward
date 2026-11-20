import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { projectColor } from "@/components/ade/projectColor";
import {
  documentPreviewsQuery,
  documentsQuery,
  entriesQuery,
  entryPreviewsQuery,
} from "@/lib/ade/queries";
import { timeAgo, useAdeState, useNow } from "@/lib/ade/store";
import type { ProjectDocument } from "@/lib/ade/types";
import type { EditorEntry } from "@/lib/ade/editorApi";
import { MarkdownDocument } from "./MarkdownDocument";
import { ProjectFilesGrid } from "./ProjectFilesGrid";

type Props = {
  projectId: string;
  onOpenFile: (path: string) => void;
  /** Expand/reveal a folder path in the explorer tree when the user opens it here. */
  onRevealFolder?: (path: string) => void;
  onCreateFile: (path: string) => Promise<void>;
  onRemoveFile: (path: string) => Promise<boolean>;
};

const ICON_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-lg text-dim transition-colors hover:bg-ink/[0.04] hover:text-ink focus-visible:ring-2 focus-visible:ring-amber/50 focus-visible:outline-none";

const NO_DOCUMENTS: ProjectDocument[] = [];
const NO_ENTRIES: EditorEntry[] = [];

function errorText(reason: unknown) {
  if (!reason) return "";
  return reason instanceof Error ? reason.message : String(reason);
}

export function FilesHome({
  projectId,
  onOpenFile,
  onRevealFolder,
  onCreateFile,
  onRemoveFile,
}: Props) {
  const now = useNow();
  const queryClient = useQueryClient();
  const project = useAdeState((state) => state.projects.find((p) => p.id === projectId));
  const [cwd, setCwd] = useState("");
  const [creating, setCreating] = useState(false);
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const docsQuery = useQuery(documentsQuery(projectId));
  const documents = docsQuery.data ?? NO_DOCUMENTS;
  const previews = useQuery(documentPreviewsQuery(projectId, documents)).data ?? {};
  const dirQuery = useQuery(entriesQuery(projectId, cwd));
  const entries = dirQuery.data ?? NO_ENTRIES;
  // Without previews (an older local service, or a failed read) files fall back to plain page icons.
  const previewsQuery = useQuery(entryPreviewsQuery(projectId, cwd));
  const loadingDocs = docsQuery.isPending;
  const loadingDir = dirQuery.isPending;
  const error = actionError || errorText(docsQuery.error) || errorText(dirQuery.error);
  const colors = projectColor(projectId);
  const projectName = project?.name ?? "Project";
  const initial = (projectName.trim().charAt(0) || "?").toUpperCase();

  useEffect(() => {
    setCwd("");
  }, [projectId]);

  const openFolder = (path: string) => {
    setCwd(path);
    onRevealFolder?.(path);
  };

  const submitCreate = async () => {
    const name = fileName.trim().replace(/^\/+/, "");
    if (!name || saving) return;
    const path = cwd ? `${cwd}/${name}` : name;
    setSaving(true);
    try {
      await onCreateFile(path);
      setFileName("");
      setCreating(false);
      setActionError("");
    } catch (reason) {
      setActionError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };

  const removeFile = async (path: string) => {
    try {
      const removed = await onRemoveFile(path);
      if (removed) setActionError("");
    } catch (reason) {
      setActionError(errorText(reason));
    }
  };

  const refresh = () => {
    for (const key of ["entries", "entry-previews", "documents", "document-previews"])
      void queryClient.invalidateQueries({ queryKey: [key, projectId] });
  };

  const crumbs = cwd ? cwd.split("/").filter(Boolean) : [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 @lg:px-6 @container">
      {error && (
        <p role="alert" className="mb-4 font-mono text-(length:--text-xs) text-amber-deep">
          {error}
        </p>
      )}

      <section>
        <h2 className="text-ui font-medium text-ink">Documents</h2>
        {loadingDocs ? (
          <TextShimmer as="p" className="mt-3 text-ui text-dim">
            Loading documents…
          </TextShimmer>
        ) : documents.length === 0 ? (
          <p className="mt-3 text-ui text-dim">No Markdown documents in this project yet.</p>
        ) : (
          <div className="mt-3 grid gap-3 grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
            {documents.map((doc, i) => {
              const preview = previews[doc.path] ?? "";
              return (
                <button
                  type="button"
                  key={doc.path}
                  onClick={() => onOpenFile(doc.path)}
                  className="card-panel flex min-h-[140px] animate-rise flex-col gap-3 p-4 text-left transition-colors hover:border-amber/50"
                  style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
                  title={doc.path}
                >
                  <div className="min-h-0 flex-1 overflow-hidden">
                    {preview ? (
                      <MarkdownDocument content={preview} compact />
                    ) : (
                      <p className="text-caption text-dim">No preview</p>
                    )}
                  </div>
                  <div className="flex items-baseline justify-between gap-2 border-t border-line pt-2">
                    <span className="truncate font-mono text-caption text-ink">{doc.name}</span>
                    <span className="shrink-0 font-mono text-2xs text-dim">
                      {timeAgo(now, doc.modifiedAt)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="shrink-0 text-ui font-medium text-ink">Project files</h2>
          <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center gap-0.5">
            <button
              type="button"
              onClick={() => openFolder("")}
              aria-current={cwd === "" ? "location" : undefined}
              title={cwd ? `Back to ${projectName}` : projectName}
              className="flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-ui text-ink transition-colors hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-amber/50 focus-visible:outline-none"
            >
              <span
                className={`grid size-5 shrink-0 place-items-center rounded-xs font-mono text-xs font-medium ${colors.bg} ${colors.fg}`}
                aria-hidden
              >
                {initial}
              </span>
              <span className="min-w-0 truncate" style={{ maxWidth: "18ch" }}>
                {projectName}
              </span>
            </button>
            {crumbs.map((part, index) => {
              const path = crumbs.slice(0, index + 1).join("/");
              const last = index === crumbs.length - 1;
              return (
                <span key={path} className="flex min-w-0 items-center gap-0.5">
                  <ChevronRight size={12} aria-hidden className="shrink-0 text-dim opacity-50" />
                  <button
                    type="button"
                    onClick={() => openFolder(path)}
                    aria-current={last ? "location" : undefined}
                    className={`max-w-[12rem] truncate rounded-lg px-1.5 py-0.5 text-ui transition-colors hover:bg-ink/[0.04] hover:text-ink focus-visible:ring-2 focus-visible:ring-amber/50 focus-visible:outline-none ${
                      last ? "text-ink" : "text-dim"
                    }`}
                  >
                    {part}
                  </button>
                </span>
              );
            })}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label="New file"
              title="New file"
              aria-expanded={creating}
              onClick={() => setCreating((open) => !open)}
              className={ICON_BUTTON}
            >
              <Plus className="size-4" aria-hidden strokeWidth={1.5} />
            </button>
            <button
              type="button"
              aria-label="Refresh files"
              title="Refresh"
              onClick={refresh}
              className={ICON_BUTTON}
            >
              <RotateCcw className="size-4" aria-hidden strokeWidth={1.5} />
            </button>
          </div>
        </div>
        {creating && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitCreate();
            }}
            className="mt-3 flex items-center gap-2"
          >
            <input
              aria-label="New file name"
              placeholder="name.txt"
              value={fileName}
              autoFocus
              onChange={(event) => setFileName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setCreating(false);
                  setFileName("");
                }
              }}
              className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-2.5 py-1.5 font-mono text-(length:--text-xs) text-ink placeholder:text-dim focus-visible:ring-2 focus-visible:ring-amber/50 focus-visible:outline-none"
            />
            <button
              type="submit"
              disabled={saving || !fileName.trim()}
              className="shrink-0 font-mono text-caption text-ink hover:underline disabled:opacity-40"
            >
              Create
            </button>
          </form>
        )}
        {loadingDir ? (
          <TextShimmer as="p" className="mt-4 text-ui text-dim">
            Loading files…
          </TextShimmer>
        ) : entries.length === 0 ? (
          <p className="mt-4 text-ui text-dim">
            {cwd ? "This folder is empty." : "This project folder is empty."}
          </p>
        ) : (
          <div className="mt-4">
            <ProjectFilesGrid
              projectId={projectId}
              tone={colors.tone}
              entries={entries}
              previews={previewsQuery.data}
              previewsPending={previewsQuery.isPending}
              onOpenFolder={openFolder}
              onOpenFile={onOpenFile}
              onRemoveFile={(path) => void removeFile(path)}
            />
          </div>
        )}
      </section>
    </div>
  );
}
