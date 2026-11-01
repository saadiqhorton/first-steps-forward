import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Folder, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { documentPreviewsQuery, documentsQuery, entriesQuery } from "@/lib/ade/queries";
import { timeAgo, useNow } from "@/lib/ade/store";
import type { ProjectDocument } from "@/lib/ade/types";
import { editorFileIcon, type EditorEntry } from "../editorApi";
import { MarkdownDocument } from "./MarkdownDocument";

type Props = {
  projectId: string;
  onOpenFile: (path: string) => void;
  /** Expand/reveal a folder path in the explorer tree when the user opens it here. */
  onRevealFolder?: (path: string) => void;
  onCreateFile: (path: string) => Promise<void>;
  onRemoveFile: (path: string) => Promise<boolean>;
};

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10_240 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function parentDir(path: string) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

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
  const loadingDocs = docsQuery.isPending;
  const loadingDir = dirQuery.isPending;
  const error = actionError || errorText(docsQuery.error) || errorText(dirQuery.error);
  const entrySizes = useMemo(() => {
    const sizes: Record<string, number> = {};
    for (const doc of documents) sizes[doc.path] = doc.size;
    return sizes;
  }, [documents]);

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

  const crumbs = cwd ? cwd.split("/").filter(Boolean) : [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 @lg:px-6 @container">
      {error && (
        <p role="alert" className="mb-4 font-mono text-[12px] text-amber">
          {error}
        </p>
      )}

      <section>
        <h2 className="label-mono">Documents</h2>
        {loadingDocs ? (
          <TextShimmer as="p" className="mt-3 text-[13px] text-dim">
            Loading documents…
          </TextShimmer>
        ) : documents.length === 0 ? (
          <p className="mt-3 text-[13px] text-dim">No Markdown documents in this project yet.</p>
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
                      <p className="text-[11px] text-dim">No preview</p>
                    )}
                  </div>
                  <div className="flex items-baseline justify-between gap-2 border-t border-line pt-2">
                    <span className="truncate font-mono text-[11px] text-ink">{doc.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-dim">
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
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <h2 className="label-mono">Project files</h2>
            <button
              type="button"
              aria-label="New file"
              title="New file"
              aria-expanded={creating}
              onClick={() => setCreating((open) => !open)}
              className="grid size-7 place-items-center rounded-md text-dim hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
            >
              <Plus className="size-4" aria-hidden strokeWidth={2} />
            </button>
          </div>
          <nav
            aria-label="Folder path"
            className="flex w-full min-w-0 flex-wrap items-center gap-0.5 font-mono text-[11px] text-dim"
          >
            <button
              type="button"
              onClick={() => openFolder("")}
              className={`rounded px-1.5 py-0.5 hover:bg-ink/5 hover:text-ink ${cwd === "" ? "text-ink" : ""}`}
            >
              root
            </button>
            {crumbs.map((part, index) => {
              const path = crumbs.slice(0, index + 1).join("/");
              const last = index === crumbs.length - 1;
              return (
                <span key={path} className="flex min-w-0 items-center gap-0.5">
                  <ChevronRight size={12} aria-hidden className="shrink-0 opacity-50" />
                  <button
                    type="button"
                    onClick={() => openFolder(path)}
                    className={`max-w-[10rem] truncate rounded px-1.5 py-0.5 hover:bg-ink/5 hover:text-ink ${last ? "text-ink" : ""}`}
                  >
                    {part}
                  </button>
                </span>
              );
            })}
          </nav>
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
              className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2.5 py-1.5 font-mono text-[12px] text-ink placeholder:text-dim focus-visible:outline-2 focus-visible:outline-amber"
            />
            <button
              type="submit"
              disabled={saving || !fileName.trim()}
              className="shrink-0 font-mono text-[11px] text-ink hover:underline disabled:opacity-40"
            >
              Create
            </button>
          </form>
        )}
        {loadingDir ? (
          <TextShimmer as="p" className="mt-3 text-[13px] text-dim">
            Loading files…
          </TextShimmer>
        ) : entries.length === 0 ? (
          <p className="mt-3 text-[13px] text-dim">
            {cwd ? "This folder is empty." : "This project folder is empty."}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {cwd ? (
              <li>
                <button
                  type="button"
                  onClick={() => openFolder(parentDir(cwd))}
                  className="flex w-full items-center gap-2 px-1 py-2.5 text-left font-mono text-[12px] text-dim hover:bg-ink/5 hover:text-ink"
                >
                  <Folder size={14} aria-hidden className="shrink-0" />
                  <span>..</span>
                  <span className="ml-auto shrink-0 text-[10px]">up</span>
                </button>
              </li>
            ) : null}
            {entries.map((entry) => {
              const size = entrySizes[entry.path];
              return (
                <li key={entry.path}>
                  {entry.kind === "folder" ? (
                    <button
                      type="button"
                      onClick={() => openFolder(entry.path)}
                      className="flex w-full items-center gap-2 px-1 py-2.5 text-left font-mono text-[12px] text-ink hover:bg-ink/5"
                      title={entry.path}
                    >
                      <Folder size={14} aria-hidden className="shrink-0 text-dim" />
                      <span className="truncate">{entry.name}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-dim">folder</span>
                    </button>
                  ) : (
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => onOpenFile(entry.path)}
                        className="flex min-w-0 flex-1 items-center gap-2 px-1 py-2.5 text-left font-mono text-[12px] text-ink hover:bg-ink/5"
                        title={entry.path}
                      >
                        <span className="shrink-0 text-dim">{editorFileIcon(entry.path)}</span>
                        <span className="truncate">{entry.name}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-dim">
                          {size != null ? formatBytes(size) : "file"}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${entry.path}`}
                        title="Delete file"
                        onClick={() => void removeFile(entry.path)}
                        className="ed-tree-remove mr-1"
                      >
                        <Trash2 size={12} aria-hidden />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
