// What Git says about a project: branch, uncommitted files, the diff, and the
// files it tracks. A project is usually one repository, but the selected
// folder may instead hold repositories one level down (project/code/.git);
// paths stay relative to the selected folder either way, so the UI,
// manifests, and diff views all refer to the same files.
import { promises as fs } from "node:fs";
import path from "node:path";
import { runCommand } from "./spawn.mjs";

async function gitAt(directory, args) {
  return runCommand("git", ["-C", directory, ...args], { timeout: 10000 });
}

/** The repositories that make up a project, each with its path prefix. */
export async function gitRepositories(project) {
  const root = await gitAt(project.path, ["rev-parse", "--show-toplevel"]);
  if (root.code === 0) return [{ directory: project.path, prefix: "" }];
  let entries;
  try {
    entries = await fs.readdir(project.path, { withFileTypes: true });
  } catch {
    return [];
  }
  const repositories = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(project.path, entry.name);
    try {
      await fs.stat(path.join(directory, ".git"));
    } catch {
      continue;
    }
    const found = await gitAt(directory, ["rev-parse", "--show-toplevel"]);
    if (found.code === 0 && path.resolve(found.stdout.trim()) === path.resolve(directory))
      repositories.push({ directory, prefix: `${entry.name}/` });
  }
  return repositories;
}

/**
 * Refresh the project's folder and Git facts in place (missing, branch,
 * uncommittedFiles, ahead) and return a copy.
 */
export async function projectInfo(project) {
  try {
    await fs.stat(project.path);
    project.missing = false;
  } catch {
    project.missing = true;
    project.branch = "folder missing";
    project.uncommittedFiles = [];
    project.ahead = 0;
    return { ...project };
  }
  const repositories = await gitRepositories(project);
  const changedFiles = [];
  const branches = [];
  let ahead = 0;
  for (const repo of repositories) {
    const [branchRes, statusRes, aheadRes] = await Promise.all([
      gitAt(repo.directory, ["branch", "--show-current"]),
      gitAt(repo.directory, ["status", "--porcelain=v1", "-uall"]),
      gitAt(repo.directory, ["rev-list", "--count", "@{upstream}..HEAD"]),
    ]);
    branches.push(branchRes.code === 0 ? branchRes.stdout.trim() || "(detached)" : "unknown");
    changedFiles.push(
      ...statusRes.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => `${repo.prefix}${line.slice(3)}`),
    );
    if (aheadRes.code === 0) ahead += Number(aheadRes.stdout.trim()) || 0;
  }
  project.branch =
    branches.length === 0
      ? "not a git repository"
      : branches.length === 1
        ? branches[0]
        : `${branches.length} repositories`;
  project.uncommittedFiles = [...new Set(changedFiles)];
  project.ahead = ahead;
  return { ...project };
}

/** The project's uncommitted changes: unified diff, status per file, and per-file hunks. */
export async function getDiff(project) {
  const repositories = await gitRepositories(project);
  const diffs = [];
  const files = [];
  const changes = [];
  for (const repo of repositories) {
    const [tracked, names] = await Promise.all([
      gitAt(repo.directory, ["diff", "HEAD", "--no-ext-diff", "--unified=3"]),
      gitAt(repo.directory, ["status", "--porcelain=v1", "-uall"]),
    ]);
    const diff = tracked.stdout;
    diffs.push(diff);
    let current;
    for (const line of diff.split(/\r?\n/)) {
      if (line.startsWith("diff --git ")) {
        const filePath =
          line.match(/ (?:b|w)\/(.*)$/)?.[1] ??
          line.slice("diff --git ".length).split(/\s+/).at(-1);
        current = { path: `${repo.prefix}${filePath}`, added: 0, removed: 0, hunk: [] };
        changes.push(current);
      } else if (current && line.startsWith("@@")) current.hunk.push(line);
      else if (current && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
        current.hunk.push(line);
        if (line.startsWith("+") && !line.startsWith("+++")) current.added++;
        if (line.startsWith("-") && !line.startsWith("---")) current.removed++;
      }
    }
    for (const line of names.stdout.split(/\r?\n/).filter(Boolean)) {
      const file = { status: line.slice(0, 2).trim(), path: `${repo.prefix}${line.slice(3)}` };
      files.push(file);
      if (changes.some((change) => change.path === file.path)) continue;
      const absolute = path.resolve(project.path, file.path);
      const rel = path.relative(project.path, absolute);
      let hunk = [
        `${file.status || "??"} · diff unavailable (binary, oversized, or unreadable file)`,
      ];
      let added = 0;
      if (
        file.status === "??" &&
        rel &&
        !rel.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(rel)
      ) {
        try {
          const stat = await fs.lstat(absolute);
          if (stat.isFile() && stat.size <= 262144) {
            const content = await fs.readFile(absolute);
            if (!content.includes(0)) {
              const lines = content.toString("utf8").split(/\r?\n/);
              added = lines.filter(
                (line, index) => index < lines.length - 1 || line.length > 0,
              ).length;
              hunk = ["@@ added file @@", ...lines.map((line) => `+${line}`)];
            }
          }
        } catch {}
      }
      changes.push({ path: file.path, added, removed: 0, hunk });
    }
  }
  return { diff: diffs.join("\n"), files, changes };
}

/** Files Git tracks or would track (untracked, not ignored), across the project's repositories. */
export async function projectFiles(project) {
  const repositories = await gitRepositories(project);
  const lists = await Promise.all(
    repositories.map(async (repo) => {
      const tracked = await gitAt(repo.directory, ["ls-files", "-co", "--exclude-standard"]);
      return tracked.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((file) => `${repo.prefix}${file}`);
    }),
  );
  return lists.flat();
}
