import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAde } from "@/lib/ade/store";

export const Route = createFileRoute("/projects/add")({
  head: () => ({
    meta: [
      { title: "Add project — ADE" },
      { name: "description", content: "Point ADE at a local repository. No boards, no config files, no ADE-specific structure required." },
      { property: "og:title", content: "Add project — ADE" },
      { property: "og:description", content: "Add a local repository to your workspace." },
    ],
  }),
  component: AddProject,
});

function AddProject() {
  const { addProject } = useAde();
  const navigate = useNavigate();
  const [path, setPath] = useState("");
  const name = path.split("/").filter(Boolean).pop() ?? "";
  const [custom, setCustom] = useState("");
  const finalName = custom || name;

  const submit = () => {
    if (!path.trim() || !finalName) return;
    addProject(finalName, path.trim());
    navigate({ to: "/" });
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-xl px-7 pt-8">
        <div className="label-mono">Add project</div>
        <h1 className="mt-1 font-display text-[44px] leading-[0.9] tracking-wide">Point ADE at a folder</h1>
        <p className="mt-2 text-[13px] text-dim">Any local Git repository works as-is. ADE keeps its session records outside the repo and won't add files to it unless you ask.</p>

        <label className="label-mono mt-6 block" htmlFor="path">
          Folder path
        </label>
        <input
          id="path"
          autoFocus
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="~/work/my-app"
          className="mt-2 w-full rounded-md border border-line bg-panel px-3 py-2.5 font-mono text-[13px] placeholder:text-dim/70 focus:border-amber"
        />
        <label className="label-mono mt-4 block" htmlFor="name">
          Display name
        </label>
        <input
          id="name"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder={name || "Taken from the folder name"}
          className="mt-2 w-full rounded-md border border-line bg-panel px-3 py-2.5 text-[13px] placeholder:text-dim/70 focus:border-amber"
        />
        <div className="mt-6 flex gap-2">
          <button onClick={submit} disabled={!path.trim() || !finalName} className="btn-amber px-4 py-2 text-[13px]">
            Add {finalName || "project"}
          </button>
          <button onClick={() => navigate({ to: "/" })} className="btn-quiet px-4 py-2 text-[13px]">
            Cancel
          </button>
        </div>
      </div>
    </main>
  );
}
