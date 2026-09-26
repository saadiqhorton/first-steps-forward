import { useCallback, useEffect, useState } from "react";

/**
 * ADE's own folder picker, used when no native dialog tool is installed on
 * the machine. Reads one directory level at a time from the local service
 * (GET /api/browse — directory names only, never file contents) and calls
 * onPick with the folder the user chooses.
 */
export function FolderBrowser({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (path: string) => void;
}) {
  const [current, setCurrent] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showHidden, setShowHidden] = useState(false);

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
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a project folder"
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg bg-panel p-5 ring-1 ring-ink/10">
        <div className="label-mono">Choose a folder</div>
        <p className="mt-1 font-mono text-[12px] break-all text-ink">{current || "…"}</p>

        <div className="mt-3 flex items-center gap-2">
          <button
            disabled={!parent || loading}
            onClick={() => void load(parent ?? undefined)}
            className="btn-quiet px-3 py-1.5 text-[12px]"
          >
            ↑ Up one level
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

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-md border border-line bg-paper">
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
          <p className="mt-2 text-[11px] text-dim">
            You can still use the folder shown above if it is the right one.
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            disabled={loading || (!current && !error)}
            onClick={() => onPick(current)}
            className="btn-amber px-4 py-2 text-[13px]"
          >
            Use this folder
          </button>
          <button onClick={onClose} className="btn-quiet px-4 py-2 text-[13px]">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
