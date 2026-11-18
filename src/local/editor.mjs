import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { mediaKindOf, mediaTypeOf } from "../shared/media-types.mjs";

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
const PREVIEW_MAX_FILES = 400;
const PREVIEW_CONCURRENCY = 16;
const PREVIEW_BYTES = 4096;
const PREVIEW_LINES = 16;
const PREVIEW_LINE_CHARS = 120;
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

async function mapPool(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function snippetOf(bytes) {
  if (bytes.includes(0)) return null;
  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
  } catch {
    return null;
  }
  return decoded
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, "  ")
    .split("\n")
    .slice(0, PREVIEW_LINES)
    .map((line) => line.slice(0, PREVIEW_LINE_CHARS))
    .join("\n");
}

async function readSnippet(file) {
  let handle;
  try {
    handle = await fs.open(file, "r");
    const buffer = Buffer.alloc(PREVIEW_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, PREVIEW_BYTES, 0);
    return snippetOf(buffer.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Size, modified time, media kind and a text snippet for each file directly inside a folder. */
export async function listEditorPreviews(projectPath, relative = "") {
  const entries = (await listEditorEntries(projectPath, relative))
    .filter((entry) => entry.kind === "file")
    .slice(0, PREVIEW_MAX_FILES);
  const { root } = await resolveInside(projectPath, "");
  const found = await mapPool(entries, PREVIEW_CONCURRENCY, async (entry) => {
    const absolute = path.join(root, ...entry.path.split("/"));
    let stat;
    try {
      stat = await fs.stat(absolute);
    } catch {
      return null;
    }
    const media = mediaKindOf(entry.name);
    return [
      entry.path,
      {
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        media,
        text: media ? null : await readSnippet(absolute),
      },
    ];
  });
  return Object.fromEntries(found.filter(Boolean));
}

/** null: send everything; undefined: unsatisfiable; otherwise the inclusive byte range. */
function parseRange(header, size) {
  if (typeof header !== "string" || header === "" || header.includes(",")) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return undefined;
  let start;
  let end;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0 || size === 0) return undefined;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) return undefined;
  return { start, end };
}

/** Resolves a picture, video or sound for streaming, with the byte range a Range header asks for. */
export async function openEditorMedia(projectPath, relative, rangeHeader) {
  const parts = validateRelative(relative);
  if (!parts.length) throw new EditorError(400, "Choose a file.");
  if (parts.includes(".git")) throw new EditorError(400, "Git internals cannot be opened here.");
  const { target } = await resolveInside(projectPath, relative);
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    throw new EditorError(404, "File not found.");
  }
  if (!stat.isFile()) throw new EditorError(400, "Choose a file, not a folder.");
  const type = mediaTypeOf(relative);
  if (!type) throw new EditorError(415, "Only pictures, videos and sounds open here.");
  const range = parseRange(rangeHeader, stat.size);
  return {
    target,
    stat,
    mime: type.mime,
    size: stat.size,
    range: range === undefined ? "unsatisfiable" : range,
  };
}
