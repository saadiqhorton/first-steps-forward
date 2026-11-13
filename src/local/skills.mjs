import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import yauzl from "yauzl";
import {
  SKILL_FILE,
  buildSkillDocument,
  fileContentType,
  isImageFile,
  isTextFile,
  parseSkillDocument,
  skillField,
  skillFileKind,
  skillLocation,
  skillNameMismatch,
  validateSkillDescription,
  validateSkillName,
} from "../shared/skill-format.mjs";

const MAX_FILE_BYTES = 512 * 1024;
const MAX_SKILL_FILES = 200;
const MAX_SKILL_DEPTH = 6;
const MAX_PACKAGE_BYTES = 24 * 1024 * 1024;

export class SkillsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const versionOf = (content) => createHash("sha256").update(content).digest("hex");
const toPosix = (value) => value.split(path.sep).join("/");
const home = () => os.homedir();

/**
 * Where skills live. ADE keeps its own sets in its data dir — one for the
 * machine and one per project — so it never depends on `.agents` or `.claude`.
 * Those folders are still read, but only as a source you can import from.
 */
export function skillRoots(projectPath, userHome = home()) {
  return [
    {
      id: "ade-project",
      label: "This project",
      scope: "ade",
      editable: true,
      paths: [path.join(projectPath, ".ade", "skills")],
    },
    {
      id: "ade-user",
      label: "My ADE",
      scope: "ade",
      editable: true,
      paths: [path.join(userHome, ".ade", "skills")],
    },
    {
      id: "detected-project",
      label: "Found in the project",
      scope: "detected",
      editable: false,
      paths: [
        path.join(projectPath, ".agents", "skills"),
        path.join(projectPath, ".claude", "skills"),
      ],
    },
    {
      id: "detected-user",
      label: "Found in your home",
      scope: "detected",
      editable: false,
      paths: [path.join(userHome, ".agents", "skills"), path.join(userHome, ".claude", "skills")],
    },
  ];
}

const rootById = (roots, rootId) => roots.find((root) => root.id === rootId) ?? null;

/** The one folder a skill may be written to. */
function writableRoot(projectPath, rootId, userHome = home()) {
  const root = rootById(skillRoots(projectPath, userHome), rootId);
  if (!root) throw new SkillsError(404, "Unknown skills folder.");
  if (!root.editable)
    throw new SkillsError(400, "That folder is read-only. Copy the skill into ADE first.");
  return root;
}

function safeName(name) {
  const value = typeof name === "string" ? name.trim() : "";
  const error = validateSkillName(value);
  if (error) throw new SkillsError(400, error);
  return value;
}

function relativeParts(relative) {
  if (typeof relative !== "string" || relative.length > 4096 || relative.includes("\0"))
    throw new SkillsError(400, "Invalid file path.");
  if (relative === "" || relative === ".") return [];
  if (path.isAbsolute(relative) || relative.includes("\\") || /^[a-z]:/i.test(relative))
    throw new SkillsError(400, "Choose a file inside the skill.");
  const parts = relative.split("/");
  if (parts.some((part) => !part || part === "." || part === ".."))
    throw new SkillsError(400, "Choose a file inside the skill.");
  return parts;
}

