import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { entriesQuery } from "@/lib/ade/queries";
import { searchEditorFiles, type EditorEntry } from "@/lib/ade/editorApi";
import { editorFileIcon } from "./editorIcons";
import "../host-editor.css";

type Props = {
  projectId: string;
  activePath: string | null;
  dirtyPaths: ReadonlySet<string>;
  homeActive: boolean;
  revealFolder: string | null;
  entriesRevision: number;
  onOpenFile: (path: string) => void;
  onGoHome: () => void;
  onCreateFile: (path: string) => Promise<void>;
  onRemoveFile: (path: string) => Promise<boolean>;
};

export function FilesExplorer({
  projectId,
  activePath,
  dirtyPaths,
  homeActive,
  revealFolder,
  entriesRevision,
  onOpenFile,
  onGoHome,
  onCreateFile,
  onRemoveFile,
}: Props) {
  const queryClient = useQueryClient();
  const cachedRoot = () => {
    const root = queryClient.getQueryData(entriesQuery(projectId).queryKey);
    return root ? { "": root } : {};
  };
  const [directories, setDirectories] = useState<Record<string, EditorEntry[]>>(cachedRoot);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EditorEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const loadDirectory = useCallback(
    async (directory: string) => {
      setLoadingFolders((previous) => new Set(previous).add(directory));
      try {
        const entries = await queryClient.fetchQuery(entriesQuery(projectId, directory));
        setDirectories((previous) => ({ ...previous, [directory]: entries }));
        setError("");
        return entries;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        return [] as EditorEntry[];
      } finally {
        setLoadingFolders((previous) => {
          const next = new Set(previous);
          next.delete(directory);
          return next;
        });
      }
    },
    [projectId, queryClient],
  );

  useEffect(() => {
    const root = queryClient.getQueryData(entriesQuery(projectId).queryKey);
    setDirectories(root ? { "": root } : {});
    setExpanded(new Set());
    setQuery("");
    setResults([]);
    void loadDirectory("");
  }, [loadDirectory, projectId, queryClient]);

  useEffect(() => {
    if (!entriesRevision) return;
    let cancelled = false;
    void (async () => {
      for (const folder of ["", ...expandedRef.current]) {
        if (cancelled) return;
        await loadDirectory(folder);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entriesRevision, loadDirectory, projectId, queryClient]);

  // Expand ancestor folders when Home (or elsewhere) asks to reveal a path.
  useEffect(() => {
    if (revealFolder == null) return;
    let cancelled = false;
    void (async () => {
      const parts = revealFolder.split("/").filter(Boolean);
      const ancestors = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
      setExpanded((previous) => {
        const next = new Set(previous);
        for (const path of ancestors) next.add(path);
        return next;
      });
      // Always load each ancestor so nested children render after expand.
      for (const path of ["", ...ancestors]) {
        if (cancelled) return;
        await loadDirectory(path);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [revealFolder, loadDirectory]);

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

  const submitCreate = async () => {
    const path = fileName.trim().replace(/^\/+/, "");
    if (!path || saving) return;
    setSaving(true);
    try {
      await onCreateFile(path);
      setFileName("");
      setCreating(false);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const removeFile = async (path: string) => {
    try {
      const removed = await onRemoveFile(path);
      if (!removed) return;
      setResults((previous) => previous.filter((entry) => entry.path !== path));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const fileRow = (entry: EditorEntry, depth: number, label = entry.name) => (
    <div
      key={entry.path}
      role="treeitem"
      aria-selected={activePath === entry.path}
      className={`ed-tree-row ed-file ${activePath === entry.path ? "is-active" : ""}`}
      style={{ paddingLeft: `${depth}px` }}
    >
      <button
        type="button"
        className="ed-tree-open"
        onClick={() => onOpenFile(entry.path)}
        title={entry.path}
      >
        {editorFileIcon(entry.path)}
        <span>{label}</span>
        {dirtyPaths.has(entry.path) && (
          <span className="ed-dirty-dot" aria-label="Unsaved changes" />
        )}
      </button>
      <button
        type="button"
        className="ed-tree-remove"
        aria-label={`Delete ${entry.path}`}
        title="Delete file"
        onClick={() => void removeFile(entry.path)}
      >
        <Trash2 size={12} aria-hidden />
      </button>
    </div>
  );

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
              {loadingFolders.has(entry.path) && !directories[entry.path] ? (
                <div className="ed-tree-empty">Reading folder…</div>
              ) : (
                renderEntries(entry.path, depth + 1)
              )}
            </div>
          )}
        </div>
      ) : (
        fileRow(entry, 25 + depth * 13)
      ),
    );
  };

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col border-r border-line bg-panel">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="label-mono">Explorer</h2>
        <button
          type="button"
          aria-label="New file"
          title="New file"
          aria-expanded={creating}
          onClick={() => setCreating((open) => !open)}
          className="grid size-7 place-items-center rounded-md text-dim hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-amber"
        >
          <Plus className="size-4" aria-hidden strokeWidth={2} />
        </button>
      </div>
      {creating && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitCreate();
          }}
          className="flex flex-wrap items-center gap-2 border-b border-line px-2 py-2"
        >
          <label className="ed-search w-full text-ink">
            <input
              aria-label="New file name"
              placeholder="name.txt"
              value={fileName}
              autoFocus
              onChange={(event) => setFileName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setCreating(false);
                  setFileName("");
                }
              }}
            />
          </label>
          <button
            type="submit"
            disabled={saving || !fileName.trim()}
            className="shrink-0 font-mono text-[11px] text-ink hover:underline disabled:opacity-40"
          >
            Create
          </button>
        </form>
      )}
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
              results.map((entry) => fileRow(entry, 12, entry.path))
            ) : (
              <div className="ed-tree-empty">No matching files</div>
            )
          ) : directories[""]?.length ? (
            renderEntries("")
          ) : loadingFolders.has("") ? (
            <div className="ed-tree-empty">Reading project…</div>
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
