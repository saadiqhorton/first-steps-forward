import { useQueryClient } from "@tanstack/react-query";
import { Check, RotateCcw } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { fileQuery } from "@/lib/ade/queries";
import { isMarkdownPath, saveEditorFile, type EditorDocument } from "../editorApi";
import "../host-editor.css";
import { clearEditorDraft, getEditorDraft, setEditorDraft } from "./editorDrafts";
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

function initialDoc(
  projectId: string,
  path: string,
  queryClient: ReturnType<typeof useQueryClient>,
): EditorDocument | null {
  const draft = getEditorDraft(projectId, path);
  if (draft) return draft;
  const file = queryClient.getQueryData(fileQuery(projectId, path).queryKey);
  return file ? { saved: file.content, draft: file.content, version: file.version } : null;
}

export function FileTab({ projectId, path, visible, onDirtyChange }: Props) {
  const markdown = isMarkdownPath(path);
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<ViewMode>("document");
  const [doc, setDoc] = useState<EditorDocument | null>(() =>
    initialDoc(projectId, path, queryClient),
  );
  const [opening, setOpening] = useState(() => doc === null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const dirty = !!doc && doc.draft !== doc.saved;

  useEffect(() => {
    onDirtyChange(path, dirty);
  }, [dirty, onDirtyChange, path]);

  useEffect(() => {
    if (!doc) {
      clearEditorDraft(projectId, path);
      return;
    }
    setEditorDraft(projectId, path, doc);
  }, [doc, projectId, path]);

  useEffect(() => {
    let cancelled = false;
    const hasDraft = !!getEditorDraft(projectId, path);
    const cached = queryClient.getQueryData(fileQuery(projectId, path).queryKey);
    setOpening(!(hasDraft || cached));
    setError("");
    setNotice("");
    void queryClient
      .fetchQuery(fileQuery(projectId, path))
      .then((value) => {
        if (cancelled) return;
        // Keep a restored or in-progress draft instead of overwriting it.
        setDoc((previous) =>
          previous && previous.draft !== previous.saved
            ? previous
            : { saved: value.content, draft: value.content, version: value.version },
        );
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setOpening(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, path, queryClient]);

  const saveFile = async () => {
    if (!doc || !dirty || saving) return;
    const draft = doc.draft;
    setSaving(true);
    setError("");
    try {
      const value = await saveEditorFile(projectId, path, draft, doc.version);
      const next = { saved: draft, draft, version: value.version };
      setDoc(next);
      clearEditorDraft(projectId, path);
      queryClient.setQueryData(fileQuery(projectId, path).queryKey, {
        content: draft,
        version: value.version,
      });
      setNotice(`${path.split("/").at(-1)} saved to disk`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const reloadFile = async () => {
    setOpening(true);
    setError("");
    try {
      const value = await queryClient.fetchQuery({ ...fileQuery(projectId, path), staleTime: 0 });
      setDoc({ saved: value.content, draft: value.content, version: value.version });
      clearEditorDraft(projectId, path);
      setNotice("Reloaded from disk");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOpening(false);
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
                    setDoc({ ...doc, draft: doc.saved });
                    setNotice("Draft reverted");
                    setError("");
                  }}
                >
                  <RotateCcw size={13} aria-hidden />
                </button>
              )}
              <button
                type="button"
                className="btn-amber inline-flex h-7 items-center gap-1.5 px-2.5 text-[12px] disabled:opacity-45"
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
                setDoc({ ...doc, draft: doc.saved });
                setNotice("Draft reverted");
                setError("");
              }}
            >
              <RotateCcw size={13} aria-hidden />
            </button>
          )}
          <button
            type="button"
            className="btn-amber inline-flex h-7 items-center gap-1.5 px-2.5 text-[12px] disabled:opacity-45"
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
        <div className="grid flex-1 place-items-center font-mono text-[12px] text-dim">
          Opening file…
        </div>
      ) : error && !doc ? (
        <div className="grid flex-1 place-items-center px-6 text-center font-mono text-[12px] text-amber">
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
              <div className="grid h-full place-items-center font-mono text-[12px] text-dim">
                Loading editor…
              </div>
            }
          >
            <HighlightedCodeEditor
              path={path}
              value={doc.draft}
              onChange={(value) => {
                setDoc((previous) => (previous ? { ...previous, draft: value } : previous));
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
