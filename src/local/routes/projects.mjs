import { isHiddenProject } from "../customize/paths.mjs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand as run } from "../spawn.mjs";
import { adapters } from "../adapters/index.mjs";
import { getDiff, projectInfo } from "../project-git.mjs";
import { checksFor } from "../project-scripts.mjs";
import {
  cloneRepository,
  createProjectFolder,
  expandUserPath,
  makeDirectory,
  parseRepoSource,
} from "../project-sources.mjs";
import { body } from "../http.mjs";
import { browserScope } from "../browser-scope.mjs";
import { browserProfiles, browserProfileStorageKey } from "../browser-profiles.mjs";

/** Folder picking, and `/api/projects`: add (by path, clone or new folder), remove, diff, checks. */
export async function projects(ctx) {
  const {
    req,
    res,
    parts,
    sessionLogs,
    state,
    browserContexts,
    browserSessionStore,
    devServers,
    controls,
    computers,
    turns,
    save,
    json,
  } = ctx;
  if (req.method === "GET" && parts[0] === "browse") {
    // Read-only directory listing for ADE's built-in folder picker. Same
    // loopback/origin guards as every other route; never exposes file
    // contents, only directory names one level at a time.
    const query = new URL(req.url, "http://127.0.0.1").searchParams;
    const expanded = expandUserPath(query.get("path") || os.homedir(), os.homedir());
    let real;
    try {
      real = await fs.realpath(expanded);
    } catch {
      return json(res, 400, { error: "That path does not exist." });
    }
    const stat = await fs.stat(real);
    if (!stat.isDirectory()) return json(res, 400, { error: "That path is not a directory." });
    const showHidden = query.get("hidden") === "1";
    const dirents = await fs.readdir(real, { withFileTypes: true });
    const dirs = dirents
      .filter((entry) => entry.isDirectory() && (showHidden || !entry.name.startsWith(".")))
      .map((entry) => ({ name: entry.name, path: path.join(real, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = path.dirname(real);
    return json(res, 200, {
      path: real,
      parent: parent === real ? null : parent,
      dirs,
    });
  }
  if (req.method === "GET" && parts[0] === "pick-folder") {
    const choices =
      process.platform === "darwin"
        ? [["osascript", ["-e", "POSIX path of (choose folder)"]]]
        : process.platform === "win32"
          ? [
              [
                "powershell",
                [
                  "-NoProfile",
                  "-Command",
                  "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; if($d.ShowDialog() -eq 'OK'){$d.SelectedPath}",
                ],
              ],
            ]
          : [
              [
                "zenity",
                ["--file-selection", "--directory", "--title=Choose a project folder for ADE"],
              ],
              ["kdialog", ["--getexistingdirectory", os.homedir()]],
            ];
    for (const [bin, args] of choices) {
      const picked = await run(bin, args, { timeout: 120000 });
      if (picked.code === 0 && picked.stdout.trim())
        return json(res, 200, { path: picked.stdout.trim() });
      if (process.platform !== "linux") break;
    }
    return json(res, 501, {
      error:
        "No supported native folder picker was found. Enter the absolute local folder path instead.",
    });
  }
  if (req.method === "POST" && parts[0] === "mkdir" && parts.length === 1) {
    // Lets the folder picker make the destination folder it is about to use.
    const data = await body(req);
    const created = await makeDirectory({
      parent: data.parent,
      name: data.name,
      home: os.homedir(),
    });
    return json(res, 201, { path: created });
  }
  if (req.method === "POST" && parts[0] === "projects" && parts.length === 1) {
    const data = await body(req);
    const requested = String(data.path ?? "").trim();
    if (!requested) return json(res, 400, { error: "Choose a local folder path." });
    const real = await fs.realpath(expandUserPath(requested, os.homedir()));
    const stat = await fs.stat(real);
    if (!stat.isDirectory()) return json(res, 400, { error: "That path is not a directory." });
    return registerProject(ctx, real, data.name);
  }
  if (req.method === "POST" && parts[0] === "projects" && parts[1] === "clone") {
    const data = await body(req);
    const source = parseRepoSource(data.url);
    if (!source.ok) return json(res, 400, { error: source.error });
    const created = await cloneRepository({
      run,
      url: source.url,
      parent: data.parent,
      name: data.name?.trim?.() || source.name,
      home: os.homedir(),
    });
    return registerProject(ctx, await fs.realpath(created), data.name || source.name);
  }
  if (req.method === "POST" && parts[0] === "projects" && parts[1] === "create") {
    const data = await body(req);
    const created = await createProjectFolder({
      run,
      parent: data.parent,
      name: data.name,
      git: data.git !== false,
      home: os.homedir(),
    });
    return registerProject(ctx, await fs.realpath(created), data.name);
  }
  if (req.method === "POST" && parts[0] === "projects" && parts[2] === "default-agent") {
    const project = state.projects.find((p) => p.id === parts[1]);
    const data = await body(req);
    if (!project || !Object.hasOwn(adapters, String(data.agentId)))
      return json(res, 400, { error: "Choose a supported agent and project." });
    project.defaultAgent = data.agentId;
    await save();
    return json(res, 200, project);
  }
  if (req.method === "POST" && parts[0] === "projects" && parts[2] === "remove") {
    const idx = state.projects.findIndex((p) => p.id === parts[1]);
    if (idx === -1 || isHiddenProject(state.projects[idx]))
      return json(res, 404, { error: "Project not found." });
    const busy =
      state.sessions.some((s) => s.projectId === parts[1] && turns.isBusy(s)) ||
      devServers.hasRunning(parts[1]);
    if (busy)
      return json(res, 409, {
        error: "Stop the running agent or dev process before removing this project.",
      });
    const removedSessions = state.sessions.filter((s) => s.projectId === parts[1]);
    // Browser state belongs to the project even when tabs use a conversation scope or
    // a named profile. Close all scopes before removing their snapshots and profile data.
    const scopes = [
      parts[1],
      ...removedSessions.map((session) => browserScope(parts[1], session.id)),
    ];
    await Promise.all(scopes.map((scope) => computers.stop(scope).catch(() => {})));
    await Promise.all(scopes.map((scope) => controls.delete(scope)));
    await Promise.all(scopes.map((scope) => browserSessionStore?.remove(scope)));
    await Promise.all(
      browserProfiles(state.projects[idx])
        .filter((profile) => profile.id !== "incognito")
        .map((profile) =>
          browserContexts.clearProfile(browserProfileStorageKey(parts[1], profile.id)),
        ),
    );
    state.projects.splice(idx, 1);
    state.sessions = state.sessions.filter((s) => s.projectId !== parts[1]);
    state.deletedProjects ??= {};
    state.deletedProjects[parts[1]] = ctx.now?.() ?? Date.now();
    await Promise.all(removedSessions.map((session) => sessionLogs.remove(session.id)));
    state.processes = state.processes.filter((x) => x.projectId !== parts[1]);
    ctx.devApprovals.cancelForProject(parts[1]);
    await save();
    return json(res, 200, {
      removed: parts[1],
      note: "Only ADE metadata was removed. The project folder and its files were not touched.",
    });
  }
  if (req.method === "GET" && parts[0] === "projects" && parts[2] === "diff") {
    const project = state.projects.find((p) => p.id === parts[1]);
    if (!project) return json(res, 404, { error: "Project not found." });
    return json(res, 200, await getDiff(project));
  }
  if (req.method === "GET" && parts[0] === "projects" && parts[2] === "checks") {
    const project = state.projects.find((p) => p.id === parts[1]);
    if (!project) return json(res, 404, { error: "Project not found." });
    return json(res, 200, { checks: await checksFor(project) });
  }
  return ctx.handled || res.writableEnded;
}
// Registers an existing directory as a project and answers the request. Shared
// by "add a folder", "clone a repository" and "create a folder".
async function registerProject(ctx, real, name) {
  const { res, state, save, id, now, devServers, json } = ctx;
  if (state.projects.some((p) => p.path === real))
    return json(res, 409, { error: "This project is already added." });
  const project = {
    id: id(),
    name: String(name || path.basename(real)),
    path: real,
    branch: "",
    ahead: 0,
    uncommittedFiles: [],
    defaultAgent: "codex",
    addedAt: now(),
  };
  await projectInfo(project);
  state.projects.push(project);
  // Same detection path as the bootstrap re-scan: an unreadable or
  // malformed package.json records a distinct note instead of silently
  // reporting no dev script.
  const { proc } = await devServers.refreshDevProcess(project);
  await save();
  return json(res, 201, { project, process: proc });
}
