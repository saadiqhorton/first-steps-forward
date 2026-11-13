import path from "node:path";
import {
  SKILL_FILE,
  isImageFile,
  isTextFile,
  parseSkillDocument,
  skillField,
  skillFileKind,
  validateSkillDescription,
  validateSkillName,
} from "../shared/skill-format.mjs";

/**
 * Importing from GitHub cannot assume a layout. The Agent Skills spec defines
 * what is inside a skill, not where it sits in a repository, so this module
 * finds every folder that holds a `SKILL.md`, works out what each one bundles,
 * and checks it against the format before anything is written.
 *
 * Discovery and assessment are pure functions; only `findSkillsInRepo` and
 * `importSkillsFromGithub` touch the network.
 */

const MAX_CANDIDATES = 60;
const MAX_SKILL_FILES = 400;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/** Folders that never hold a skill worth importing. */
const IGNORED_SEGMENTS = new Set([
  ".git",
  ".github",
  ".next",
  ".output",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
  "venv",
]);

/** Directory names the ecosystem uses for a collection of skills. */
const COLLECTION_DIRS = new Set(["skills", "agent-skills", "agent_skills"]);

/** Dot-directories that are a client's own skill home. */
const CLIENT_DIRS = new Set([".agents", ".claude", ".ade"]);

export class GithubSkillsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isSkillFileName = (name) => name.toLowerCase() === SKILL_FILE.toLowerCase();

/**
 * Read what the user pasted. Accepts a clone URL, a browser URL (repository,
 * tree or blob), the `git@github.com:` form, or plain `owner/repo` — with a
 * branch and folder if the link carries one.
 */