async function statOrNull(target) {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

/** Every file inside a skill folder, with the kind the format gives it. */
async function listSkillFiles(skillPath) {
  const files = [];
  const walk = async (directory, prefix, depth) => {
    if (depth > MAX_SKILL_DEPTH || files.length >= MAX_SKILL_FILES) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_SKILL_FILES) return;
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(absolute, `${prefix}${entry.name}/`, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await statOrNull(absolute);
      const relative = `${prefix}${entry.name}`;
      files.push({
        path: relative,
        kind: skillFileKind(relative),
        bytes: stat?.size ?? 0,
        text: isTextFile(relative),
        image: isImageFile(relative),
      });
    }
  };
  await walk(skillPath, "", 0);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Read one skill folder into the record the workspace shows. */
async function readSkill(root, skillPath, projectPath, userHome) {
  const folder = path.basename(skillPath);
  let content;
  try {
    content = await fs.readFile(path.join(skillPath, SKILL_FILE), "utf8");
  } catch {
    return null;
  }
  const document = parseSkillDocument(content);
  const name = skillField(document, "name");
  const description = skillField(document, "description");
  const files = await listSkillFiles(skillPath);
  const warnings = [];
  const mismatch = skillNameMismatch(folder, name);
  if (mismatch) warnings.push(mismatch);
  if (!description)
    warnings.push("This skill has no description, so an agent cannot tell when to use it.");
  const stat = await statOrNull(skillPath);
  return {
    id: `${root.id}:${folder}`,
    folder,
    name: name || folder,
    description,
    rootId: root.id,
    scope: root.scope,
    editable: root.editable,
    location: skillLocation(skillPath, projectPath, userHome),
    path: skillPath,
    files,
    warnings,
    license: skillField(document, "license"),
    compatibility: skillField(document, "compatibility"),
    allowedTools: skillField(document, "allowed-tools"),
    metadata: document.metadata,
    body: document.body,
    updatedAt: stat?.mtimeMs ?? 0,
  };
}

/** Every skill ADE can see for this project. */
export async function listSkills(projectPath, userHome = home()) {
  const roots = skillRoots(projectPath, userHome);
  const skills = [];
  for (const root of roots) {
    for (const rootPath of root.paths) {
      let entries;
      try {
        entries = await fs.readdir(rootPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        if (entry.name.startsWith(".")) continue;
        const skill = await readSkill(
          { ...root, path: rootPath },
          path.join(rootPath, entry.name),
          projectPath,
          userHome,
        );
        if (skill) skills.push(skill);
      }
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** The folder one skill lives in, resolved from its root and folder name. */
export async function resolveSkillPath(projectPath, rootId, folder, userHome = home()) {
  const root = rootById(skillRoots(projectPath, userHome), rootId);
  if (!root) throw new SkillsError(404, "Unknown skills folder.");
  const parts = relativeParts(folder);
  if (parts.length !== 1) throw new SkillsError(400, "Choose a skill folder.");
  let fallback = null;
  for (const rootPath of root.paths) {
    const candidate = path.join(rootPath, parts[0]);
    if (!candidate.startsWith(rootPath + path.sep)) continue;
    fallback ??= { root, rootPath, target: candidate };
    // A root can hold more than one folder (the project scans .agents and .claude),
    // so the folder that actually exists is the one that answers.
    if (await statOrNull(candidate)) return { root, rootPath, target: candidate };
  }
  if (fallback) return fallback;
  throw new SkillsError(404, "Skill not found.");
}

/** Read one bundled file of a skill. */
export async function readSkillFile(projectPath, rootId, folder, file, userHome = home()) {
  const { target } = await resolveSkillPath(projectPath, rootId, folder, userHome);
  const parts = relativeParts(file);
  if (!parts.length) throw new SkillsError(400, "Choose a file.");
  const filePath = path.join(target, ...parts);
  if (!filePath.startsWith(target + path.sep))
    throw new SkillsError(400, "Choose a file inside the skill.");
  const stat = await statOrNull(filePath);
  if (!stat?.isFile()) throw new SkillsError(404, "File not found.");
  if (stat.size > MAX_FILE_BYTES)
    throw new SkillsError(413, "This file is too large to edit here (512 KB limit).");
  const bytes = await fs.readFile(filePath);
  if (bytes.includes(0)) throw new SkillsError(415, "Binary files cannot be edited here.");
  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SkillsError(415, "Only UTF-8 text files can be edited here.");
  }
  return { path: toPosix(parts.join("/")), content, version: versionOf(bytes) };
}

/** The bytes of one bundled file, for images, PDFs and anything else text cannot hold. */
export async function readSkillAsset(projectPath, rootId, folder, file, userHome = home()) {
  const { target } = await resolveSkillPath(projectPath, rootId, folder, userHome);
  const parts = relativeParts(file);
  if (!parts.length) throw new SkillsError(400, "Choose a file.");
  const filePath = path.join(target, ...parts);
  if (!filePath.startsWith(target + path.sep))
    throw new SkillsError(400, "Choose a file inside the skill.");
  const stat = await statOrNull(filePath);
  if (!stat?.isFile()) throw new SkillsError(404, "File not found.");
  const MAX_ASSET_BYTES = 32 * 1024 * 1024;
  if (stat.size > MAX_ASSET_BYTES) throw new SkillsError(413, "That file is too large to show.");
  return {
    bytes: await fs.readFile(filePath),
    contentType: fileContentType(file),
    name: path.basename(filePath),
    size: stat.size,
  };
}

/** Write one bundled file of a skill. */
export async function writeSkillFile(
  projectPath,
  rootId,
  folder,
  file,
  content,
  expectedVersion,
  userHome = home(),
) {
  const root = writableRoot(projectPath, rootId, userHome);
  const { target } = await resolveSkillPath(projectPath, rootId, folder, userHome);
  const parts = relativeParts(file);
  if (!parts.length) throw new SkillsError(400, "Choose a file.");
  if (parts[0] === SKILL_FILE)
    throw new SkillsError(400, "Edit the skill's name and description instead.");
  const filePath = path.join(target, ...parts);
  if (!filePath.startsWith(target + path.sep))
    throw new SkillsError(400, "Choose a file inside the skill.");
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES)
    throw new SkillsError(413, "Text must be 512 KB or smaller.");
  if (typeof expectedVersion !== "string" || !/^[a-f0-9]{64}$/.test(expectedVersion))
    throw new SkillsError(400, "Open the file before saving it.");
  const current = await fs.readFile(filePath).catch(() => null);
  if (!current) throw new SkillsError(404, "File not found.");
  if (versionOf(current) !== expectedVersion)
    throw new SkillsError(409, "This file changed on disk. Reload it before saving.");
  const stat = await fs.stat(filePath);
  const staged = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.ade-${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(staged, content, { mode: stat.mode & 0o777 });
    await fs.chmod(staged, stat.mode & 0o777);
    await fs.rename(staged, filePath);
  } finally {
    await fs.rm(staged, { force: true }).catch(() => {});
  }
  return { path: toPosix(parts.join("/")), version: versionOf(Buffer.from(content, "utf8")) };
}

/** Add a file to a skill. */
export async function createSkillFile(projectPath, rootId, folder, file, userHome = home()) {
  writableRoot(projectPath, rootId, userHome);
  const { target } = await resolveSkillPath(projectPath, rootId, folder, userHome);
  const parts = relativeParts(file);
  if (!parts.length) throw new SkillsError(400, "Choose a file name.");
  const filePath = path.join(target, ...parts);
  if (!filePath.startsWith(target + path.sep))
    throw new SkillsError(400, "Choose a file inside the skill.");
  if (parts.includes(SKILL_FILE)) throw new SkillsError(400, "That file already exists.");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.writeFile(filePath, "", { flag: "wx" });
  } catch (error) {
    if (error?.code === "EEXIST")
      throw new SkillsError(409, "A file with that name already exists.");
    throw new SkillsError(400, "Could not create that file.");
  }
  return { path: toPosix(parts.join("/")), version: versionOf(Buffer.alloc(0)) };
}

/** Remove a file from a skill. */
export async function deleteSkillFile(projectPath, rootId, folder, file, userHome = home()) {
  writableRoot(projectPath, rootId, userHome);
  const { target } = await resolveSkillPath(projectPath, rootId, folder, userHome);
  const parts = relativeParts(file);
  if (!parts.length) throw new SkillsError(400, "Choose a file.");
  if (parts[0] === SKILL_FILE) throw new SkillsError(400, "A skill needs its SKILL.md.");
  const filePath = path.join(target, ...parts);
  if (!filePath.startsWith(target + path.sep))
    throw new SkillsError(400, "Choose a file inside the skill.");
  const stat = await statOrNull(filePath);
  if (!stat?.isFile()) throw new SkillsError(404, "File not found.");
  await fs.unlink(filePath);
  return { ok: true, path: toPosix(parts.join("/")) };
}

/** The frontmatter of a skill that is already on disk, so a save keeps it. */
async function readExistingFrontmatter(skillPath) {
  const empty = { license: "", compatibility: "", allowedTools: "", metadata: {}, extra: {} };
  let content;
  try {
    content = await fs.readFile(path.join(skillPath, SKILL_FILE), "utf8");
  } catch {
    return empty;
  }
  const document = parseSkillDocument(content);
  const known = ["name", "description", "license", "compatibility", "allowed-tools", "metadata"];
  const extra = {};
  for (const field of document.fields) {
    if (known.includes(field.key)) continue;
    if (field.value) extra[field.key] = field.value;
  }
  return {
    license: skillField(document, "license"),
    compatibility: skillField(document, "compatibility"),
    allowedTools: skillField(document, "allowed-tools"),
    metadata: document.metadata,
    extra,
  };
}

/** Write a skill made of already-fetched files into one of ADE's own folders. */
export async function writeSkillFromFiles(
  projectPath,
  { rootId, folder, files },
  userHome = home(),
) {
  const root = writableRoot(projectPath, rootId, userHome);
  const name = safeName(folder);
  const destination = path.join(root.paths[0], name);
  if (await statOrNull(destination))
    throw new SkillsError(409, `“${name}” already exists in ${root.label}.`);
  if (!Array.isArray(files) || !files.length)
    throw new SkillsError(400, "That skill has no files to import.");
  await fs.mkdir(destination, { recursive: true });
  for (const file of files) {
    const parts = relativeParts(file.path);
    if (!parts.length) continue;
    if (parts.some((part) => part.startsWith("."))) continue;
    const target = path.join(destination, ...parts);
    if (!target.startsWith(destination + path.sep)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.bytes);
  }
  const skill = await readSkill(
    { ...root, path: root.paths[0] },
    destination,
    projectPath,
    userHome,
  );
  if (!skill) throw new SkillsError(400, "That skill has no SKILL.md.");
  return skill;
}

/** Create a skill, or save a new version of one. */
export async function saveSkill(projectPath, input, userHome = home()) {
  const root = writableRoot(projectPath, input?.rootId, userHome);
  const name = safeName(input?.name);
  const description = typeof input?.description === "string" ? input.description.trim() : "";
  const descriptionError = validateSkillDescription(description);
  if (descriptionError) throw new SkillsError(400, descriptionError);
  const body = typeof input?.body === "string" ? input.body : "";

  const rootPath = root.paths[0];
  const previous = typeof input?.folder === "string" ? input.folder.trim() : "";

  // The frontmatter a skill already carries — a license, a compatibility note, a
  // client's own keys — is kept unless the caller sets it. ADE only edits the
  // name, the description and the body.
  const existing = await readExistingFrontmatter(path.join(rootPath, previous || name));
  const document = buildSkillDocument({
    name,
    description,
    body,
    license: input?.license ?? existing.license,
    compatibility: input?.compatibility ?? existing.compatibility,
    metadata: input?.metadata ?? existing.metadata,
    allowedTools: input?.allowedTools ?? existing.allowedTools,
    extra: { ...existing.extra, ...(input?.extra ?? {}) },
  });

  const target = path.join(rootPath, name);
  const renaming = previous && previous !== name;

  if (renaming) {
    const from = path.join(rootPath, previous);
    if (!from.startsWith(rootPath + path.sep))
      throw new SkillsError(400, "Choose a skill inside ADE.");
    if (!(await statOrNull(from))?.isDirectory()) throw new SkillsError(404, "Skill not found.");
    if (await statOrNull(target))
      throw new SkillsError(409, "A skill with that name already exists.");
    await fs.rename(from, target);
  }

  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, SKILL_FILE), document, "utf8");
  const skill = await readSkill({ ...root, path: rootPath }, target, projectPath, userHome);
  return skill;
}

