// Adapted from T3 Code's PreviewUnreachable.tsx.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
import { FileWarning } from "lucide-react";
import { withBrowserSession } from "@/lib/ade/browser/api";
import type { BrowserFileNotShown as FileState } from "@/lib/ade/browser/browserStream";
import { openExternally } from "./browserActions";

export function BrowserFileNotShown({ file, projectId, sessionId }: {
  file: FileState;
  projectId: string;
  sessionId: string | null;
}) {
  let host = file.url;
  try { host = new URL(file.url).host || file.url; } catch { /* Use the address as supplied. */ }
  return (
    <div className="absolute inset-0 z-[4] overflow-y-auto bg-paper text-ink" role="status">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-6 py-8">
        <FileWarning className="mb-5 size-10 text-dim" aria-hidden />
        <h2 className="mb-3 text-xl font-semibold">This file can’t be shown here</h2>
        <p className="text-sm text-dim"><span className="font-semibold text-ink">{file.fileName}</span> from {host} was downloaded instead.</p>
        <div className="mt-auto flex justify-end gap-2 pt-6">
          <button type="button" className="btn-quiet px-3 py-1.5 text-xs" onClick={() => openExternally(file.url)}>Open in browser</button>
          {file.downloadId ? (
            <a className="btn-amber px-3 py-1.5 text-xs" href={withBrowserSession(`/api/projects/${encodeURIComponent(projectId)}/browser/downloads/${encodeURIComponent(file.downloadId)}`, sessionId)} download={file.fileName}>Download</a>
          ) : <span className="px-3 py-1.5 text-xs text-dim">{file.status === "failed" ? "Download unavailable" : "Preparing download…"}</span>}
        </div>
      </div>
    </div>
  );
}