export function parseGithubTarget(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) throw new GithubSkillsError(400, "Paste a GitHub repository or folder URL.");
  if (raw.length > 500) throw new GithubSkillsError(400, "That link is too long.");

  // A trailing ?query or #fragment is never part of the path.
  const cleaned = raw.replace(/[?#].*$/, "").replace(/\/+$/, "");

  // git@github.com:owner/repo.git
  const scp = /^git@github\.com:([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+?)(?:\.git)?$/.exec(cleaned);

  // Any github.com URL, with or without a protocol, with an optional tree or blob path.
  const url =
    /^(?:(?:https?|ssh|git):\/\/)?(?:[^@/]+@)?(?:www\.)?github\.com\/([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)(\/.*?)?)?$/.exec(
      cleaned,
    );

  // owner/repo, optionally owner/repo/tree/ref/path
  const shorthand =
    /^([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)(\/.*?)?)?$/.exec(
      cleaned,
    );

  let match = null;
  if (scp) match = [cleaned, scp[1], scp[2], "", ""];
  else if (url) match = url;
  else if (shorthand && !cleaned.includes("://")) match = shorthand;

  if (!match)
    throw new GithubSkillsError(
      400,
      "That is not a GitHub repository. Paste a link like https://github.com/owner/repo, or owner/repo.",
    );

  const [, owner, repo, ref, focus] = match;
  if (!owner || !repo) throw new GithubSkillsError(400, "That link is missing a repository name.");
  if (["", ".", ".."].includes(repo))
    throw new GithubSkillsError(400, "That link is not a repository.");

  let focusPath = (focus ?? "").replace(/^\/+|\/+$/g, "");
  try {
    focusPath = decodeURIComponent(focusPath);
  } catch {
    throw new GithubSkillsError(400, "That link has an unreadable path.");
  }
  // A blob link points at a file; the skill is the folder that holds it.
  if (focusPath && /\.[A-Za-z0-9]+$/.test(focusPath)) focusPath = path.posix.dirname(focusPath);
  if (focusPath === "." || focusPath === "/" || focusPath === "..") focusPath = "";
  if (focusPath.split("/").some((part) => part === ".."))
    throw new GithubSkillsError(400, "That link points outside the repository.");

  return { owner, repo, ref: (ref ?? "").trim(), focusPath };
}

/** A reason, in words, for why a folder was taken to be a skill. */
function describeLocation(folder) {
  if (!folder) return "SKILL.md at the repository root";
  const segments = folder.split("/");
  const parent = segments.at(-2) ?? "";
  const grandparent = segments.at(-3) ?? "";
  if (COLLECTION_DIRS.has(parent)) return `inside ${parent}/`;
  if (CLIENT_DIRS.has(grandparent) && COLLECTION_DIRS.has(parent))
    return `inside ${grandparent}/${parent}/`;
  if (COLLECTION_DIRS.has(segments[0])) return `inside ${segments[0]}/`;
  if (CLIENT_DIRS.has(segments[0])) return `inside ${segments[0]}/…`;
  return "found by its SKILL.md";
}

/** How likely a folder really is a skill, for ordering the list. */
function rankOf(candidate) {
  const folder = candidate.folder;
  const segments = folder ? folder.split("/") : [];
  const parent = segments.at(-2) ?? "";
  if (COLLECTION_DIRS.has(parent)) return 0;
  if (segments.length === 1) return 3;
  if (COLLECTION_DIRS.has(segments[0])) return 1;
  if (CLIENT_DIRS.has(segments[0])) return 2;
  if (segments.length === 0) return 4;
  return 5;
}

/**
 * Every folder in a repository that holds a `SKILL.md`, with the files that
 * belong to it. A skill nested inside another skill's folder is its own
 * candidate, and its files are not counted twice.
 */
export function discoverSkills(entries, { focusPath = "", maxCandidates = MAX_CANDIDATES } = {}) {
  const focusPrefix = focusPath ? `${focusPath.replace(/\/+$/, "")}/` : "";
  const blobs = (entries ?? [])
    .filter((entry) => entry && entry.type !== "tree" && typeof entry.path === "string")
    .filter((entry) => !entry.path.split("/").some((part) => IGNORED_SEGMENTS.has(part)))
    // A focus path narrows the scan to one folder, and paths become relative to it.
    .filter(
      (entry) => !focusPrefix || entry.path === focusPath || entry.path.startsWith(focusPrefix),
    )
    .map((entry) => ({
      path: focusPrefix ? entry.path.slice(focusPrefix.length) : entry.path,
      size: typeof entry.size === "number" ? entry.size : 0,
    }))
    .filter((entry) => entry.path);

  const folders = new Set();
  for (const blob of blobs) {
    const name = blob.path.split("/").at(-1);
    if (!isSkillFileName(name)) continue;
    const folder = path.posix.dirname(blob.path);
    folders.add(folder === "." ? "" : folder);
  }

  const candidates = [];
  for (const folder of folders) {
    const prefix = folder ? `${folder}/` : "";
    const files = blobs
      .filter((blob) => blob.path.startsWith(prefix))
      .filter((blob) => {
        // A nested skill's files belong to that skill, not to this one.
        const relative = blob.path.slice(prefix.length);
        if (!relative) return false;
        for (const other of folders) {
          if (other === folder || !other.startsWith(prefix)) continue;
          if (blob.path.startsWith(`${other}/`)) return false;
        }
        return true;
      })
      .map((blob) => {
        const relative = blob.path.slice(prefix.length);
        return {
          path: relative,
          kind: skillFileKind(relative),
          size: blob.size,
          text: isTextFile(relative),
          image: isImageFile(relative),
        };
      })
      .slice(0, MAX_SKILL_FILES);

    if (!files.length) continue;
    candidates.push({
      folder,
      files,
      reason: describeLocation(folder),
      rank: rankOf({ folder }),
    });
  }

  return candidates
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.folder.split("/").length - b.folder.split("/").length ||
        a.folder.localeCompare(b.folder),
    )
    .slice(0, maxCandidates);
}

/** What a folder's files say about it, before its `SKILL.md` is read. */
export function summarizeFiles(files) {
  const counts = {};
  let bytes = 0;
  for (const file of files) {
    counts[file.kind] = (counts[file.kind] ?? 0) + 1;
    bytes += file.size ?? 0;
  }
  return { counts, bytes, fileCount: files.length };
}

/**
 * Judge one skill against the format, using the text of its `SKILL.md`.
 * `ready` means it can be imported as written; `warning` means it imports but
 * will not behave well; `invalid` means the format would reject it.
 */
export function assessSkill({ folder, files, repoName = "" }, skillMarkdown) {
  const document = parseSkillDocument(typeof skillMarkdown === "string" ? skillMarkdown : "");
  const name = skillField(document, "name");
  const description = skillField(document, "description");
  const warnings = [];
  const errors = [];

  const nameError = validateSkillName(name);
  if (nameError) errors.push(nameError.replace("A name is required.", "SKILL.md has no name."));
  if (!document.hasFrontmatter) errors.push("SKILL.md has no frontmatter block.");
  const descriptionError = validateSkillDescription(description);
  if (descriptionError)
    warnings.push(
      descriptionError === "A description is required."
        ? "No description, so an agent cannot tell when to use this skill."
        : descriptionError,
    );

  const summary = summarizeFiles(files);
  const extras = Object.keys(summary.counts).filter((kind) => kind !== "instructions");
  if (!extras.length)
    warnings.push("Only SKILL.md, so this skill carries no references, scripts or assets.");

  const status = errors.length ? "invalid" : warnings.length ? "warning" : "ready";
  return {
    status,
    name: name || folder || repoName,
    // The folder written on import: the frontmatter name when it is valid, else
    // the folder it was found in, else the repository name.
    suggestedFolder: (() => {
      if (name && !validateSkillName(name)) return name;
      const basename = folder ? folder.split("/").at(-1) : "";
      if (basename && !validateSkillName(basename)) return basename;
      if (repoName && !validateSkillName(repoName)) return repoName;
      return "imported-skill";
    })(),
    description,
    license: skillField(document, "license"),
    counts: summary.counts,
    bytes: summary.bytes,
    fileCount: summary.fileCount,
    warnings,
    errors,
  };
}

/* ------------------------------------------------------------------ */
/* Network                                                             */
/* ------------------------------------------------------------------ */

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

const encodePath = (value) => value.split("/").map(encodeURIComponent).join("/");

/** A path inside the repository: the focus folder first, then the skill's own. */
const repoPath = (...parts) => parts.filter((part) => part && part !== ".").join("/");

async function requestJson(url, { token, fetchImpl }) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "ade-skills-import",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetchImpl(url, { headers });
  } catch {
    throw new GithubSkillsError(502, "GitHub could not be reached. Check your connection.");
  }
  if (response.status === 404)
    throw new GithubSkillsError(404, "That repository or folder is not public, or does not exist.");
  if (response.status === 403 || response.status === 429)
    throw new GithubSkillsError(
      429,
      "GitHub's rate limit was reached. Try again shortly, or set ADE_GITHUB_TOKEN for a higher limit.",
    );
  if (!response.ok) throw new GithubSkillsError(502, `GitHub answered ${response.status}.`);
  return response.json();
}

