import type { EditorDocument } from "@/lib/ade/editorApi";

/**
 * In-memory drafts for open editor tabs. Survives leaving the Files route so
 * unsaved edits are still there when you come back. Cleared on save, revert,
 * reload-from-disk, or closing the tab.
 */
const drafts = new Map<string, EditorDocument>();
const listeners = new Map<string, Set<() => void>>();

function key(projectId: string, path: string) {
  return `${projectId}\0${path}`;
}

export function getEditorDraft(projectId: string, path: string): EditorDocument | null {
  return drafts.get(key(projectId, path)) ?? null;
}

export function subscribeEditorDraft(
  projectId: string,
  path: string,
  listener: () => void,
): () => void {
  const id = key(projectId, path);
  const subscribers = listeners.get(id) ?? new Set();
  subscribers.add(listener);
  listeners.set(id, subscribers);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(id);
  };
}

function notify(id: string) {
  listeners.get(id)?.forEach((listener) => listener());
}

export function setEditorDraft(projectId: string, path: string, doc: EditorDocument) {
  const id = key(projectId, path);
  if (doc.draft === doc.saved) drafts.delete(id);
  else drafts.set(id, doc);
  notify(id);
}

export function clearEditorDraft(projectId: string, path: string) {
  const id = key(projectId, path);
  drafts.delete(id);
  notify(id);
}

export function listDirtyDraftPaths(projectId: string, paths: string[]): string[] {
  return paths.filter((path) => {
    const draft = drafts.get(key(projectId, path));
    return !!draft && draft.draft !== draft.saved;
  });
}
