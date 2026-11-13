import assert from "node:assert/strict";
import { promises as fs, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  GithubSkillsError,
  assessSkill,
  discoverSkills,
  fetchSkillTree,
  findSkillsInRepo,
  parseGithubTarget,
} from "./github-skills.mjs";
import { writeSkillFromFiles } from "./skills.mjs";

const workspaces = [];

/** A throwaway project and home directory. */
async function workspace() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "ade-gh-skills-"));
  const project = path.join(base, "project");
  const home = path.join(base, "home");
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(home, { recursive: true });
  workspaces.push(base);
  return { project, home };
}

process.on("exit", () => {
  for (const base of workspaces) rmSync(base, { recursive: true, force: true });
});

const blob = (path, size = 100) => ({ path, type: "blob", size });
const tree = (path) => ({ path, type: "tree" });

const SKILL_MD = `---
name: pdf-processing
description: Use this skill when a PDF needs text, tables, or filled forms.
---

## Steps
`;

/* ------------------------------------------------------------------ */
/* Parsing whatever was pasted                                         */
/* ------------------------------------------------------------------ */

test("a repository, a URL, and a folder link all parse", () => {
  for (const input of [
    "anthropics/skills",
    "https://github.com/anthropics/skills",
    "https://github.com/anthropics/skills/",
    "https://github.com/anthropics/skills.git",
    "github.com/anthropics/skills",
    "git@github.com:anthropics/skills.git",
    "ssh://git@github.com/anthropics/skills.git",
    "https://github.com/anthropics/skills?tab=readme#top",
  ])
    assert.deepEqual(
      parseGithubTarget(input),
      { owner: "anthropics", repo: "skills", ref: "", focusPath: "" },
      input,
    );
});

test("a tree or blob link narrows the search to its folder", () => {
  assert.deepEqual(parseGithubTarget("https://github.com/o/r/tree/main/skills/pdf"), {
    owner: "o",
    repo: "r",
    ref: "main",
    focusPath: "skills/pdf",
  });
  assert.deepEqual(parseGithubTarget("https://github.com/o/r/blob/main/skills/pdf/SKILL.md"), {
    owner: "o",
    repo: "r",
    ref: "main",
    focusPath: "skills/pdf",
  });
  assert.deepEqual(parseGithubTarget("o/r/tree/dev/plugins/x"), {
    owner: "o",
    repo: "r",
    ref: "dev",
    focusPath: "plugins/x",
  });
});

test("anything that is not a GitHub repository is refused", () => {
  for (const input of [
    "",
    "   ",
    "not a url",
    "https://gitlab.com/a/b",
    "https://github.com/owner",
  ])
    assert.throws(
      () => parseGithubTarget(input),
      (error) => error instanceof GithubSkillsError,
      input,
    );
});

test("a link that walks out of the repository is refused", () => {
  assert.throws(
    () => parseGithubTarget("https://github.com/a/b/tree/main/../../etc"),
    (error) => error instanceof GithubSkillsError,
  );
});

/* ------------------------------------------------------------------ */
/* Finding skills, whatever the layout                                 */
/* ------------------------------------------------------------------ */

