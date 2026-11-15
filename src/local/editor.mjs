import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const MAX_FILE_BYTES = 512 * 1024;
const SEARCH_LIMIT = 80;
const SEARCH_SCAN_LIMIT = 5000;
const HIDDEN_SCAN_DIRS = new Set([
  ".git",
  ".next",
  ".output",
  ".pytest_cache",
  ".ruff_cache",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "venv",
]);
const DOCUMENT_SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".output",
  ".next",
  ".tanstack",
]);
const DOCUMENT_EXTENSIONS = new Set([".md", ".mdx"]);
export class EditorError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const versionOf = (content) => createHash("sha256").update(content).digest("hex");
const within = (root, target) => {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};
const toPosix = (value) => value.split(path.sep).join("/");

function validateRelative(relative) {
  if (typeof relative !== "string" || relative.length > 4096 || relative.includes("\0"))
    throw new EditorError(400, "Invalid file path.");
  if (relative === "" || relative === ".") return [];
  if (path.isAbsolute(relative) || relative.includes("\\") || /^[a-z]:/i.test(relative))
    throw new EditorError(400, "Choose a file inside the project.");
  const parts = relative.split("/");
  if (parts.some((part) => !part || part === "." || part === ".."))
    throw new EditorError(400, "Choose a file inside the project.");
  return parts;
}

async function resolveInside(projectPath, relative) {
  const parts = validateRelative(relative);
  let root;
  try {
    root = await fs.realpath(projectPath);
    if (!(await fs.stat(root)).isDirectory()) throw new Error("Not a directory");
  } catch {
    throw new EditorError(404, "The project folder is unavailable.");
  }
  const joined = path.join(root, ...parts);
  if (!within(root, joined)) throw new EditorError(400, "Choose a file inside the project.");
  let target;
  try {
    target = await fs.realpath(joined);
  } catch {
    throw new EditorError(404, "File or folder not found.");
  }
  if (!within(root, target))
    throw new EditorError(403, "Files outside this project cannot be opened.");
  return { root, target };
}

async function textFile(projectPath, relative) {
  const { target } = await resolveInside(projectPath, relative);
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    throw new EditorError(404, "File not found.");
  }
  if (!stat.isFile()) throw new EditorError(400, "Choose a file, not a folder.");
  if (stat.size > MAX_FILE_BYTES)
    throw new EditorError(413, "This file is too large for the editor (512 KB limit).");
  const bytes = await fs.readFile(target);
  if (bytes.length > MAX_FILE_BYTES)
    throw new EditorError(413, "This file is too large for the editor (512 KB limit).");
  if (bytes.includes(0)) throw new EditorError(415, "Binary files cannot be edited here.");
  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new EditorError(415, "Only UTF-8 text files can be edited here.");
  }
  return { target, stat, bytes, content };
}

export async function listEditorEntries(projectPath, relative = "") {
  const { root, target } = await resolveInside(projectPath, relative);
  if (!(await fs.stat(target)).isDirectory()) throw new EditorError(400, "Choose a folder.");
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries
    .filter((entry) => entry.name !== ".git" && !entry.isSymbolicLink())
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .map((entry) => ({
      name: entry.name,
      path: toPosix(path.relative(root, path.join(target, entry.name))),
      kind: entry.isDirectory() ? "folder" : "file",
    }))
    .sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1,
    );
}

export async function readEditorFile(projectPath, relative) {
  const { bytes, content } = await textFile(projectPath, relative);
  return { path: relative, content, version: versionOf(bytes) };
}

function rejectGit(parts) {
  if (parts.some((part) => part === ".git"))
    throw new EditorError(400, "Git internals cannot be changed here.");
}

async function projectRoot(projectPath) {
  let root;
  try {
    root = await fs.realpath(projectPath);
    if (!(await fs.stat(root)).isDirectory()) throw new Error("Not a directory");
  } catch {
    throw new EditorError(404, "The project folder is unavailable.");
  }
  return root;
}

async function parentDirectory(root, parts) {
  const parentJoined = path.join(root, ...parts.slice(0, -1));
  if (!within(root, parentJoined)) throw new EditorError(400, "Choose a file inside the project.");
  let parentReal;
  try {
    parentReal = await fs.realpath(parentJoined);
  } catch {
    throw new EditorError(404, "That folder does not exist.");
  }
  if (!within(root, parentReal))
    throw new EditorError(403, "Files outside this project cannot be opened.");
  const stat = await fs.lstat(parentReal);
  if (!stat.isDirectory()) throw new EditorError(400, "Choose a folder inside the project.");
  return parentReal;
}

