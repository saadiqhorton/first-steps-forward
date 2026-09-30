import { Check, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { HighlightedCodeEditor } from "../HighlightedCodeEditor";
import {
  isMarkdownPath,
  loadEditorFile,
  saveEditorFile,
  type EditorDocument,
} from "../HostEditorPane";
import "../host-editor.css";
import { MarkdownDocument } from "./MarkdownDocument";

type Props = {
  projectId: string;
  path: string;
  visible: boolean;
  onDirtyChange: (path: string, dirty: boolean) => void;
};

type ViewMode = "document" | "source";

export function FileTab({ projectId, path, visible, onDirtyChange }: Props) {
  const markdown = isMarkdownPath(path);
  const [mode, setMode] = useState<ViewMode>("document");
  const [doc, setDoc] = useState<EditorDocument | null>(null);
  const [opening, setOpening] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const dirty = !!doc && doc.draft !== doc.saved;

  useEffect(() => {
    onDirtyChange(path, dirty);
  }, [dirty, onDirtyChange, path]);

  useEffect(() => {
    let cancelled = false;
    setOpening(true);
    setError("");
    setNotice("");
    void loadEditorFile(projectId, path)
      .then((value) => {
        if (cancelled) return;
        setDoc({ saved: value.content, draft: value.content, version: value.version });
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
  }, [projectId, path]);

  const saveFile = async () => {
    if (!doc || !dirty || saving) return;
    const draft = doc.draft;
    setSaving(true);
    setError("");
    try {
      const value = await saveEditorFile(projectId, path, draft, doc.version);
      setDoc({ saved: draft, draft, version: value.version });
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
      const value = await loadEditorFile(projectId, path);
      setDoc({ saved: value.content, draft: value.content, version: value.version });
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
        <div
          role="group"
          aria-label="View mode"
          className="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-paper px-3"
        >
          <button
            type="button"
            aria-pressed={mode === "document"}
            onClick={() => setMode("document")}
            className={`rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
              mode === "document" ? "bg-ink text-paper" : "text-dim hover:bg-ink/5 hover:text-ink"
            }`}
          >
            Document
          </button>
          <button
            type="button"
            aria-pressed={mode === "source"}
            onClick={() => setMode("source")}
            className={`rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
              mode === "source" ? "bg-ink text-paper" : "text-dim hover:bg-ink/5 hover:text-ink"
            }`}
          >
            Source
          </button>
          {showSource && (
            <div className="ml-auto flex items-center gap-1">
              {dirty && (
                <button
                  type="button"
                  className="ed-revert"
                  title="Revert draft"
                  aria-label="Revert draft"
                  onClick={() => {
                    if (!doc) return;
                    setDoc({ ...doc, draft: doc.saved });
                    setNotice("Draft reverted");
                    setError("");
                  }}
                >
                  <RotateCcw size={12} />
                </button>
              )}
              <button
                type="button"
                className="ed-save"
                disabled={!dirty || saving}
                onClick={() => void saveFile()}
                aria-label="Save file"
              >
                <Check size={12} aria-hidden /> {saving ? "Saving" : "Save"}
              </button>
            </div>
          )}
        </div>
      )}

      {!markdown && (
        <div className="flex h-9 shrink-0 items-center justify-end gap-1 border-b border-line bg-paper px-3">
          {dirty && (
            <button
              type="button"
              className="ed-revert"
              title="Revert draft"
              aria-label="Revert draft"
              onClick={() => {
                if (!doc) return;
                setDoc({ ...doc, draft: doc.saved });
                setNotice("Draft reverted");
                setError("");
              }}
            >
              <RotateCcw size={12} />
            </button>
          )}
          <button
            type="button"
            className="ed-save"
            disabled={!dirty || saving}
            onClick={() => void saveFile()}
            aria-label="Save file"
          >
            <Check size={12} aria-hidden /> {saving ? "Saving" : "Save"}
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
          <HighlightedCodeEditor
            path={path}
            value={doc.draft}
            onChange={(value) => {
              setDoc((previous) => (previous ? { ...previous, draft: value } : previous));
              setNotice("");
            }}
            onSave={() => void saveFile()}
          />
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