/** Delete a skill folder. */
export async function deleteSkill(projectPath, rootId, folder, userHome = home()) {
  writableRoot(projectPath, rootId, userHome);
  const { target } = await resolveSkillPath(projectPath, rootId, folder, userHome);
  const stat = await statOrNull(target);
  if (!stat?.isDirectory()) throw new SkillsError(404, "Skill not found.");
  await fs.rm(target, { recursive: true, force: true });
  return { ok: true, folder };
}

/** Copy a skill ADE only found into one of ADE's own folders. */
export async function copySkill(projectPath, rootId, sourceRootId, folder, userHome = home()) {
  const target = writableRoot(projectPath, rootId, userHome);
  const source = await resolveSkillPath(projectPath, sourceRootId, folder, userHome);
  const name = path.basename(source.target);
  const destination = path.join(target.paths[0], name);
  if (destination === source.target)
    throw new SkillsError(400, "That skill is already in this folder.");
  if (await statOrNull(destination))
    throw new SkillsError(409, `“${name}” already exists in ${target.label}.`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source.target, destination, { recursive: true });
  const skill = await readSkill(
    { ...target, path: target.paths[0] },
    destination,
    projectPath,
    userHome,
  );
  return skill;
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

function readZipEntries(bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zipfile) => {
      if (error) {
        reject(new SkillsError(400, "That file could not be read as a zip archive."));
        return;
      }
      const entries = [];
      let total = 0;
      let failed = false;
      zipfile.on("error", (zipError) => {
        if (failed) return;
        failed = true;
        reject(new SkillsError(400, "That file could not be read as a zip archive."));
      });
      zipfile.on("entry", (entry) => {
        if (failed) return;
        const name = toPosix(entry.fileName);
        if (name.endsWith("/")) {
          zipfile.readEntry();
          return;
        }
        if (name.includes("..") || path.isAbsolute(name)) {
          zipfile.readEntry();
          return;
        }
        if (total + entry.uncompressedSize > MAX_PACKAGE_BYTES) {
          failed = true;
          zipfile.close();
          reject(new SkillsError(413, "That package is too large to import."));
          return;
        }
        zipfile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            failed = true;
            reject(new SkillsError(400, "That file could not be read as a zip archive."));
            return;
          }
          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("error", () => {
            if (failed) return;
            failed = true;
            reject(new SkillsError(400, "That file could not be read as a zip archive."));
          });
          stream.on("end", () => {
            if (failed) return;
            total += entry.uncompressedSize;
            entries.push({ name, bytes: Buffer.concat(chunks) });
            zipfile.readEntry();
          });
        });
      });
      zipfile.on("end", () => {
        if (!failed) resolve(entries);
      });
      zipfile.readEntry();
    });
  });
}