test("a skills/ collection, a client folder, and a root skill are all found", () => {
  const candidates = discoverSkills([
    tree("skills"),
    blob("skills/pdf-processing/SKILL.md"),
    blob("skills/pdf-processing/references/FORMS.md"),
    blob(".claude/skills/code-review/SKILL.md"),
    blob(".claude/skills/code-review/scripts/run.sh"),
    blob("SKILL.md"),
    blob("src/index.ts"),
    blob("README.md"),
  ]);
  assert.deepEqual(
    candidates.map((candidate) => candidate.folder),
    ["skills/pdf-processing", ".claude/skills/code-review", ""],
  );
  // The collection skills outrank the root one: they are the common convention.
  assert.match(candidates[0].reason, /skills\//);
});

test("a plugin monorepo is found by SKILL.md rather than by layout", () => {
  const candidates = discoverSkills([
    blob("plugins/dashboard/skills/charts/SKILL.md"),
    blob("plugins/dashboard/skills/charts/assets/palette.json"),
    blob("packages/ui/docs/SKILL.md"),
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.folder).sort(), [
    "packages/ui/docs",
    "plugins/dashboard/skills/charts",
  ]);
  const charts = candidates.find((candidate) => candidate.folder.endsWith("charts"));
  assert.deepEqual(charts.files.map((file) => file.path).sort(), [
    "SKILL.md",
    "assets/palette.json",
  ]);
});

test("a skill nested inside another is its own skill, and its files are not double counted", () => {
  const candidates = discoverSkills([
    blob("skills/outer/SKILL.md"),
    blob("skills/outer/examples/inner/SKILL.md"),
    blob("skills/outer/examples/inner/references/NOTE.md"),
    blob("skills/outer/scripts/run.sh"),
  ]);
  const outer = candidates.find((candidate) => candidate.folder === "skills/outer");
  const inner = candidates.find((candidate) => candidate.folder === "skills/outer/examples/inner");
  assert.ok(outer && inner);
  assert.deepEqual(outer.files.map((file) => file.path).sort(), ["SKILL.md", "scripts/run.sh"]);
  assert.deepEqual(inner.files.map((file) => file.path).sort(), ["SKILL.md", "references/NOTE.md"]);
});

test("noise is skipped: node_modules, dist, and hidden folders", () => {
  const candidates = discoverSkills([
    blob("node_modules/pkg/SKILL.md"),
    blob("dist/SKILL.md"),
    blob("skills/real/SKILL.md"),
  ]);
  assert.deepEqual(
    candidates.map((candidate) => candidate.folder),
    ["skills/real"],
  );
});

test("a focus path keeps only the skills under it", () => {
  const candidates = discoverSkills(
    [blob("skills/a/SKILL.md"), blob("skills/b/SKILL.md"), blob("docs/SKILL.md")],
    { focusPath: "skills/b" },
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.folder),
    [""],
  );
  assert.deepEqual(
    candidates[0].files.map((file) => file.path),
    ["SKILL.md"],
  );
});

test("SKILL.md in a different case is still recognised", () => {
  const candidates = discoverSkills([blob("skills/x/skill.md")]);
  assert.equal(candidates.length, 1);
});

/* ------------------------------------------------------------------ */
/* Checking a skill against the format                                 */
/* ------------------------------------------------------------------ */

const files = (paths) =>
  paths.map((path) => ({
    path,
    kind:
      path === "SKILL.md" ? "instructions" : path.startsWith("references") ? "reference" : "asset",
    size: 10,
    text: true,
    image: false,
  }));

test("a well-formed skill is ready", () => {
  const result = assessSkill(
    { folder: "skills/pdf-processing", files: files(["SKILL.md", "references/FORMS.md"]) },
    SKILL_MD,
  );
  assert.equal(result.status, "ready");
  assert.equal(result.name, "pdf-processing");
  assert.equal(result.suggestedFolder, "pdf-processing");
  assert.deepEqual(result.counts, { instructions: 1, reference: 1 });
});

test("a name that does not match its folder is repaired on import, not reported", () => {
  const result = assessSkill(
    { folder: "skills/release-notes", files: files(["SKILL.md", "references/N.md"]) },
    SKILL_MD.replace("pdf-processing", "release-notes-writer"),
  );
  // The import writes the skill into a folder named after its frontmatter, so
  // the mismatch the format cares about is fixed rather than surfaced.
  assert.equal(result.status, "ready");
  assert.equal(result.suggestedFolder, "release-notes-writer");
});

test("a missing description is a warning", () => {
  const result = assessSkill(
    { folder: "skills/x", files: files(["SKILL.md"]) },
    "---\nname: x\n---\n\nBody\n",
  );
  assert.equal(result.status, "warning");
  assert.ok(result.warnings.some((warning) => /No description/.test(warning)));
});

test("a skill with no name is invalid, and cannot be imported", () => {
  const result = assessSkill({ folder: "skills/x", files: files(["SKILL.md"]) }, "No frontmatter.");
  assert.equal(result.status, "invalid");
  assert.ok(result.errors.length >= 1);
});

test("only SKILL.md is reported as carrying nothing extra", () => {
  const result = assessSkill(
    { folder: "skills/x", files: files(["SKILL.md"]) },
    SKILL_MD.replace("pdf-processing", "x"),
  );
  assert.ok(result.warnings.some((warning) => /carries no references/.test(warning)));
});

/* ------------------------------------------------------------------ */
/* The network, against a fake GitHub                                   */
/* ------------------------------------------------------------------ */

