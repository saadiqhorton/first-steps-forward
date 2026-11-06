import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ADE's own folder picker, used when no native dialog tool is installed on
 * the machine. Reads one directory level at a time from the local service
 * (GET /api/browse — directory names only, never file contents) and calls
 * onPick with the folder the user chooses.
 *
 * "New folder" makes one (POST /api/mkdir) in the folder being viewed, so a
 * clone or new project can be given a fresh destination without leaving here.
 *
 * Rendered as an in-dialog panel (not a nested overlay). Nesting a second
 * Radix Dialog on top of Add Project left the wider parent chrome and its
 * scrollbar visible around the picker, which looked broken and clipped the
 * footer actions.
 */
export function FolderBrowser({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (path: string) => void;
}) {
  const [current, setCurrent] = useState("");
  const currentRef = useRef("");
  const [parent, setParent] = useState<string | null>(null);
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [nameError, setNameError] = useState("");
  const [making, setMaking] = useState(false);

  const load = useCallback(
    async (target?: string, hidden = showHidden) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (target) params.set("path", target);
        if (hidden) params.set("hidden", "1");
        const response = await fetch(`/api/browse${params.size ? `?${params}` : ""}`);
        const value = await response.json();
        if (!response.ok) throw new Error(value.error ?? `Browse failed (${response.status})`);
        setCurrent(value.path);
        currentRef.current = value.path;
        setParent(value.parent);
        setDirs(value.dirs ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [showHidden],
  );

  useEffect(() => {
    void load(currentRef.current || undefined);
  }, [load]);

  const stopNaming = useCallback(() => {
    setNaming(false);
    setNewName("");
    setNameError("");
  }, []);

  const makeFolder = async () => {
    const name = newName.trim();
    if (!name || making) return;
    setMaking(true);
    setNameError("");
    try {
      const response = await fetch("/api/mkdir", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parent: current, name }),
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error ?? `Could not create the folder (${response.status})`);
      stopNaming();
      await load(value.path);
    } catch (e) {
      setNameError(e instanceof Error ? e.message : String(e));
    } finally {
      setMaking(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        // Escape first dismisses the name field, then the picker itself.
        if (naming) stopNaming();
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, naming, stopNaming]);

  return (
    <div className="flex w-full flex-col px-6 pb-6 pt-6 pr-12" aria-label="Choose a project folder">
      <div className="shrink-0 space-y-1 text-left">
        <div className="label-mono text-[11px] font-normal tracking-wide text-dim">
          Choose a folder
        </div>
        <p className="font-mono text-[12px] break-all text-ink">{current || "…"}</p>
      </div>

      <div className="mt-3 flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={!parent || loading}
          onClick={() => void load(parent ?? undefined)}
          className="btn-quiet px-3 py-1.5 text-[12px]"
        >
          ↑ Up one level
        </button>
        <button
          type="button"
          disabled={!current || loading || !!error}
          onClick={() => setNaming(true)}
          className="btn-quiet px-3 py-1.5 text-[12px]"
        >
          New folder
        </button>
        <label className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-dim">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => {
              setShowHidden(e.target.checked);
              void load(current, e.target.checked);
            }}
            className="accent-amber"
          />
          Hidden folders
        </label>
      </div>

      {naming && (
        <form
          className="mt-2 shrink-0"
          onSubmit={(e) => {
            e.preventDefault();
            void makeFolder();
          }}
        >
          <div className="flex gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              aria-label="New folder name"
              placeholder="New folder name"
              className="min-w-0 flex-1 rounded-md border border-line bg-panel px-3 py-1.5 font-mono text-[12.5px] placeholder:text-dim/70"
            />
            <button
              type="submit"
              disabled={!newName.trim() || making}
              className="btn-amber shrink-0 px-3 py-1.5 text-[12px]"
            >
              {making ? "Creating…" : "Create"}
            </button>
          </div>
          {nameError && <p className="mt-1.5 text-[11px] text-danger">{nameError}</p>}
        </form>
      )}

      {/* Explicit max-height keeps Use/Cancel visible; flex-1 alone can push
          the footer past the parent dialog's max-height and clip it. */}
      <div className="mt-2 max-h-[min(50vh,22rem)] min-h-[12rem] overflow-y-auto overscroll-contain rounded-md border border-line bg-paper">
        {loading ? (
          <p className="px-3 py-3 text-[12px] text-dim">Reading folders…</p>
        ) : error ? (
          <p className="px-3 py-3 text-[12px] text-danger">{error}</p>
        ) : dirs.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-dim">
            No subfolders here — you can use this folder as-is.
          </p>
        ) : (
          <ul>
            {dirs.map((dir) => (
              <li key={dir.path}>
                <button
                  type="button"
                  onClick={() => void load(dir.path)}
                  className="w-full truncate px-3 py-1.5 text-left font-mono text-[12.5px] hover:bg-ink/[0.04]"
                >
                  {dir.name}/
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && !loading && current && (
        <p className="mt-2 shrink-0 text-[11px] text-dim">
          You can still use the folder shown above if it is the right one.
        </p>
      )}

      <div className="mt-4 flex shrink-0 gap-2">
        <button
          type="button"
          disabled={loading || (!current && !error)}
          onClick={() => onPick(current)}
          className="btn-amber px-4 py-2 text-[13px]"
        >
          Use this folder
        </button>
        <button type="button" onClick={onClose} className="btn-quiet px-4 py-2 text-[13px]">
          Cancel
        </button>
      </div>
    </div>
  );
}
