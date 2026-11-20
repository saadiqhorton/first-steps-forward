import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FolderBrowser } from "@/components/ade/FolderBrowser";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAde } from "@/lib/ade/store";

type Mode = "folder" | "clone" | "new";
// Which path field the folder picker is currently filling in.
type PathField = "folder" | "parent";

const DESCRIPTIONS: Record<Mode, string> = {
  folder:
    "A local directory on this machine. Project files stay in place; ADE stores only workspace metadata under ~/.ade.",
  clone:
    "Clone a Git repository into a folder on this machine and add it. Use owner/repo, a GitHub URL, or an SSH address.",
  new: "Create a new folder on this machine and add it. ADE stores only workspace metadata under ~/.ade.",
};

// Mirrors the server's naming of a clone, so the preview matches what is made.
function repoNameOf(value: string) {
  const trimmed = value
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  const github = /github\.com[/:]([^/\s]+)\/([^/\s]+)/i.exec(trimmed);
  const last = github?.[2] ?? trimmed.split(/[/:]/).pop() ?? "";
  return last.replace(/\.git$/i, "");
}

const joinPath = (parent: string, name: string) =>
  `${parent.replace(/[\\/]+$/, "")}${parent.includes("\\") ? "\\" : "/"}${name}`;

const inputClass =
  "w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-ui placeholder:text-dim/70";

