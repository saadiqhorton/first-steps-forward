import { Trash2 } from "lucide-react";
import type { EditorEntry, EntryPreview } from "@/lib/ade/editorApi";
import { FileThumb, FolderThumb, SoundButton } from "./FileThumb";

type Props = {
  projectId: string;
  /** Folder fill, from the project's color. */
  tone: string;
  entries: EditorEntry[];
  previews: Record<string, EntryPreview> | undefined;
  previewsPending: boolean;
  onOpenFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
  onRemoveFile: (path: string) => void;
};

/** Finder-style icon view of one folder: folders first, then files, as the server sorts them. */
export function ProjectFilesGrid({
  projectId,
  tone,
  entries,
  previews,
  previewsPending,
  onOpenFolder,
  onOpenFile,
  onRemoveFile,
}: Props) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-x-1 gap-y-1.5">
      {entries.map((entry, index) => {
        const folder = entry.kind === "folder";
        const preview = previews?.[entry.path];
        return (
          <li
            key={entry.path}
            className="group relative animate-rise"
            style={{ animationDelay: `${Math.min(index, 16) * 18}ms` }}
          >
            <button
              type="button"
              title={entry.path}
              onClick={() => (folder ? onOpenFolder(entry.path) : onOpenFile(entry.path))}
              className="flex w-full flex-col items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 pt-2 pb-2.5 text-center transition-colors hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-amber/50 focus-visible:outline-none"
            >
              <span
                className={`flex h-16 w-full items-center justify-center ${
                  entry.name.startsWith(".") ? "opacity-55" : ""
                }`}
                aria-hidden
              >
                {folder ? (
                  <FolderThumb tone={tone} />
                ) : (
                  <FileThumb
                    key={preview?.modifiedAt}
                    projectId={projectId}
                    entry={entry}
                    preview={preview}
                    pending={previewsPending}
                  />
                )}
              </span>
              <span className="line-clamp-2 max-w-full text-[12px] leading-4 text-ink [overflow-wrap:anywhere]">
                {entry.name}
                {folder && <span className="sr-only">, folder</span>}
              </span>
            </button>
            {preview?.media === "audio" && (
              <SoundButton projectId={projectId} entry={entry} preview={preview} />
            )}
            {!folder && (
              <button
                type="button"
                aria-label={`Delete ${entry.path}`}
                title="Delete file"
                onClick={() => onRemoveFile(entry.path)}
                className="absolute top-1 right-1 grid size-6 place-items-center rounded-md text-dim opacity-0 transition-opacity group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 hover:bg-ink/[0.06] hover:text-danger focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-amber/50 focus-visible:outline-none [@media(hover:none)]:opacity-100"
              >
                <Trash2 size={12} aria-hidden />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
