// Where a project can come from besides "a folder that already exists": a Git
// repository cloned into a chosen location, or a brand-new folder. Everything
// here is argument-array based (nothing is interpolated into a shell) and
// takes ADE's `run` helper as a parameter so it can be exercised in tests.
import { promises as fs } from "node:fs";
import path from "node:path";

export class SourceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SourceError";
    this.status = status;
  }
}

const CLONE_TIMEOUT_MS = 10 * 60 * 1000;
const GITHUB_SHORTHAND = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]+)$/;
const SCP_LIKE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:(?!\/)[A-Za-z0-9._~/-]+$/;
const BARE_HOST_PATH = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\/[^\s]+$/;

const stripGitSuffix = (segment) => segment.replace(/\.git$/i, "");
const lastSegment = (value) => stripGitSuffix(value.replace(/\/+$/, "").split(/[/:]/).pop() ?? "");

/**
 * Turn what a person pastes into a clone URL. Accepts `owner/repo` (GitHub),
 * `github.com/owner/repo`, https and ssh URLs, and `git@host:owner/repo.git`.
 * Everything else — local paths, `ext::` helpers, `file://`, URLs that embed a
 * password — is refused, so the value handed to `git clone` can only ever
 * reach a remote host.
 */
export function parseRepoSource(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: false, error: "Enter a GitHub repository, like owner/repo." };
  if (/\s|[\u0000-\u001f\u007f]/.test(raw) || raw.startsWith("-"))
    return { ok: false, error: "That does not look like a repository address." };

  const shorthand = GITHUB_SHORTHAND.exec(raw);
  if (shorthand) {
    const repo = stripGitSuffix(shorthand[2]);
    if (!repo || repo === "." || repo === "..")
      return { ok: false, error: "That does not look like a repository address." };
    return { ok: true, url: `https://github.com/${shorthand[1]}/${repo}.git`, name: repo };
  }
  if (SCP_LIKE.test(raw)) {
    const name = lastSegment(raw);
    return name
      ? { ok: true, url: raw, name }
      : { ok: false, error: "That does not look like a repository address." };
  }

  let candidate = raw;
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(candidate) && BARE_HOST_PATH.test(candidate))
    candidate = `https://${candidate}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      ok: false,
      error: "Use owner/repo, an https:// or ssh:// URL, or git@host:owner/repo.git.",
    };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "ssh:")
    return { ok: false, error: "Only https:// and ssh:// repository addresses are supported." };
  if (parsed.password || (parsed.protocol === "https:" && parsed.username))
    return {
      ok: false,
      error:
        "Leave credentials out of the address. Sign in with `gh auth login`, a git credential helper, or use an SSH address.",
    };
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 1 || !parsed.hostname)
    return { ok: false, error: "That address does not name a repository." };
  // A pasted browser URL (…/owner/repo/tree/main) means the repository itself.
  const repoSegments = parsed.hostname === "github.com" ? segments.slice(0, 2) : segments;
  if (parsed.hostname === "github.com" && repoSegments.length < 2)
    return { ok: false, error: "That address does not name a repository." };
  const name = stripGitSuffix(repoSegments[repoSegments.length - 1]);
  if (!name || name === "." || name === "..")
    return { ok: false, error: "That address does not name a repository." };
  parsed.pathname = `/${repoSegments.join("/")}`;
  parsed.search = "";
  parsed.hash = "";
  return { ok: true, url: parsed.toString(), name };
}

/** Returns an error message for a name that cannot be one folder, else null. */
export function folderNameError(name) {
  if (typeof name !== "string" || !name.trim()) return "Enter a folder name.";
  if (name !== name.trim()) return "The folder name cannot start or end with a space.";
  if (name === "." || name === "..") return "Choose a different folder name.";
  if (name.length > 255) return "That folder name is too long.";
  if (/[/\\<>:"|?*\u0000-\u001f\u007f]/.test(name))
    return 'A folder name cannot contain / \\ < > : " | ? * or control characters.';
  if (name.endsWith(".")) return "The folder name cannot end with a dot.";
  return null;
}

/** Same expansion every ADE route applies to a path a person typed. */
export function expandUserPath(requested, home) {
  const value = String(requested ?? "").trim();
  return value.startsWith("~") ? path.join(home, value.slice(1)) : path.resolve(value);
}

async function existingDirectory(requested, home, what) {
  const value = String(requested ?? "").trim();
  if (!value) throw new SourceError(400, `Choose ${what}.`);
  let real;
  try {
    real = await fs.realpath(expandUserPath(value, home));
    if (!(await fs.stat(real)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new SourceError(400, `${what[0].toUpperCase()}${what.slice(1)} does not exist.`);
  }
  return real;
}

async function createDirectory(parent, name) {
  const nameError = folderNameError(name);
  if (nameError) throw new SourceError(400, nameError);
  const target = path.join(parent, name);
  try {
    await fs.mkdir(target);
  } catch (error) {
    if (error?.code === "EEXIST")
      throw new SourceError(409, `A file or folder named "${name}" already exists there.`);
    if (error?.code === "EACCES" || error?.code === "EPERM")
      throw new SourceError(403, `ADE is not allowed to create folders in ${parent}.`);
    throw new SourceError(400, `Could not create the folder: ${error?.message ?? error}`);
  }
  return target;
}

/** Create one empty folder inside an existing directory (used by the picker). */
export async function makeDirectory({ parent, name, home }) {
  const real = await existingDirectory(parent, home, "the location for the new folder");
  return createDirectory(real, name);
}

/** Create a project folder, optionally initialized as a Git repository. */
export async function createProjectFolder({ run, parent, name, git, home }) {
  const real = await existingDirectory(parent, home, "the location for the new project");
  const target = await createDirectory(real, name);
  if (git) {
    const init = await run("git", ["init", "-q"], { cwd: target, timeout: 15_000 });
    if (init.code !== 0) {
      await fs.rm(target, { recursive: true, force: true });
      throw new SourceError(
        init.code === 127 ? 501 : 500,
        init.code === 127
          ? "Git is not installed, so the repository could not be initialized. Nothing was created."
          : `git init failed: ${clean(init.stderr) || "unknown error"}. Nothing was created.`,
      );
    }
  }
  return target;
}

/** Credentials never belong in an error message the UI will display. */
export function redactCredentials(text) {
  return String(text ?? "").replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/@]+@/g, "$1***@");
}

// git's last few "fatal:" lines, as one readable sentence with no trailing dot.
function clean(stderr) {
  const lines = redactCredentials(stderr)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fatal = lines.filter((line) => /^(fatal|error):/i.test(line));
  return (fatal.length ? fatal : lines)
    .slice(-3)
    .map((line) => line.replace(/^(fatal|error):\s*/i, "").replace(/[.\s]+$/, ""))
    .join(". ")
    .slice(0, 400);
}

const AUTH_FAILURE =
  /could not read (?:username|password)|authentication failed|terminal prompts disabled|permission denied \(publickey|host key verification failed|repository not found|invalid credentials/i;

/** Clone `url` into `<parent>/<name>`; the destination must not exist yet. */
export async function cloneRepository({ run, url, parent, name, home }) {
  const real = await existingDirectory(parent, home, "the folder to clone into");
  const nameError = folderNameError(name);
  if (nameError) throw new SourceError(400, nameError);
  const destination = path.join(real, name);
  const taken = await fs.lstat(destination).then(
    () => true,
    () => false,
  );
  if (taken)
    throw new SourceError(409, `A file or folder named "${name}" already exists in ${real}.`);
  const env = {
    // A credential prompt has no terminal to answer it; fail fast instead.
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
  };
  if (!process.env.GIT_SSH_COMMAND && !process.env.GIT_SSH)
    env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
  const result = await run("git", ["clone", "--", url, destination], {
    timeout: CLONE_TIMEOUT_MS,
    env,
  });
  if (result.code !== 0) {
    // The destination did not exist when we started, so whatever is there now
    // is the partial clone.
    await fs.rm(destination, { recursive: true, force: true });
    if (result.code === 127)
      throw new SourceError(501, "Git is not installed, so ADE cannot clone repositories.");
    if (result.timedOut)
      throw new SourceError(504, "Cloning took longer than 10 minutes and was stopped.");
    const detail = clean(result.stderr);
    const hint = AUTH_FAILURE.test(result.stderr)
      ? " If the repository is private, sign in with `gh auth login` (or set up a git credential helper), or use an SSH address with a key loaded in ssh-agent."
      : "";
    throw new SourceError(400, `Could not clone the repository: ${detail || "git failed"}.${hint}`);
  }
  return destination;
}