export async function createEditorFile(projectPath, relative) {
  const parts = validateRelative(relative);
  if (!parts.length) throw new EditorError(400, "Choose a file name.");
  rejectGit(parts);
  const root = await projectRoot(projectPath);
  const parentReal = await parentDirectory(root, parts);
  const target = path.join(parentReal, parts.at(-1));
  if (!within(root, target)) throw new EditorError(400, "Choose a file inside the project.");
  try {
    await fs.lstat(target);
    throw new EditorError(409, "A file with that name already exists.");
  } catch (error) {
    if (error instanceof EditorError) throw error;
    if (error?.code !== "ENOENT") throw new EditorError(400, "Could not create that file.");
  }
  try {
    await fs.writeFile(target, "", { flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST")
      throw new EditorError(409, "A file with that name already exists.");
    throw new EditorError(400, "Could not create that file.");
  }
  return {
    path: toPosix(path.relative(root, target)),
    version: versionOf(Buffer.alloc(0)),
  };
}

export async function deleteEditorFile(projectPath, relative) {
  const parts = validateRelative(relative);
  if (!parts.length) throw new EditorError(400, "Choose a file.");
  rejectGit(parts);
  const root = await projectRoot(projectPath);
  const parentReal = await parentDirectory(root, parts);
  const target = path.join(parentReal, parts.at(-1));
  if (!within(root, target)) throw new EditorError(400, "Choose a file inside the project.");
  let info;
  try {
    info = await fs.lstat(target);
  } catch {
    throw new EditorError(404, "File not found.");
  }
  if (info.isSymbolicLink()) throw new EditorError(403, "Links cannot be removed here.");
  if (!info.isFile()) throw new EditorError(400, "Choose a file, not a folder.");
  await fs.unlink(target);
  return { ok: true, path: toPosix(path.relative(root, target)) };
}

export async function writeEditorFile(projectPath, relative, content, expectedVersion) {
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES)
    throw new EditorError(413, "Text must be 512 KB or smaller.");
  if (typeof expectedVersion !== "string" || !/^[a-f0-9]{64}$/.test(expectedVersion))
    throw new EditorError(400, "Open the file before saving it.");
  const current = await textFile(projectPath, relative);
  if (versionOf(current.bytes) !== expectedVersion)
    throw new EditorError(409, "This file changed on disk. Reload it before saving.");
  const staged = path.join(
    path.dirname(current.target),
    `.${path.basename(current.target)}.ade-${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(staged, content, { mode: current.stat.mode & 0o777 });
    await fs.chmod(staged, current.stat.mode & 0o777);
    await fs.rename(staged, current.target);
  } finally {
    await fs.rm(staged, { force: true }).catch(() => {});
  }
  return { path: relative, version: versionOf(Buffer.from(content, "utf8")) };
}

export async function searchEditorFiles(projectPath, query, { includeFolders = false } = {}) {
  if (typeof query !== "string" || query.length > 120)
    throw new EditorError(400, "Invalid search query.");
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const { root } = await resolveInside(projectPath, "");
  const folders = [root];
  const results = [];
  let scanned = 0;
  while (folders.length && results.length < SEARCH_LIMIT && scanned < SEARCH_SCAN_LIMIT) {
    const folder = folders.shift();
    let entries;
    try {
      entries = await fs.readdir(folder, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++scanned > SEARCH_SCAN_LIMIT || results.length >= SEARCH_LIMIT) break;
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(folder, entry.name);
      if (entry.isDirectory() && !HIDDEN_SCAN_DIRS.has(entry.name)) {
        folders.push(absolute);
        const relative = toPosix(path.relative(root, absolute));
        if (includeFolders && relative.toLowerCase().includes(needle))
          results.push({ name: entry.name, path: relative, kind: "folder" });
      } else if (entry.isFile()) {
        const relative = toPosix(path.relative(root, absolute));
        if (relative.toLowerCase().includes(needle))
          results.push({ name: entry.name, path: relative, kind: "file" });
      }
    }
  }
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

function shouldSkipDocumentDir(name) {
  return name.startsWith(".") || DOCUMENT_SKIP_DIRS.has(name);
}

export async function listDocuments(projectPath, { limit = 12, maxDepth = 4 } = {}) {
  const { root } = await resolveInside(projectPath, "");
  const folders = [{ absolute: root, depth: 0 }];
  const found = [];

  while (folders.length) {
    const { absolute, depth } = folders.shift();
    let entries;
    try {
      entries = await fs.readdir(absolute, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const child = path.join(absolute, entry.name);
      if (!within(root, child)) continue;
      if (entry.isDirectory()) {
        if (depth < maxDepth && !shouldSkipDocumentDir(entry.name))
          folders.push({ absolute: child, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!DOCUMENT_EXTENSIONS.has(ext)) continue;
      let stat;
      try {
        stat = await fs.lstat(child);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      let real;
      try {
        real = await fs.realpath(child);
      } catch {
        continue;
      }
      if (!within(root, real)) continue;
      found.push({
        path: toPosix(path.relative(root, child)),
        name: entry.name,
        modifiedAt: stat.mtimeMs,
        size: stat.size,
      });
    }
  }

  return found
    .sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path))
    .slice(0, limit);
}
