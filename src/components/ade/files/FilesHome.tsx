import { Folder } from "lucide-react";
import { useEffect, useState } from "react";
import { listDocuments, timeAgo, useAde } from "@/lib/ade/store";
import type { ProjectDocument } from "@/lib/ade/types";
import {
  editorFileIcon,
  listEditorEntries,
  loadEditorFile,
  type EditorEntry,
} from "../HostEditorPane";
import { MarkdownDocument } from "./MarkdownDocument";

type Props = {
  projectId: string;
  onOpenFile: (path: string) => void;
};

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10_240 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilesHome({ projectId, onOpenFile }: Props) {
  const { state } = useAde();
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [rootEntries, setRootEntries] = useState<EditorEntry[]>([]);
  const [entrySizes, setEntrySizes] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const [docs, entries] = await Promise.all([
          listDocuments(projectId),
          listEditorEntries(projectId, ""),
        ]);
        if (cancelled) return;
        setDocuments(docs);
        setRootEntries(entries.entries);

        const sizes: Record<string, number> = {};
        for (const doc of docs) sizes[doc.path] = doc.size;
        setEntrySizes(sizes);

        const previewEntries = await Promise.all(
          docs.map(async (doc) => {
            try {
              const file = await loadEditorFile(projectId, doc.path);
              const preview = file.content.split("\n").slice(0, 6).join("\n");
              return [doc.path, preview] as const;
            } catch {
              return [doc.path, ""] as const;
            }
          }),
        );
        if (cancelled) return;
        setPreviews(Object.fromEntries(previewEntries));
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      {error && (
        <p role="alert" className="mb-4 font-mono text-[12px] text-amber">
          {error}
        </p>
      )}

      <section>
        <h2 className="label-mono">Documents</h2>
        {loading ? (
          <p className="mt-3 text-[13px] text-dim">Loading documents…</p>
        ) : documents.length === 0 ? (
          <p className="mt-3 text-[13px] text-dim">No Markdown documents in this project yet.</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {documents.map((doc) => {
              const preview = previews[doc.path] ?? "";
              return (
                <button
                  type="button"
                  key={doc.path}
                  onClick={() => onOpenFile(doc.path)}
                  className="card-panel flex min-h-[140px] flex-col gap-3 p-4 text-left transition-colors hover:border-amber/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
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
                      {timeAgo(state.now, doc.modifiedAt)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="label-mono">Project files</h2>
        {loading ? (
          <p className="mt-3 text-[13px] text-dim">Loading files…</p>
        ) : rootEntries.length === 0 ? (
          <p className="mt-3 text-[13px] text-dim">This project folder is empty.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {rootEntries.map((entry) => {
              const size = entrySizes[entry.path];
              return (
                <li key={entry.path}>
                  {entry.kind === "folder" ? (
                    <div className="flex items-center gap-2 px-1 py-2.5 font-mono text-[12px] text-ink">
                      <Folder size={14} aria-hidden className="shrink-0 text-dim" />
                      <span className="truncate">{entry.name}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-dim">folder</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenFile(entry.path)}
                      className="flex w-full items-center gap-2 px-1 py-2.5 text-left font-mono text-[12px] text-ink hover:bg-ink/5"
                      title={entry.path}
                    >
                      <span className="shrink-0 text-dim">{editorFileIcon(entry.path)}</span>
                      <span className="truncate">{entry.name}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-dim">
                        {size != null ? formatBytes(size) : "file"}
                      </span>
                    </button>
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