/**
 * Read a package and report the skills it holds. A package is a `.skill` file
 * or a `.zip`; every folder with a `SKILL.md` inside is a skill.
 */
export async function readPackage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0)
    throw new SkillsError(400, "Choose a .skill file or a .zip archive.");
  if (bytes.length > MAX_PACKAGE_BYTES)
    throw new SkillsError(413, "That package is too large to import.");
  const entries = await readZipEntries(bytes);
  return skillsFromEntries(entries);
}

/** The skills inside an already-read archive. */
export function skillsFromEntries(entries) {
  const folders = new Set();
  for (const entry of entries) {
    const parts = entry.name.split("/");
    const index = parts.lastIndexOf(SKILL_FILE);
    if (index < 1) continue;
    folders.add(parts.slice(0, index).join("/"));
  }
  if (!folders.size)
    throw new SkillsError(
      400,
      "That package holds no SKILL.md. A package needs a skill folder with a SKILL.md inside.",
    );
  const skills = [];
  for (const folder of [...folders].sort()) {
    const files = entries
      .filter((entry) => entry.name.startsWith(`${folder}/`))
      .map((entry) => ({
        path: entry.name.slice(folder.length + 1),
        bytes: entry.bytes.length,
        content: entry.bytes,
      }))
      .filter((file) => file.path && !file.path.split("/").some((part) => part.startsWith(".")))
      .map(({ path: filePath, bytes }) => ({
        path: filePath,
        kind: skillFileKind(filePath),
        bytes,
        text: isTextFile(filePath),
        image: isImageFile(filePath),
      }));
    const skillFile = files.find((file) => file.path === SKILL_FILE);
    if (!skillFile) continue;
    const source = entries.find((entry) => entry.name === `${folder}/${SKILL_FILE}`);
    const document = parseSkillDocument(source.bytes.toString("utf8"));
    const name = skillField(document, "name");
    const description = skillField(document, "description");
    const warnings = [];
    const mismatch = skillNameMismatch(path.basename(folder), name);
    if (mismatch) warnings.push(mismatch);
    if (!description) warnings.push("This skill has no description.");
    skills.push({
      folder: path.basename(folder),
      name: name || path.basename(folder),
      description,
      files,
      warnings,
    });
  }
  if (!skills.length) throw new SkillsError(400, "That package holds no readable skill.");
  return skills;
}