async function requestText(url, { token, fetchImpl }) {
  const headers = { "user-agent": "ade-skills-import" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, { headers });
  if (!response.ok)
    throw new GithubSkillsError(502, `Could not read ${url.slice(RAW.length + 1)} from GitHub.`);
  return response.text();
}

/**
 * Find every skill in a repository, ordered by how likely each one is the
 * skill the user meant, with each one checked against the format.
 */
export async function findSkillsInRepo(target, options = {}) {
  const { token = "", fetchImpl = globalThis.fetch } = options;
  const ref = target.ref ? `?ref=${encodeURIComponent(target.ref)}` : "";
  const repo = await requestJson(`${API}/repos/${target.owner}/${target.repo}`, {
    token,
    fetchImpl,
  });
  const branch = target.ref || repo.default_branch || "main";
  const tree = await requestJson(
    `${API}/repos/${target.owner}/${target.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { token, fetchImpl },
  );

  const candidates = discoverSkills(tree.tree ?? [], { focusPath: target.focusPath });
  if (!candidates.length)
    throw new GithubSkillsError(
      404,
      target.focusPath
        ? `No SKILL.md under ${target.focusPath} in ${target.owner}/${target.repo}.`
        : `No SKILL.md anywhere in ${target.owner}/${target.repo}.`,
    );

  const skills = [];
  for (const candidate of candidates) {
    const skillFile = candidate.files.find((file) => file.path === SKILL_FILE) ?? null;
    let markdown = "";
    if (skillFile) {
      const rawPath = repoPath(target.focusPath, candidate.folder, SKILL_FILE);
      try {
        markdown = await requestText(
          `${RAW}/${target.owner}/${target.repo}/${branch}/${encodePath(rawPath)}`,
          {
            token,
            fetchImpl,
          },
        );
      } catch {
        markdown = "";
      }
    }
    const assessment = assessSkill({ ...candidate, repoName: repo.name ?? target.repo }, markdown);
    skills.push({
      folder: candidate.folder,
      reason: candidate.reason,
      // The file list travels with the skill so the chosen ones can be fetched
      // without walking the tree a second time.
      files: candidate.files,
      ...assessment,
    });
  }

  skills.sort((a, b) => {
    const weight = { ready: 0, warning: 1, invalid: 2 };
    const gap = (weight[a.status] ?? 3) - (weight[b.status] ?? 3);
    if (gap !== 0) return gap;
    return a.folder.localeCompare(b.folder);
  });

  return {
    repo: {
      owner: target.owner,
      name: repo.name ?? target.repo,
      ref: branch,
      url: repo.html_url ?? `https://github.com/${target.owner}/${target.repo}`,
      description: repo.description ?? "",
      private: repo.private === true,
    },
    skills,
  };
}

/** Fetch a list of things with a small amount of parallelism. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Download one skill's files. GitHub is happy with a few at a time; not many. */
export async function fetchSkillTree(target, skill, options = {}) {
  const { token = "", fetchImpl = globalThis.fetch, branch } = options;
  const total = skill.files.reduce((sum, file) => sum + (file.size ?? 0), 0);
  if (total > MAX_TOTAL_BYTES) throw new GithubSkillsError(413, "This skill is larger than 64 MB.");
  const tooBig = skill.files.find((file) => (file.size ?? 0) > MAX_FILE_BYTES);
  if (tooBig) throw new GithubSkillsError(413, `${tooBig.path} is larger than 16 MB.`);

  const files = await mapLimit(skill.files, 6, async (file) => {
    const rawPath = repoPath(target.focusPath, skill.folder, file.path);
    const headers = { "user-agent": "ade-skills-import" };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetchImpl(
      `${RAW}/${target.owner}/${target.repo}/${branch}/${encodePath(rawPath)}`,
      { headers },
    );
    if (!response.ok) throw new GithubSkillsError(502, `Could not read ${rawPath} from GitHub.`);
    return { path: file.path, bytes: Buffer.from(await response.arrayBuffer()) };
  });
  return { folder: skill.suggestedFolder, files };
}
