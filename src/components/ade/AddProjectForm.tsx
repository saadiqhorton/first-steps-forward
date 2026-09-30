import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FolderBrowser } from "@/components/ade/FolderBrowser";
import { useAde } from "@/lib/ade/store";

export function AddProjectForm({
  onDone,
  onCancel,
}: {
  onDone: (projectId: string) => void;
  onCancel?: () => void;
}) {
  const { addProject } = useAde();
  const navigate = useNavigate();
  const [path, setPath] = useState("");
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const finalName = custom || name;
  const embedded = typeof onCancel === "function";
  // Prefer the OS's own dialog when a picker tool is installed; otherwise
  // fall back to ADE's built-in browser so the button always works.
  const browse = async () => {
    setError("");
    try {
      const response = await fetch("/api/pick-folder");
      const value = await response.json();
      if (response.ok && value.path) {
        setPath(value.path);
        return;
      }
      throw new Error(value.error ?? "Native picker unavailable");
    } catch {
      setBrowsing(true);
    }
  };
  const submit = async () => {
    if (!path.trim() || !finalName || busy) return;
    setBusy(true);
    setError("");
    try {
      const project = await addProject(finalName, path.trim());
      onDone(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    if (onCancel) onCancel();
    else void navigate({ to: "/" });
  };

  if (browsing) {
    return (
      <FolderBrowser
        onClose={() => setBrowsing(false)}
        onPick={(picked) => {
          setPath(picked);
          setBrowsing(false);
        }}
      />
    );
  }

  return (
    <div
      className={
        embedded ? "w-full px-6 pb-6 pt-6 pr-12" : "mx-auto w-full max-w-xl px-7 pb-8 pt-8"
      }
    >
      <div className="label-mono">Add project</div>
      <h1
        className={
          embedded
            ? "mt-1 font-display text-3xl leading-tight tracking-wide"
            : "mt-1 font-display text-[44px] leading-[0.9]"
        }
      >
        Point ADE at a folder
      </h1>
      <p className="mt-2 text-[13px] text-dim">
        A local directory on this machine. Project files stay in place; ADE stores only workspace
        metadata under ~/.ade.
      </p>
      <label className="label-mono mt-6 block" htmlFor="path">
        Folder path
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="path"
          autoFocus
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder="~/work/my-app"
          className="min-w-0 flex-1 rounded-md border border-line bg-panel px-3 py-2.5 font-mono text-[13px] placeholder:text-dim/70"
        />
        <button onClick={() => void browse()} className="btn-quiet shrink-0 px-3 text-[12px]">
          Browse…
        </button>
      </div>
      <label className="label-mono mt-4 block" htmlFor="name">
        Display name
      </label>
      <input
        id="name"
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        placeholder={name || "Taken from the folder name"}
        className="mt-2 w-full rounded-md border border-line bg-panel px-3 py-2.5 text-[13px]"
      />
      {error && <p className="mt-4 rounded bg-danger/10 p-3 text-[12px] text-danger">{error}</p>}
      <div className="mt-6 flex gap-2">
        <button
          onClick={() => void submit()}
          disabled={!path.trim() || !finalName || busy}
          className="btn-amber px-4 py-2 text-[13px]"
        >
          {busy ? "Adding…" : `Add ${finalName || "project"}`}
        </button>
        <button onClick={cancel} className="btn-quiet px-4 py-2 text-[13px]">
          Cancel
        </button>
      </div>
    </div>
  );
}
