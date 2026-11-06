/** Entry from `/api/editor/:id/entries` or search. */
export type EditorEntry = { name: string; path: string; kind: "folder" | "file" };

/** In-memory open document with draft + optimistic concurrency version. */
export type EditorDocument = { saved: string; draft: string; version: string };

export type EditorApiError = Error & { status?: number };

export async function editorApi<T>(url: string, data?: object): Promise<T> {
  const response = await fetch(
    url,
    data === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.error || "File request failed.") as EditorApiError;
    error.status = response.status;
    throw error;
  }
  return value as T;
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

export async function searchEditorFiles(projectId: string, query: string) {
  const params = new URLSearchParams({ q: query });
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