export function AddProjectForm({
  onDone,
  onCancel,
}: {
  onDone: (projectId: string) => void;
  onCancel?: () => void;
}) {
  const { addProject, cloneProject, createProject } = useAde();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("folder");
  const [path, setPath] = useState("");
  const [custom, setCustom] = useState("");
  const [repo, setRepo] = useState("");
  const [parent, setParent] = useState("");
  const [folderName, setFolderName] = useState("");
  const [initGit, setInitGit] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [browsing, setBrowsing] = useState<PathField | null>(null);
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const finalName = custom || name;
  const cloneFolder = folderName.trim() || repoNameOf(repo);
  const newFolder = folderName.trim();
  const embedded = typeof onCancel === "function";

  const ready =
    mode === "folder"
      ? !!path.trim() && !!finalName
      : mode === "clone"
        ? !!repo.trim() && !!parent.trim() && !!cloneFolder
        : !!parent.trim() && !!newFolder;

  const switchMode = (next: string) => {
    setMode(next as Mode);
    setError("");
  };
  const applyPicked = (field: PathField, picked: string) =>
    field === "folder" ? setPath(picked) : setParent(picked);
  // Prefer the OS's own dialog when a picker tool is installed; otherwise
  // fall back to ADE's built-in browser so the button always works.
  const browse = async (field: PathField) => {
    setError("");
    try {
      const response = await fetch("/api/pick-folder");
      const value = await response.json();
      if (response.ok && value.path) {
        applyPicked(field, value.path);
        return;
      }
      throw new Error(value.error ?? "Native picker unavailable");
    } catch {
      setBrowsing(field);
    }
  };
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const project =
        mode === "folder"
          ? await addProject(finalName, path.trim())
          : mode === "clone"
            ? await cloneProject(repo.trim(), parent.trim(), folderName.trim() || undefined)
            : await createProject(newFolder, parent.trim(), initGit);
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
        onClose={() => setBrowsing(null)}
        onPick={(picked) => {
          applyPicked(browsing, picked);
          setBrowsing(null);
        }}
      />
    );
  }

  const submitLabel = busy
    ? mode === "clone"
      ? "Cloning…"
      : mode === "new"
        ? "Creating…"
        : "Adding…"
    : mode === "clone"
      ? `Clone ${cloneFolder || "repository"}`
      : mode === "new"
        ? `Create ${newFolder || "project"}`
        : `Add ${finalName || "project"}`;

  const parentField = (label: string) => (
    <>
      <label className="label-mono mt-4 block" htmlFor="parent">
        {label}
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="parent"
          value={parent}
          onChange={(e) => setParent(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder="~/work"
          className={`min-w-0 flex-1 font-mono ${inputClass}`}
        />
        <button
          type="button"
          onClick={() => void browse("parent")}
          className="btn-quiet shrink-0 px-3 text-(length:--text-xs)"
        >
          Browse…
        </button>
      </div>
    </>
  );

  return (
    <div
      className={
        embedded
          ? "min-h-0 w-full overflow-y-auto px-6 pb-6 pt-6 pr-6 sm:pr-12"
          : "mx-auto w-full max-w-xl px-7 pb-8 pt-8"
      }
    >
      <h1 className={embedded ? "text-xl font-medium" : "heading-display text-3xl"}>
        Add a project
      </h1>
      <Tabs value={mode} onValueChange={switchMode} className="mt-4">
        <TabsList
          aria-label="Where the project comes from"
          className="grid h-auto w-full grid-cols-3 gap-1 sm:inline-flex sm:w-auto"
        >
          <TabsTrigger
            value="folder"
            className="min-h-9 min-w-0 px-2 text-xs focus-visible:ring-amber/60 focus-visible:ring-offset-paper sm:px-3 sm:text-sm"
          >
            Existing folder
          </TabsTrigger>
          <TabsTrigger
            value="clone"
            className="min-h-9 min-w-0 px-2 text-xs focus-visible:ring-amber/60 focus-visible:ring-offset-paper sm:px-3 sm:text-sm"
          >
            Clone from GitHub
          </TabsTrigger>
          <TabsTrigger
            value="new"
            className="min-h-9 min-w-0 px-2 text-xs focus-visible:ring-amber/60 focus-visible:ring-offset-paper sm:px-3 sm:text-sm"
          >
            New folder
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="mt-3 text-ui text-dim">{DESCRIPTIONS[mode]}</p>

      {mode === "folder" && (
        <>
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
              className={`min-w-0 flex-1 font-mono ${inputClass}`}
            />
            <button
              type="button"
              onClick={() => void browse("folder")}
              className="btn-quiet shrink-0 px-3 text-(length:--text-xs)"
            >
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
            className={`mt-2 ${inputClass}`}
          />
        </>
      )}

      {mode === "clone" && (
        <>
          <label className="label-mono mt-6 block" htmlFor="repo">
            Repository
          </label>
          <input
            id="repo"
            autoFocus
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="owner/repo or https://github.com/owner/repo"
            spellCheck={false}
            autoCapitalize="off"
            className={`mt-2 font-mono ${inputClass}`}
          />
          {parentField("Clone into")}
          <label className="label-mono mt-4 block" htmlFor="folder-name">
            Folder name
          </label>
          <input
            id="folder-name"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder={repoNameOf(repo) || "Taken from the repository name"}
            className={`mt-2 ${inputClass}`}
          />
          {parent.trim() && cloneFolder && (
            <p className="mt-3 break-all font-mono text-caption text-dim">
              → {joinPath(parent.trim(), cloneFolder)}
            </p>
          )}
          <p className="mt-3 text-caption text-dim">
            Private repository? Sign in once with <code className="font-mono">gh auth login</code>{" "}
            or use an SSH address — ADE never asks for or stores a password.
          </p>
        </>
      )}

      {mode === "new" && (
        <>
          {parentField("Create in")}
          <label className="label-mono mt-4 block" htmlFor="folder-name">
            Folder name
          </label>
          <input
            id="folder-name"
            autoFocus
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="my-app"
            className={`mt-2 ${inputClass}`}
          />
          {parent.trim() && newFolder && (
            <p className="mt-3 break-all font-mono text-caption text-dim">
              → {joinPath(parent.trim(), newFolder)}
            </p>
          )}
          <label className="mt-4 flex items-center gap-2 text-ui">
            <input
              type="checkbox"
              checked={initGit}
              onChange={(e) => setInitGit(e.target.checked)}
              className="accent-amber"
            />
            Initialize a Git repository
          </label>
        </>
      )}

      {error && (
        <p className="mt-4 rounded bg-danger/10 p-3 text-(length:--text-xs) text-danger">{error}</p>
      )}
      <div className="mt-6 flex gap-2">
        <button
          onClick={() => void submit()}
          disabled={!ready || busy}
          className="btn-amber px-4 py-2 text-ui"
        >
          {submitLabel}
        </button>
        <button onClick={cancel} disabled={busy} className="btn-quiet px-4 py-2 text-ui">
          Cancel
        </button>
      </div>
    </div>
  );
}