/** Write the skills of a package into one of ADE's own folders. */
export async function importPackage(projectPath, { rootId, bytes }, userHome = home()) {
  const root = writableRoot(projectPath, rootId, userHome);
  if (!Buffer.isBuffer(bytes) || bytes.length === 0)
    throw new SkillsError(400, "Choose a .skill file or a .zip archive.");
  if (bytes.length > MAX_PACKAGE_BYTES)
    throw new SkillsError(413, "That package is too large to import.");
  const entries = await readZipEntries(bytes);
  const skills = skillsFromEntries(entries);
  const imported = [];
  for (const skill of skills) {
    const files = entries.filter((entry) => entry.name.startsWith(`${skill.folder}/`));
    const destination = path.join(root.paths[0], skill.folder);
    if (await statOrNull(destination))
      throw new SkillsError(409, `“${skill.folder}” already exists in ${root.label}.`);
    await fs.mkdir(destination, { recursive: true });
    for (const entry of files) {
      const relative = entry.name.slice(skill.folder.length + 1);
      if (!relative || relative.split("/").some((part) => part.startsWith("."))) continue;
      const target = path.join(destination, ...relative.split("/"));
      if (!target.startsWith(destination + path.sep)) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, entry.bytes);
    }
    const stored = await readSkill(
      { ...root, path: root.paths[0] },
      destination,
      projectPath,
      userHome,
    );
    if (stored) imported.push(stored);
  }
  return imported;
}

/**
 * Move a skill into another of ADE's folders: copy it, then remove the
 * original. A skill ADE only found is never removed from its own folder, so
 * moving one is refused rather than quietly turning into a copy.
 */
export async function moveSkill(projectPath, rootId, sourceRootId, folder, userHome = home()) {
  const source = rootById(skillRoots(projectPath, userHome), sourceRootId);
  if (!source?.editable)
    throw new SkillsError(
      400,
      "This skill lives outside ADE's own folders. Copy it instead — ADE will not delete another client's files.",
    );
  const moved = await copySkill(projectPath, rootId, sourceRootId, folder, userHome);
  await deleteSkill(projectPath, sourceRootId, folder, userHome);
  return moved;
}