function fakeGithub({ entries, files, repo = {} }) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const json = (value) => ({
      ok: true,
      status: 200,
      json: async () => value,
      text: async () => JSON.stringify(value),
    });
    if (url.endsWith("/repos/o/r"))
      return json({
        name: "r",
        default_branch: "main",
        html_url: "https://github.com/o/r",
        ...repo,
      });
    if (url.includes("/git/trees/")) return json({ tree: entries });
    const raw = /raw\.githubusercontent\.com\/o\/r\/main\/(.+)$/.exec(url);
    if (raw) {
      const path = decodeURIComponent(raw[1]);
      const text = files[path];
      if (text === undefined) return { ok: false, status: 404, text: async () => "" };
      return {
        ok: true,
        status: 200,
        text: async () => text,
        arrayBuffer: async () => Buffer.from(text),
      };
    }
    return { ok: false, status: 404, text: async () => "" };
  };
  return { fetchImpl, calls };
}

test("finding skills reads the tree once, then each SKILL.md", async () => {
  const { fetchImpl, calls } = fakeGithub({
    entries: [
      blob("skills/one/SKILL.md"),
      blob("skills/one/references/R.md"),
      blob("skills/two/SKILL.md"),
      blob("README.md"),
    ],
    files: {
      "skills/one/SKILL.md": SKILL_MD,
      "skills/two/SKILL.md": "---\nname: two\n---\n",
    },
  });
  const result = await findSkillsInRepo(parseGithubTarget("o/r"), { fetchImpl });
  assert.equal(result.repo.ref, "main");
  assert.deepEqual(
    result.skills.map((skill) => [skill.folder, skill.status]),
    [
      ["skills/one", "ready"],
      ["skills/two", "warning"],
    ],
  );
  // One metadata call, one tree call, then one SKILL.md per candidate.
  assert.equal(calls.length, 4);
});

test("a repository with no SKILL.md says so", async () => {
  const { fetchImpl } = fakeGithub({
    entries: [blob("src/index.ts"), blob("README.md")],
    files: {},
  });
  await assert.rejects(
    () => findSkillsInRepo(parseGithubTarget("o/r"), { fetchImpl }),
    (error) => error instanceof GithubSkillsError && error.status === 404,
  );
});

test("a rate limit is reported as one", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    json: async () => ({}),
    text: async () => "",
  });
  await assert.rejects(
    () => findSkillsInRepo(parseGithubTarget("o/r"), { fetchImpl }),
    (error) => error instanceof GithubSkillsError && error.status === 429,
  );
});

test("a private or missing repository is reported clearly", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 404,
    json: async () => ({}),
    text: async () => "",
  });
  await assert.rejects(
    () => findSkillsInRepo(parseGithubTarget("o/r"), { fetchImpl }),
    (error) => error instanceof GithubSkillsError && /not public/.test(error.message),
  );
});

test("a chosen skill is downloaded with every file and written into ADE's folder", async () => {
  const { project, home } = await workspace();
  const { fetchImpl } = fakeGithub({
    entries: [
      blob("skills/pdf/SKILL.md"),
      blob("skills/pdf/references/FORMS.md"),
      blob("skills/pdf/assets/template.pdf"),
      blob("skills/other/SKILL.md"),
    ],
    files: {
      "skills/pdf/SKILL.md": SKILL_MD.replace("pdf-processing", "pdf"),
      "skills/pdf/references/FORMS.md": "# Forms\n",
      "skills/pdf/assets/template.pdf": "PDF",
      "skills/other/SKILL.md": "---\nname: other\ndescription: Other.\n---\n",
    },
  });

  const found = await findSkillsInRepo(parseGithubTarget("o/r"), { fetchImpl });
  const chosen = found.skills.find((skill) => skill.folder === "skills/pdf");
  const tree = await fetchSkillTree(parseGithubTarget("o/r"), chosen, {
    fetchImpl,
    branch: found.repo.ref,
  });
  assert.equal(tree.folder, "pdf");
  assert.deepEqual(tree.files.map((file) => file.path).sort(), [
    "SKILL.md",
    "assets/template.pdf",
    "references/FORMS.md",
  ]);

  const stored = await writeSkillFromFiles(
    project,
    { rootId: "ade-project", folder: tree.folder, files: tree.files },
    home,
  );
  assert.equal(stored.name, "pdf");
  assert.equal(stored.scope, "ade");
  const written = await fs.readFile(
    path.join(project, ".ade", "skills", "pdf", "references", "FORMS.md"),
    "utf8",
  );
  assert.equal(written, "# Forms\n");
});
