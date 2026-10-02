import type { EditorDocument } from "../editorApi";

/**
 * In-memory drafts for open editor tabs. Survives leaving the Files route so
 * unsaved edits are still there when you come back. Cleared on save, revert,
 * reload-from-disk, or closing the tab.
 */
const drafts = new Map<string, EditorDocument>();

function key(projectId: string, path: string) {
  return `${projectId}\0${path}`;
}

export function getEditorDraft(projectId: string, path: string): EditorDocument | null {
  return drafts.get(key(projectId, path)) ?? null;
}

export function setEditorDraft(projectId: string, path: string, doc: EditorDocument) {
  if (doc.draft === doc.saved) {
    drafts.delete(key(projectId, path));
    return;
  }
  drafts.set(key(projectId, path), doc);
}

export function clearEditorDraft(projectId: string, path: string) {
  drafts.delete(key(projectId, path));
}

export function listDirtyDraftPaths(projectId: string, paths: string[]): string[] {
  return paths.filter((path) => {
    const draft = drafts.get(key(projectId, path));
    return !!draft && draft.draft !== draft.saved;
  });
}
