import { Check, ChevronDown, ChevronRight, Folder, FolderOpen, Search, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  editorFileIcon,
  listEditorEntries,
  searchEditorFiles,
  type EditorEntry,
} from "../HostEditorPane";
import "../host-editor.css";

type Props = {
  projectId: string;
  activePath: string | null;
  dirtyPaths: ReadonlySet<string>;
  homeActive: boolean;
  onOpenFile: (path: string) => void;
  onGoHome: () => void;
};

export function FilesExplorer({
  projectId,
  activePath,
  dirtyPaths,
  homeActive,
  onOpenFile,
  onGoHome,
}: Props) {
  const [directories, setDirectories] = useState<Record<string, EditorEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EditorEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

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
    setDirectories({});
    setExpanded(new Set());
    setQuery("");
    setResults([]);
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
          aria-selected={activePath === entry.path}
          key={entry.path}
          className={`ed-tree-row ed-file ${activePath === entry.path ? "is-active" : ""}`}
          style={{ paddingLeft: `${25 + depth * 13}px` }}
          onClick={() => onOpenFile(entry.path)}
          title={entry.path}
        >
          {editorFileIcon(entry.path)}
          <span>{entry.name}</span>
          {dirtyPaths.has(entry.path) && (
            <span className="ed-dirty-dot" aria-label="Unsaved changes" />
          )}
        </button>
      ),
    );
  };

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col border-r border-line bg-panel">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="label-mono">Explorer</h2>
      </div>
      <button
        type="button"
        onClick={onGoHome}
        className={`flex items-center gap-2 border-b border-line px-3 py-2 text-left font-mono text-[11px] ${
          homeActive ? "bg-amber/10 text-ink" : "text-dim hover:bg-ink/5 hover:text-ink"
        }`}
      >
        {homeActive ? <Check size={12} aria-hidden /> : <Folder size={12} aria-hidden />}
        Files home
      </button>
      <div className="flex min-h-0 flex-1 flex-col px-2 pt-2">
        <label className="ed-search text-ink">
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
                  aria-selected={activePath === entry.path}
                  key={entry.path}
                  className={`ed-tree-row ed-file ${activePath === entry.path ? "is-active" : ""}`}
                  style={{ paddingLeft: 12 }}
                  onClick={() => onOpenFile(entry.path)}
                  title={entry.path}
                >
                  {editorFileIcon(entry.path)}
                  <span>{entry.path}</span>
                  {dirtyPaths.has(entry.path) && (
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
      {error && (
        <div
          role="alert"
          className="shrink-0 border-t border-line px-3 py-2 font-mono text-[10px] text-amber"
        >
          {error}
        </div>
      )}
    </aside>
  );
}
