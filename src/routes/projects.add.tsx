import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAde } from "@/lib/ade/store";

export const Route = createFileRoute("/projects/add")({
  head: () => ({ meta: [{ title: "Add project — ADE" }] }),
  component: AddProject,
});
function AddProject() {
  const { addProject } = useAde();
  const navigate = useNavigate();
  const [path, setPath] = useState("");
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const finalName = custom || name;
  const browse = async () => {
    setError("");
    try {
      const r = await fetch("/api/pick-folder");
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      if (v.path) setPath(v.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const submit = async () => {
    if (!path.trim() || !finalName || busy) return;
    setBusy(true);
    setError("");
    try {
      await addProject(finalName, path.trim());
      navigate({ to: "/" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-xl px-7 pt-8">
        <div className="label-mono">Add project</div>
        <h1 className="mt-1 font-display text-[44px] leading-[0.9]">Point ADE at a folder</h1>
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
          <button onClick={() => navigate({ to: "/" })} className="btn-quiet px-4 py-2 text-[13px]">
            Cancel
          </button>
        </div>
      </div>
    </main>
  );
}
