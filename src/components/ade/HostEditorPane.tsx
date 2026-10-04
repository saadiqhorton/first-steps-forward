import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, lazy, Suspense, type ReactNode } from "react";
import {
  editorFileIcon,
  listEditorEntries,
  loadEditorFile,
  saveEditorFile,
  searchEditorFiles,
  type EditorDocument,
  type EditorEntry,
} from "./editorApi";
import { askConfirm } from "./NoticeDialog";
import "./host-editor.css";

export type { EditorDocument, EditorEntry, EditorApiError } from "./editorApi";
export {
  editorApi,
  editorFileIcon,
  isMarkdownPath,
  listEditorEntries,
  loadEditorFile,
  saveEditorFile,
  searchEditorFiles,
} from "./editorApi";

const HighlightedCodeEditor = lazy(() =>
  import("./HighlightedCodeEditor").then((module) => ({ default: module.HighlightedCodeEditor })),
);

type Props = { projectId: string; projectName: string; projectPath: string };

export function HostEditorPane({ projectId, projectName, projectPath }: Props) {
  const [directories, setDirectories] = useState<Record<string, EditorEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EditorEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [docs, setDocs] = useState<Record<string, EditorDocument>>({});
  const [active, setActive] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const current = active ? docs[active] : undefined;
  const openFiles = Object.keys(docs);
  const dirty = !!current && current.draft !== current.saved;
  const isDirtyPath = (file: string) => {
    const document = docs[file];
    return !!document && document.draft !== document.saved;
  };
  const dirtyCount = useMemo(
    () => Object.values(docs).filter((document) => document.draft !== document.saved).length,
    [docs],
  );

  const loadDirectory = useCallback(
    async (directory: string) => {
      setLoadingFolders((previous) => new Set(previous).add(directory));
      try {
        const value = await listEditorEntries(projectId, directory);
        setDirectories((previous) => ({ ...previous, [directory]: value.entries }));
        setError("");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setLoadingFolders((previous) => {
          const next = new Set(previous);
          next.delete(directory);
          return next;
        });
      }
    },
    [projectId],
  );

  useEffect(() => {
    void loadDirectory("");
  }, [loadDirectory]);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      void searchEditorFiles(projectId, term)
        .then((value) => {
          if (!cancelled) {
            setResults(value.entries);
            setError("");
          }
        })
        .catch((reason) => {
          if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, query]);

  useEffect(() => {
    if (!dirtyCount) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyCount]);

  const toggleFolder = (directory: string) => {
    const openingFolder = !expanded.has(directory);
    setExpanded((previous) => {
      const next = new Set(previous);
      if (openingFolder) next.add(directory);
      else next.delete(directory);
      return next;
    });
    if (openingFolder && !directories[directory]) void loadDirectory(directory);
  };

  const openFile = async (file: string) => {
    setActive(file);
    setNotice("");
    setError("");
    if (docs[file]) return;
    setOpening(true);
    try {
      const value = await loadEditorFile(projectId, file);
      setDocs((previous) => ({
        ...previous,
        [file]: { saved: value.content, draft: value.content, version: value.version },
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOpening(false);
    }
  };

  const saveFile = async () => {
    if (!active || !current || !dirty || saving) return;
    const file = active;
    const draft = current.draft;
    setSaving(true);
    setError("");
    try {
      const value = await saveEditorFile(projectId, file, draft, current.version);
      setDocs((previous) => {
        const existing = previous[file];
        return existing
          ? { ...previous, [file]: { ...existing, saved: draft, version: value.version } }
          : previous;
      });
      setNotice(`${file.split("/").at(-1)} saved to disk`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const reloadFile = async () => {
    if (!active) return;
    const file = active;
    setOpening(true);
    setError("");
    try {
      const value = await loadEditorFile(projectId, file);
      setDocs((previous) => ({
        ...previous,
        [file]: { saved: value.content, draft: value.content, version: value.version },
      }));
      setNotice("Reloaded from disk");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOpening(false);
    }
  };

  const closeFile = async (file: string) => {
    if (saving && active === file) return;
    if (
      isDirtyPath(file) &&
      !(await askConfirm({
        title: `Discard unsaved changes in ${file}?`,
        confirmLabel: "Discard",
      }))
    )
      return;
    const index = openFiles.indexOf(file);
    const remaining = openFiles.filter((openFile) => openFile !== file);
    setDocs((previous) => {
      const next = { ...previous };
      delete next[file];
      return next;
    });
    if (active === file) setActive(remaining[Math.min(index, remaining.length - 1)] ?? null);
    setNotice("");
    setError("");
  };

  const renderEntries = (directory: string, depth = 0): ReactNode => {
    const entries = directories[directory] ?? [];
    return entries.map((entry) =>
      entry.kind === "folder" ? (
        <div key={entry.path} role="none">
          <button
            type="button"
            role="treeitem"
            aria-expanded={expanded.has(entry.path)}
            className="ed-tree-row ed-folder"
            style={{ paddingLeft: `${11 + depth * 13}px` }}
            onClick={() => toggleFolder(entry.path)}
          >
            {expanded.has(entry.path) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {expanded.has(entry.path) ? <FolderOpen size={13} /> : <Folder size={13} />}
            <span>{entry.name}</span>
          </button>
          {expanded.has(entry.path) && (
            <div role="group">
              {loadingFolders.has(entry.path) ? (
                <div className="ed-tree-empty">Reading folder…</div>
              ) : (
                renderEntries(entry.path, depth + 1)
              )}
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          role="treeitem"
          aria-selected={active === entry.path}
          key={entry.path}
          className={`ed-tree-row ed-file ${active === entry.path ? "is-active" : ""}`}
          style={{ paddingLeft: `${25 + depth * 13}px` }}
          onClick={() => void openFile(entry.path)}
          title={entry.path}
        >
          {editorFileIcon(entry.path)}
          <span>{entry.name}</span>
          {isDirtyPath(entry.path) && (
            <span className="ed-dirty-dot" aria-label="Unsaved changes" />
          )}
        </button>
      ),
    );
  };

  return (
    <section className="ed-surface ed-workbench host-editor" aria-label="Project editor">
      <div className="ed-workbench-project">
        <strong title={projectName}>{projectName}</strong>
        <span>{dirtyCount ? `${dirtyCount} unsaved` : "On this machine"}</span>
      </div>
      <div className="ed-workbench-explorer">
        <label className="ed-search">
          <Search size={13} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a file…"
            aria-label="Find a project file"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear file search">
              <X size={12} />
            </button>
          )}
        </label>
        <div className="ed-tree" role="tree" aria-label="Project files">
          {query.trim() ? (
            searching ? (
              <div className="ed-tree-empty">Searching…</div>
            ) : results.length ? (
              results.map((entry) => (
                <button
                  type="button"
                  role="treeitem"
                  aria-selected={active === entry.path}
                  key={entry.path}
                  className={`ed-tree-row ed-file ${active === entry.path ? "is-active" : ""}`}
                  style={{ paddingLeft: 12 }}
                  onClick={() => void openFile(entry.path)}
                  title={entry.path}
                >
                  {editorFileIcon(entry.path)}
                  <span>{entry.path}</span>
                  {isDirtyPath(entry.path) && (
                    <span className="ed-dirty-dot" aria-label="Unsaved changes" />
                  )}
                </button>
              ))
            ) : (
              <div className="ed-tree-empty">No matching files</div>
            )
          ) : loadingFolders.has("") ? (
            <div className="ed-tree-empty">Reading project…</div>
          ) : directories[""]?.length ? (
            renderEntries("")
          ) : (
            <div className="ed-tree-empty">No files in this folder</div>
          )}
        </div>
      </div>
      <div className="ed-workbench-filebar">
        <div className="host-editor-tabs" aria-label="Open files">
          {openFiles.length ? (
            openFiles.map((file) => (
              <div className={`host-editor-tab ${active === file ? "is-active" : ""}`} key={file}>
                <button
                  type="button"
                  className="host-editor-tab-select"
                  onClick={() => {
                    setActive(file);
                    setNotice("");
                    setError("");
                  }}
                  title={file}
                  aria-label={`Show ${file}`}
                  aria-current={active === file ? "page" : undefined}
                >
                  {editorFileIcon(file)}
                  <span>{file.split("/").at(-1)}</span>
                  {isDirtyPath(file) && (
                    <i className="host-editor-dirty" aria-label="Unsaved changes" />
                  )}
                </button>
                <button
                  type="button"
                  className="host-editor-tab-close"
                  onClick={() => closeFile(file)}
                  title={`Close ${file}`}
                  aria-label={`Close ${file}`}
                >
                  <X size={12} aria-hidden />
                </button>
              </div>
            ))
          ) : (
            <span className="host-editor-no-tabs">Choose a file</span>
          )}
        </div>
        <div className="ed-save-controls is-compact">
          {dirty && (
            <button
              type="button"
              className="ed-revert"
              title="Revert draft"
              aria-label="Revert draft"
              onClick={() => {
                if (!active || !current) return;
                setDocs((previous) => {
                  const existing = previous[active];
                  return existing
                    ? { ...previous, [active]: { ...existing, draft: existing.saved } }
                    : previous;
                });
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
      </div>
      <div className="ed-workbench-path" title={active ?? projectPath}>
        {active ?? projectPath}
      </div>
      {active && current ? (
        <div className="ed-code-area ed-code-workbench host-editor-code">
          <Suspense fallback={<div className="host-editor-empty">Loading editor…</div>}>
            <HighlightedCodeEditor
              key={active}
              path={active}
              value={current.draft}
              onChange={(value) => {
                setDocs((previous) => {
                  const existing = previous[active];
                  return existing
                    ? { ...previous, [active]: { ...existing, draft: value } }
                    : previous;
                });
                setNotice("");
              }}
              onSave={() => void saveFile()}
            />
          </Suspense>
        </div>
      ) : (
        <div className="host-editor-empty">
          {opening
            ? "Opening file…"
            : active && error
              ? "Could not open this file."
              : "Choose a file above to edit it."}
        </div>
      )}
      {error && (
        <div role="alert" className="host-editor-error">
          <span>{error}</span>
          {error.includes("changed on disk") && (
            <button type="button" onClick={() => void reloadFile()}>
              Reload
            </button>
          )}
        </div>
      )}
      <div className="ed-workbench-status">
        <span role="status">
          {notice || (dirty ? "Unsaved draft" : active ? "Ready to edit" : "Project files")}
        </span>
        <span>UTF-8</span>
      </div>
    </section>
  );
}
