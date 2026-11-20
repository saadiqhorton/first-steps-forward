import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, RotateCcw } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { fileQuery } from "@/lib/ade/queries";
import { isMarkdownPath, saveEditorFile } from "@/lib/ade/editorApi";
import "../host-editor.css";
import {
  clearEditorDraft,
  getEditorDraft,
  setEditorDraft,
  subscribeEditorDraft,
} from "./editorDrafts";
import { MarkdownDocument } from "./MarkdownDocument";

const HighlightedCodeEditor = lazy(() =>
  import("../HighlightedCodeEditor").then((module) => ({ default: module.HighlightedCodeEditor })),
);

type Props = {
  projectId: string;
  path: string;
  visible: boolean;
  onDirtyChange: (path: string, dirty: boolean) => void;
};

type ViewMode = "document" | "source";

const VIEW_MODES = [
  { value: "document", label: "Document" },
  { value: "source", label: "Source" },
];

export function FileTab({ projectId, path, visible, onDirtyChange }: Props) {
  const markdown = isMarkdownPath(path);
  const queryClient = useQueryClient();
  const file = useQuery(fileQuery(projectId, path));
  const [mode, setMode] = useState<ViewMode>("document");
  const savedDoc = useMemo(
    () =>
      file.data
        ? { saved: file.data.content, draft: file.data.content, version: file.data.version }
        : null,
    [file.data],
  );
  const doc = useSyncExternalStore(
    (listener) => subscribeEditorDraft(projectId, path, listener),
    () => getEditorDraft(projectId, path) ?? savedDoc,
    () => null,
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const opening = file.isLoading && !doc;
  const error = actionError || (file.isError ? file.error.message : "");

  const dirty = !!doc && doc.draft !== doc.saved;

  useEffect(() => {
    onDirtyChange(path, dirty);
  }, [dirty, onDirtyChange, path]);

  const saveFile = async () => {
    if (!doc || !dirty || saving) return;
    const draft = doc.draft;
    setSaving(true);
    setActionError("");
    try {
      const value = await saveEditorFile(projectId, path, draft, doc.version);
      queryClient.setQueryData(fileQuery(projectId, path).queryKey, {
        content: draft,
        version: value.version,
      });
      const current = getEditorDraft(projectId, path);
      if (current && current.draft !== draft) {
        setEditorDraft(projectId, path, {
          saved: draft,
          draft: current.draft,
          version: value.version,
        });
      } else {
        clearEditorDraft(projectId, path);
      }
      setNotice(`${path.split("/").at(-1)} saved to disk`);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const reloadFile = async () => {
    setActionError("");
    try {
      const value = await queryClient.fetchQuery({ ...fileQuery(projectId, path), staleTime: 0 });
      queryClient.setQueryData(fileQuery(projectId, path).queryKey, value);
      clearEditorDraft(projectId, path);
      setNotice("Reloaded from disk");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const showSource = !markdown || mode === "source";

  return (
    <div
      className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${visible ? "flex" : "hidden"}`}
      aria-hidden={!visible}
    >
      {markdown && (
        <div className="flex shrink-0 items-center gap-1 border-b border-line bg-paper px-3 py-2">
          <SegmentedControl
            label="View mode"
            value={mode}
            onValueChange={(next) => setMode(next as ViewMode)}
            options={VIEW_MODES}
          />
          {showSource && (
            <div className="ml-auto flex items-center gap-1.5">
              {dirty && (
                <button
                  type="button"
                  className="btn-quiet inline-flex size-7 items-center justify-center"
                  title="Revert draft"
                  aria-label="Revert draft"
                  onClick={() => {
                    if (!doc) return;
                    setEditorDraft(projectId, path, { ...doc, draft: doc.saved });
                    setNotice("Draft reverted");
                    setActionError("");
                  }}
                >
                  <RotateCcw size={13} aria-hidden />
                </button>
              )}
              <button
                type="button"
                className="btn-amber inline-flex h-7 items-center gap-1.5 px-2.5 text-(length:--text-xs) disabled:opacity-45"
                disabled={!dirty || saving}
                onClick={() => void saveFile()}
              >
                <Check size={13} aria-hidden />
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>
      )}

      {!markdown && (
        <div className="flex h-9 shrink-0 items-center justify-end gap-1.5 border-b border-line bg-paper px-3">
          {dirty && (
            <button
              type="button"
              className="btn-quiet inline-flex size-7 items-center justify-center"
              title="Revert draft"
              aria-label="Revert draft"
              onClick={() => {
                if (!doc) return;
                setEditorDraft(projectId, path, { ...doc, draft: doc.saved });
                setNotice("Draft reverted");
                setActionError("");
              }}
            >
              <RotateCcw size={13} aria-hidden />
            </button>
          )}
          <button
            type="button"
            className="btn-amber inline-flex h-7 items-center gap-1.5 px-2.5 text-(length:--text-xs) disabled:opacity-45"
            disabled={!dirty || saving}
            onClick={() => void saveFile()}
          >
            <Check size={13} aria-hidden />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      <div className="ed-workbench-path shrink-0" title={path}>
        {path}
      </div>

      {opening && !doc ? (
        <div className="grid flex-1 place-items-center font-mono text-(length:--text-xs) text-dim">
          Opening file…
        </div>
      ) : error && !doc ? (
        <div className="grid flex-1 place-items-center px-6 text-center font-mono text-(length:--text-xs) text-amber-deep">
          {error}
        </div>
      ) : doc && markdown && mode === "document" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <MarkdownDocument content={doc.draft} />
        </div>
      ) : doc && showSource ? (
        <div className="ed-code-area ed-code-workbench host-editor-code min-h-0 flex-1">
          <Suspense
            fallback={
              <div className="grid h-full place-items-center font-mono text-(length:--text-xs) text-dim">
                Loading editor…
              </div>
            }
          >
            <HighlightedCodeEditor
              path={path}
              value={doc.draft}
              onChange={(value) => {
                if (doc) setEditorDraft(projectId, path, { ...doc, draft: value });
                setNotice("");
              }}
              onSave={() => void saveFile()}
            />
          </Suspense>
        </div>
      ) : null}

      {error && doc && (
        <div role="alert" className="host-editor-error">
          <span>{error}</span>
          {error.includes("changed on disk") && (
            <button type="button" onClick={() => void reloadFile()}>
              Reload
            </button>
          )}
        </div>
      )}

      <div className="ed-workbench-status shrink-0">
        <span role="status">
          {notice ||
            (dirty
              ? "Unsaved draft"
              : markdown && mode === "document"
                ? "Read-only document"
                : "Ready to edit")}
        </span>
        <span>UTF-8</span>
      </div>
    </div>
  );
}
