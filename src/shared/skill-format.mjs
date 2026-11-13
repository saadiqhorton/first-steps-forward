/**
 * The Agent Skills format (https://agentskills.io/specification): a skill is a
 * directory with a `SKILL.md` whose YAML frontmatter carries `name` and
 * `description` (both required) plus optional `license`, `compatibility`,
 * `metadata` and `allowed-tools`. The folder may also bundle `scripts/`,
 * `references/`, `assets/` and anything else.
 *
 * These helpers are pure so the workspace UI and the local API can agree on
 * what a skill is without sharing any file-system code.
 */

export const SKILL_FILE = "SKILL.md";

export const SKILL_FILE_KINDS = {
  instructions: "Instructions",
  reference: "Reference",
  script: "Script",
  asset: "Asset",
  agent: "Agent config",
  other: "Other",
};

/** Extensions the workspace can show and edit as text. */
const TEXT_EXTENSIONS = new Set([
  "bash",
  "c",
  "cfg",
  "cjs",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "env",
  "go",
  "h",
  "hpp",
  "htm",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsonc",
  "jsx",
  "md",
  "mdx",
  "mjs",
  "php",
  "properties",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svg",
  "swift",
  "toml",
  "ts",
  "tsv",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);

/** Extensions a browser can render on its own. */
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"]);

const CONTENT_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  woff2: "font/woff2",
};

const extensionOf = (path) => {
  const name =
    String(path ?? "")
      .split("/")
      .at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/** Whether a bundled file is text the workspace can edit. */
export function isTextFile(path) {
  return TEXT_EXTENSIONS.has(extensionOf(path));
}

/** Whether a bundled file is an image a browser can show. */
export function isImageFile(path) {
  return IMAGE_EXTENSIONS.has(extensionOf(path));
}

/** The content type to serve a bundled file with. */
export function fileContentType(path) {
  const extension = extensionOf(path);
  if (CONTENT_TYPES[extension]) return CONTENT_TYPES[extension];
  return isTextFile(path) ? "text/plain; charset=utf-8" : "application/octet-stream";
}

/** The kind of a bundled file, from where it sits inside the skill folder. */
export function skillFileKind(path) {
  const clean = String(path ?? "").replace(/^\/+/, "");
  if (clean === SKILL_FILE) return "instructions";
  const top = clean.split("/")[0];
  if (top === "references") return "reference";
  if (top === "scripts") return "script";
  if (top === "assets") return "asset";
  if (top === "agents") return "agent";
  return "other";
}

/** The reference directory names the format recommends, in the order they load. */
export const SKILL_KIND_ORDER = ["instructions", "reference", "script", "asset", "agent", "other"];

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The format's rule for `name`: lowercase letters, digits and single hyphens. */
export function validateSkillName(name) {
  const value = typeof name === "string" ? name.trim() : "";
  if (!value) return "A name is required.";
  if (value.length > 64) return "Names are at most 64 characters.";
  if (!NAME_PATTERN.test(value)) return "Use lowercase letters, numbers, and single hyphens only.";
  return null;
}

/** The format's rule for `description`: non-empty and at most 1024 characters. */
export function validateSkillDescription(description) {
  const value = typeof description === "string" ? description.trim() : "";
  if (!value) return "A description is required.";
  if (value.length > 1024) return "Descriptions are at most 1024 characters.";
  return null;
}

/** The name a skill folder should carry, and the one its frontmatter should match. */
export function skillNameMismatch(folder, name) {
  const left = String(folder ?? "").trim();
  const right = String(name ?? "").trim();
  if (!left || !right || left === right) return null;
  return `name “${right}” does not match the folder “${left}”`;
}

function unquote(value) {
  const text = value.trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'"))
      return text.slice(1, -1);
  }
  return text;
}

function formatScalar(value) {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (text === "") return '""';
  if (/^[\s]|[\s]$/.test(text)) return JSON.stringify(text);
  if (/[:#\[\]{}&*!|>'"%@`]/.test(text) || /:\s/.test(text)) return JSON.stringify(text);
  return text;
}

/**
 * Read the frontmatter of a `SKILL.md`. Unknown keys are kept so a skill
 * written for another client (or an older ADE) survives a round trip.
 */
export function parseSkillDocument(text) {
  const source = typeof text === "string" ? text : "";
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!match) return { fields: [], metadata: {}, body: source, hasFrontmatter: false };
  const fields = [];
  const metadata = {};
  let inMetadata = false;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^\s/.test(line)) {
      if (!inMetadata) continue;
      const nested = /^\s+([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
      if (nested) metadata[nested[1]] = unquote(nested[2]);
      continue;
    }
    const entry = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!entry) continue;
    const [, key, rawValue] = entry;
    if (!rawValue.trim() && key === "metadata") {
      inMetadata = true;
      fields.push({ key, value: "" });
      continue;
    }
    inMetadata = false;
    fields.push({ key, value: unquote(rawValue) });
  }
  return { fields, metadata, body: source.slice(match[0].length), hasFrontmatter: true };
}

/** Write a `SKILL.md` back out with its frontmatter and body. */
export function serializeSkillDocument({ fields = [], metadata = {}, body = "" } = {}) {
  const lines = ["---"];
  const seen = new Set();
  for (const field of fields) {
    if (field.key === "metadata") {
      seen.add("metadata");
      const entries = Object.entries(metadata ?? {});
      if (!entries.length) continue;
      lines.push("metadata:");
      for (const [key, value] of entries) lines.push(`  ${key}: ${formatScalar(value)}`);
      continue;
    }
    seen.add(field.key);
    lines.push(`${field.key}: ${formatScalar(field.value)}`);
  }
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (seen.has("metadata")) continue;
    lines.push(`metadata:`);
    lines.push(`  ${key}: ${formatScalar(value)}`);
  }
  lines.push("---", "");
  const text = typeof body === "string" ? body : "";
  return `${lines.join("\n")}\n${text.replace(/^\n+/, "")}`;
}

/** The frontmatter value for one key, or an empty string. */
export function skillField(document, key) {
  const field = document?.fields?.find((entry) => entry.key === key);
  return field ? field.value : "";
}

/** Build the `SKILL.md` text for a skill the workspace is saving. */
export function buildSkillDocument({
  name,
  description,
  body = "",
  license = "",
  compatibility = "",
  metadata = {},
  allowedTools = "",
  extra = {},
} = {}) {
  const fields = [];
  fields.push({ key: "name", value: name ?? "" });
  fields.push({ key: "description", value: description ?? "" });
  if (license) fields.push({ key: "license", value: license });
  if (compatibility) fields.push({ key: "compatibility", value: compatibility });
  if (allowedTools) fields.push({ key: "allowed-tools", value: allowedTools });
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    fields.push({ key, value: String(value) });
  }
  return serializeSkillDocument({ fields, metadata, body });
}

/** A short label for a skill's location, relative to the project or the home folder. */
export function skillLocation(rootPath, projectPath, home) {
  const root = String(rootPath ?? "");
  if (projectPath && root.startsWith(projectPath))
    return root.slice(projectPath.length).replace(/^\/+/, "") || ".";
  if (home && root.startsWith(home)) return `~${root.slice(home.length)}`;
  return root;
}
