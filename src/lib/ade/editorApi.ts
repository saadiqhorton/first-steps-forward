import type { MediaKind } from "@/shared/media-types.mjs";
import { request, type RequestError } from "./api";

/** Entry from `/api/editor/:id/entries` or search. */
export type EditorEntry = { name: string; path: string; kind: "folder" | "file" };

/**
 * What the Files grid draws for a file, from `/api/editor/:id/previews`. `text` holds the
 * first lines of a UTF-8 file ("" when empty) and is null for binary and media files.
 */
export type EntryPreview = {
  size: number;
  modifiedAt: number;
  media: MediaKind | null;
  text: string | null;
};

/** In-memory open document with draft + optimistic concurrency version. */
export type EditorDocument = { saved: string; draft: string; version: string };

export type EditorApiError = RequestError;

export async function editorApi<T>(url: string, data?: object): Promise<T> {
  return request<T>(url, data === undefined ? "GET" : "POST", data);
}

export function isMarkdownPath(file: string) {
  return /\.(md|mdx)$/i.test(file);
}

export async function loadEditorFile(projectId: string, file: string) {
  const params = new URLSearchParams({ path: file });
  return editorApi<{ content: string; version: string }>(`/api/editor/${projectId}/file?${params}`);
}

export async function saveEditorFile(
  projectId: string,
  file: string,
  content: string,
  version: string,
) {
  return editorApi<{ version: string }>(`/api/editor/${projectId}/file`, {
    path: file,
    content,
    version,
  });
}

export async function listEditorEntries(projectId: string, directory = "") {
  const params = new URLSearchParams({ path: directory });
  return editorApi<{ entries: EditorEntry[] }>(`/api/editor/${projectId}/entries?${params}`);
}

export async function listEditorPreviews(projectId: string, directory = "") {
  const params = new URLSearchParams({ path: directory });
  return editorApi<{ previews: Record<string, EntryPreview> }>(
    `/api/editor/${projectId}/previews?${params}`,
  );
}

/** Streams a picture, video or sound; `version` (its modifiedAt) busts the browser cache. */
export function editorRawUrl(projectId: string, file: string, version?: number) {
  const params = new URLSearchParams({ path: file });
  if (version !== undefined) params.set("v", String(version));
  return `/api/editor/${projectId}/raw?${params}`;
}

export async function searchEditorFiles(projectId: string, query: string, includeFolders = false) {
  const params = new URLSearchParams({ q: query });
  if (includeFolders) params.set("folders", "1");
  return editorApi<{ entries: EditorEntry[] }>(`/api/editor/${projectId}/search?${params}`);
}

export async function createEditorFile(projectId: string, file: string) {
  return editorApi<{ path: string; version: string }>(`/api/editor/${projectId}/create`, {
    path: file,
  });
}

export async function deleteEditorFile(projectId: string, file: string) {
  return editorApi<{ ok: boolean; path: string }>(`/api/editor/${projectId}/delete`, {
    path: file,
  });
}
