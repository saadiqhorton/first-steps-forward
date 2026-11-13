import assert from "node:assert/strict";
import { promises as fs, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SkillsError,
  copySkill,
  createSkillFile,
  deleteSkill,
  deleteSkillFile,
  importPackage,
  listSkills,
  moveSkill,
  readPackage,
  readSkillAsset,
  readSkillFile,
  saveSkill,
  skillRoots,
  writeSkillFile,
} from "./skills.mjs";

const SKILL_MD = `---
name: release-checklist
description: Use this skill when a release is cut.
---

## Steps

1. Check the notes.
`;

const workspaces = [];

/** A throwaway project and home directory. Every test gets its own. */
async function workspace() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "ade-skills-"));
  const project = path.join(base, "project");
  const home = path.join(base, "home");
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(home, { recursive: true });
  workspaces.push(base);
  return { base, project, home };
}

// Each test's folder goes away when the file finishes, so a run leaves nothing behind.
process.on("exit", () => {
  for (const base of workspaces) rmSync(base, { recursive: true, force: true });
});

async function writeSkillFolder(root, folder, files) {
  const target = path.join(root, folder);
  await fs.mkdir(target, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(target, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  return target;
}

/** A stored-entry zip archive: one folder holding a SKILL.md and some files. */
function zipOf(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(value, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

let crcTable = null;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

test("ADE keeps its own folders and treats other clients' folders as read-only", async () => {
  const { project, home } = await workspace();
  const roots = skillRoots(project, home);
  assert.deepEqual(
    roots.map((root) => root.id),
    ["ade-project", "ade-user", "detected-project", "detected-user"],
  );
  assert.equal(roots[0].paths[0], path.join(project, ".ade", "skills"));
  assert.equal(roots[1].paths[0], path.join(home, ".ade", "skills"));
  assert.equal(roots[0].editable, true);
  assert.equal(roots[2].editable, false);
});

test("listing finds ADE skills, project skills and user skills", async () => {
  const { project, home } = await workspace();
  await writeSkillFolder(path.join(project, ".ade", "skills"), "my-skill", {
    "SKILL.md": SKILL_MD,
  });
  await writeSkillFolder(path.join(project, ".agents", "skills"), "found-skill", {
    "SKILL.md": SKILL_MD.replace("release-checklist", "found-skill"),
  });
  await writeSkillFolder(path.join(home, ".claude", "skills"), "home-skill", {
    "SKILL.md": SKILL_MD.replace("release-checklist", "home-skill"),
  });

  const skills = await listSkills(project, home);
  const names = skills.map((skill) => skill.name).sort();
  assert.deepEqual(names, ["found-skill", "home-skill", "release-checklist"]);
  const found = skills.find((skill) => skill.name === "found-skill");
  assert.equal(found.editable, false);
  assert.equal(found.scope, "detected");
  const mine = skills.find((skill) => skill.name === "release-checklist");
  assert.equal(mine.editable, true);
  assert.equal(mine.location, ".ade/skills/my-skill");
});

test("a skill lists its bundled files with the kind the format gives them", async () => {
  const { project, home } = await workspace();
  await writeSkillFolder(path.join(project, ".ade", "skills"), "my-skill", {
    "SKILL.md": SKILL_MD,
    "references/NOTE.md": "notes",
    "scripts/run.sh": "echo hi",
    "assets/logo.svg": "<svg />",
  });
  const [skill] = await listSkills(project, home);
  const kinds = Object.fromEntries(skill.files.map((file) => [file.path, file.kind]));
  assert.equal(kinds["SKILL.md"], "instructions");
  assert.equal(kinds["references/NOTE.md"], "reference");
  assert.equal(kinds["scripts/run.sh"], "script");
  assert.equal(kinds["assets/logo.svg"], "asset");
});

test("saving a skill writes SKILL.md and keeps the frontmatter in order", async () => {
  const { project, home } = await workspace();
  const skill = await saveSkill(
    project,
    {
      rootId: "ade-project",
      name: "release-checklist",
      description: "Use this skill when a release is cut.",
      body: "## Steps\n\n1. Check the notes.\n",
      license: "MIT",
    },
    home,
  );
  assert.equal(skill.name, "release-checklist");
  const written = await fs.readFile(
    path.join(project, ".ade", "skills", "release-checklist", "SKILL.md"),
    "utf8",
  );
  assert.match(written, /^---\nname: release-checklist\ndescription: Use this skill/);
  assert.match(written, /license: MIT/);
  assert.match(written, /## Steps/);
});

test("a skill name that breaks the format rules is refused", async () => {
  const { project, home } = await workspace();
  await assert.rejects(
    () => saveSkill(project, { rootId: "ade-project", name: "Bad Name", description: "x" }, home),
    (error) => error instanceof SkillsError && error.status === 400,
  );
});

test("a detected skill is read-only until it is copied into ADE", async () => {
  const { project, home } = await workspace();
  await writeSkillFolder(path.join(project, ".agents", "skills"), "found-skill", {
    "SKILL.md": SKILL_MD.replace("release-checklist", "found-skill"),
  });
  await assert.rejects(
    () => deleteSkill(project, "detected-project", "found-skill", home),
    (error) => error instanceof SkillsError && error.status === 400,
  );

  const copied = await copySkill(project, "ade-project", "detected-project", "found-skill", home);
  assert.equal(copied.scope, "ade");
  assert.equal(copied.editable, true);
  const inside = await fs.readFile(
    path.join(project, ".ade", "skills", "found-skill", "SKILL.md"),
    "utf8",
  );
  assert.match(inside, /name: found-skill/);
});

test("a bundled file can be written, created and removed", async () => {
  const { project, home } = await workspace();
  await writeSkillFolder(path.join(project, ".ade", "skills"), "my-skill", {
    "SKILL.md": SKILL_MD,
    "references/NOTE.md": "notes",
  });
  const file = await readSkillFile(project, "ade-project", "my-skill", "references/NOTE.md", home);
  assert.equal(file.content, "notes");

  const saved = await writeSkillFile(
    project,
    "ade-project",
    "my-skill",
    "references/NOTE.md",
    "changed",
    file.version,
    home,
  );
  assert.match(saved.version, /^[a-f0-9]{64}$/);
  const after = await readSkillFile(project, "ade-project", "my-skill", "references/NOTE.md", home);
  assert.equal(after.content, "changed");

  await createSkillFile(project, "ade-project", "my-skill", "scripts/run.sh", home);
  const created = await readSkillFile(project, "ade-project", "my-skill", "scripts/run.sh", home);
  assert.equal(created.content, "");

  await deleteSkillFile(project, "ade-project", "my-skill", "scripts/run.sh", home);
  await assert.rejects(
    () => readSkillFile(project, "ade-project", "my-skill", "scripts/run.sh", home),
    (error) => error instanceof SkillsError && error.status === 404,
  );
});

test("a stale version is refused so a file cannot be overwritten blindly", async () => {
  const { project, home } = await workspace();
  await writeSkillFolder(path.join(project, ".ade", "skills"), "my-skill", {
    "SKILL.md": SKILL_MD,
    "references/NOTE.md": "notes",
  });
  await assert.rejects(
    () =>
      writeSkillFile(
        project,
        "ade-project",
        "my-skill",
        "references/NOTE.md",
        "changed",
        "0".repeat(64),
        home,
      ),
    (error) => error instanceof SkillsError && error.status === 409,
  );
});

test("a file outside the skill folder cannot be reached", async () => {
  const { project, home } = await workspace();
  await writeSkillFolder(path.join(project, ".ade", "skills"), "my-skill", {
    "SKILL.md": SKILL_MD,
  });
  await assert.rejects(
    () => readSkillFile(project, "ade-project", "my-skill", "../../secrets.txt", home),
    (error) => error instanceof SkillsError && error.status === 400,
  );
});

test("a zip package is read as the skills it holds", async () => {
  const bytes = await zipOf({
    "code-review/SKILL.md": `---\nname: code-review\ndescription: Review a diff.\n---\n\nBody\n`,
    "code-review/references/CHECKLIST.md": "checklist",
    "code-review/scripts/run.sh": "echo hi",
  });
  const skills = await readPackage(bytes);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, "code-review");
  assert.deepEqual(skills[0].files.map((file) => file.path).sort(), [
    "SKILL.md",
    "references/CHECKLIST.md",
    "scripts/run.sh",
  ]);
});

test("importing a package writes every file into ADE's own folder", async () => {
  const { project, home } = await workspace();
  const bytes = await zipOf({
    "code-review/SKILL.md": `---\nname: code-review\ndescription: Review a diff.\n---\n\nBody\n`,
    "code-review/references/CHECKLIST.md": "checklist",
  });
  const imported = await importPackage(project, { rootId: "ade-project", bytes }, home);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].scope, "ade");
  const written = await fs.readFile(
    path.join(project, ".ade", "skills", "code-review", "references", "CHECKLIST.md"),
    "utf8",
  );
  assert.equal(written, "checklist");
});

test("a package without a SKILL.md explains itself", async () => {
  const bytes = await zipOf({ "notes/readme.txt": "hello" });
  await assert.rejects(
    () => readPackage(bytes),
    (error) => error instanceof SkillsError && /no SKILL\.md/.test(error.message),
  );
});

test("a package with a name that does not match its folder is flagged", async () => {
  const bytes = await zipOf({
    "release-notes/SKILL.md": `---\nname: release-notes-writer\ndescription: Write notes.\n---\n`,
  });
  const [skill] = await readPackage(bytes);
  assert.equal(skill.warnings.length, 1);
  assert.match(skill.warnings[0], /does not match the folder/);
});

test("the optional frontmatter fields are written and read back", async () => {
  const { project, home } = await workspace();
  await saveSkill(
    project,
    {
      rootId: "ade-project",
      name: "with-extras",
      description: "Use this skill when a skill carries extra frontmatter.",
      body: "## Steps\n",
      license: "CC-BY-4.0",
      compatibility: "Requires git and network access.",
      allowedTools: "Bash(git:*) Read",
      metadata: { author: "ade" },
    },
    home,
  );
  const written = await fs.readFile(
    path.join(project, ".ade", "skills", "with-extras", "SKILL.md"),
    "utf8",
  );
  assert.match(written, /license: CC-BY-4\.0/);
  assert.match(written, /compatibility: Requires git and network access\./);
  assert.match(written, /allowed-tools: "Bash\(git:\*\) Read"/);
  assert.match(written, /metadata:\n {2}author: ade/);

  const [skill] = await listSkills(project, home);
  assert.equal(skill.license, "CC-BY-4.0");
  assert.equal(skill.allowedTools, "Bash(git:*) Read");
  assert.deepEqual(skill.metadata, { author: "ade" });
});

test("frontmatter ADE does not edit survives a save", async () => {
  const { project, home } = await workspace();
  await writeSkillFolder(path.join(project, ".ade", "skills"), "kept", {
    "SKILL.md": `---
name: kept
description: Use this skill when a skill carries more frontmatter.
license: CC-BY-4.0
disable-model-invocation: true
---

Body
`,
  });
  await saveSkill(
    project,
    {
      rootId: "ade-project",
      folder: "kept",
      name: "kept",
      description: "Use this skill when a skill carries more frontmatter.",
      body: "New body\n",
    },
    home,
  );
  const written = await fs.readFile(
    path.join(project, ".ade", "skills", "kept", "SKILL.md"),
    "utf8",
  );
  assert.match(written, /license: CC-BY-4\.0/);
  assert.match(written, /disable-model-invocation: true/);
  assert.match(written, /New body/);
});

test("a skill found in .claude/skills is still found and copied", async () => {
  const { project, home } = await workspace();
  await writeSkillFolder(path.join(project, ".claude", "skills"), "unslop", {
    "SKILL.md": SKILL_MD.replace("release-checklist", "unslop"),
  });
  const skills = await listSkills(project, home);
  const found = skills.find((skill) => skill.name === "unslop");
  assert.ok(found, "the skill in .claude/skills should be listed");
  assert.equal(found.location, ".claude/skills/unslop");

  const file = await readSkillFile(project, "detected-project", "unslop", "SKILL.md", home);
  assert.match(file.content, /name: unslop/);

  const copied = await copySkill(project, "ade-project", "detected-project", "unslop", home);
  assert.equal(copied.scope, "ade");
  const inside = await fs.readFile(
    path.join(project, ".ade", "skills", "unslop", "SKILL.md"),
    "utf8",
  );
  assert.match(inside, /name: unslop/);
});

test("a listing marks text files, images and other binaries", async () => {
  const { project, home } = await workspace();
  await writeSkillFolder(path.join(project, ".ade", "skills"), "mixed", {
    "SKILL.md": SKILL_MD,
    "references/NOTES.md": "notes",
    "scripts/run.mjs": "console.log(1)",
    "references/hero.png": "not really a png",
    "assets/archive.zip": "PK",
  });
  const [skill] = await listSkills(project, home);
  const byPath = Object.fromEntries(skill.files.map((file) => [file.path, file]));
  assert.equal(byPath["references/NOTES.md"].text, true);
  assert.equal(byPath["scripts/run.mjs"].text, true);
  assert.equal(byPath["references/hero.png"].text, false);
  assert.equal(byPath["references/hero.png"].image, true);
  assert.equal(byPath["assets/archive.zip"].text, false);
  assert.equal(byPath["assets/archive.zip"].image, false);
});

test("a bundled binary can be served without pretending it is text", async () => {
  const { project, home } = await workspace();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
  const target = path.join(project, ".ade", "skills", "mixed", "references");
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(project, ".ade", "skills", "mixed", "SKILL.md"), SKILL_MD);
  await fs.writeFile(path.join(target, "hero.png"), png);

  const asset = await readSkillAsset(project, "ade-project", "mixed", "references/hero.png", home);
  assert.equal(asset.contentType, "image/png");
  assert.deepEqual(asset.bytes, png);

  // The text reader still refuses it, so the two paths cannot be confused.
  await assert.rejects(
    () => readSkillFile(project, "ade-project", "mixed", "references/hero.png", home),
    (error) => error instanceof SkillsError && error.status === 415,
  );
});

test("copying a project skill into My ADE leaves the original in place", async () => {
  const { project, home } = await workspace();
  await writeSkillFolder(path.join(project, ".ade", "skills"), "shared", {
    "SKILL.md": SKILL_MD.replace("release-checklist", "shared"),
    "references/N.md": "notes",
  });

  const copied = await copySkill(project, "ade-user", "ade-project", "shared", home);
  assert.equal(copied.scope, "ade");
  assert.equal(copied.location, "~/.ade/skills/shared");
  assert.equal(copied.files.length, 2);

  // Both copies exist: the project keeps its own.
  const projectCopy = await fs.readFile(
    path.join(project, ".ade", "skills", "shared", "references", "N.md"),
    "utf8",
  );
  const userCopy = await fs.readFile(
    path.join(home, ".ade", "skills", "shared", "references", "N.md"),
    "utf8",
  );
  assert.equal(projectCopy, "notes");
  assert.equal(userCopy, "notes");
});

test("moving a project skill into My ADE removes it from the project", async () => {
  const { project, home } = await workspace();
  await writeSkillFolder(path.join(project, ".ade", "skills"), "shared", {
    "SKILL.md": SKILL_MD.replace("release-checklist", "shared"),
  });

  const moved = await moveSkill(project, "ade-user", "ade-project", "shared", home);
  assert.equal(moved.location, "~/.ade/skills/shared");
  const names = (await listSkills(project, home)).map((skill) => skill.location);
  assert.deepEqual(names, ["~/.ade/skills/shared"]);
  await assert.rejects(
    () => fs.access(path.join(project, ".ade", "skills", "shared")),
    (error) => error.code === "ENOENT",
  );
});

test("moving a skill ADE only found is refused, so no other client loses files", async () => {
  const { project, home } = await workspace();
  await writeSkillFolder(path.join(project, ".claude", "skills"), "theirs", {
    "SKILL.md": SKILL_MD.replace("release-checklist", "theirs"),
  });
  await assert.rejects(
    () => moveSkill(project, "ade-user", "detected-project", "theirs", home),
    (error) => error instanceof SkillsError && error.status === 400,
  );
  // The original is untouched.
  const kept = await fs.readFile(
    path.join(project, ".claude", "skills", "theirs", "SKILL.md"),
    "utf8",
  );
  assert.match(kept, /name: theirs/);
});

test("copying onto an existing skill says which folder already has it", async () => {
  const { project, home } = await workspace();
  for (const root of [path.join(project, ".ade", "skills"), path.join(home, ".ade", "skills")]) {
    await writeSkillFolder(root, "twice", {
      "SKILL.md": SKILL_MD.replace("release-checklist", "twice"),
    });
  }
  await assert.rejects(
    () => copySkill(project, "ade-user", "ade-project", "twice", home),
    (error) =>
      error instanceof SkillsError && error.status === 409 && /already exists/.test(error.message),
  );
});
