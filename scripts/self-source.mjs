// The source of ADE itself, shipped inside the npm package as `self-source/` so
// Customize ADE can make a private copy of exactly this version (its stock source).
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

/** Top-level folders that are never part of ADE's source. */
const EXCLUDED_TOP = new Set([
  "node_modules",
  ".output",
  "artifacts",
  "cook",
  "cook-archive",
  "tmp",
  ".pack",
]);

/** Files that look like secrets or private machine state. */
const SECRET_LIKE = [
  /(^|\/)\.env(\..*)?$/,
  /\.pem$/,
  /\.key$/,
  /(^|\/)settings\.local\.json$/,
  /(^|\/)remote-token$/,
];

export const isSecretLike = (file) => SECRET_LIKE.some((pattern) => pattern.test(file));

/** Tracked files of the checkout that belong in the package, as posix paths. */
export function selfSourceFiles(root) {
  const listed = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  return listed.filter((file) => !EXCLUDED_TOP.has(file.split("/")[0]) && !isSecretLike(file));
}

/** Copy the source into `dest`, then prove nothing secret-like came along. */
export async function stageSelfSource(root, dest) {
  for (const file of selfSourceFiles(root)) {
    const target = path.join(dest, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(root, file), target);
  }
  await assertNoSecrets(dest);
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

/** @throws {Error} naming every secret-like file under `dir` */
export async function assertNoSecrets(dir) {
  const found = (await walk(dir)).filter(isSecretLike);
  if (found.length)
    throw new Error(`self-source must not contain secret-like files: ${found.join(", ")}`);
}
