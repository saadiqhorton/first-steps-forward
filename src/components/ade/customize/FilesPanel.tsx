import { File } from "lucide-react";
import type { ChangeFile } from "@/lib/ade/customizeApi";

export function FilesList({ files }: { files: ChangeFile[] }) {
  return (
    <ul className="space-y-1">
      {files.map((file) => {
        // Middle truncation: the folder gives way first, the file name stays readable.
        const cut = file.path.lastIndexOf("/") + 1;
        return (
          <li key={file.path} className="flex items-center gap-2 py-1">
            <File className="size-4 shrink-0 text-dim" strokeWidth={1.5} aria-hidden />
            <span className="flex min-w-0 flex-1 font-mono text-xs" title={file.path}>
              {cut > 0 && (
                <span className="min-w-0 truncate text-[color:var(--text-secondary)]">
                  {file.path.slice(0, cut)}
                </span>
              )}
              <span className="max-w-full shrink-0 truncate text-ink">{file.path.slice(cut)}</span>
            </span>
            <span className="shrink-0 font-mono text-xs tabular-nums">
              {file.added > 0 && <span className="text-teal-deep">+{file.added}</span>}
              {file.added > 0 && file.removed > 0 && " "}
              {file.removed > 0 && <span className="text-danger">−{file.removed}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function FilesPanel({ files, working }: { files: ChangeFile[]; working: boolean }) {
  if (!files.length)
    return (
      <p className="text-ui text-dim">
        {working ? "Files appear here when the agent finishes." : "No files changed."}
      </p>
    );
  return (
    <div>
      <FilesList files={files} />
      <p className="mt-3 text-xs leading-5 text-dim">
        Files in your private copy only. The design files check keeps colors and layout untouched.
      </p>
    </div>
  );
}
