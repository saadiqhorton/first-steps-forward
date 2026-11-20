import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const exists = (p) =>
  fs.stat(p).then(
    () => true,
    () => false,
  );

/**
 * Where the stock ADE source comes from: the packaged `self-source/` folder, or
 * the tracked files at HEAD of a git checkout. Reasons are written for users.
 * @returns {Promise<{ available: boolean, kind?: "packaged"|"checkout", dir?: string, version: string, reason?: string }>}
 */
export async function resolveStock({ sourceRoot, run }) {
  let version = "";
  try {
    version =
      JSON.parse(await fs.readFile(path.join(sourceRoot, "package.json"), "utf8")).version ?? "";
  } catch {}
  const packaged = path.join(sourceRoot, "self-source");
  if (await exists(packaged)) return { available: true, kind: "packaged", dir: packaged, version };
  if (await exists(path.join(sourceRoot, ".git"))) {
    const git = await run("git", ["--version"], { timeout: 5000 });
    if (git.code !== 0)
      return {
        available: false,
        version,
        reason: "Customizing needs git installed on this computer.",
      };
    return { available: true, kind: "checkout", dir: sourceRoot, version };
  }
  return {
    available: false,
    version,
    reason: "This copy of ADE does not include its source, so it cannot be customized.",
  };
}

/** Put the stock source into `dest` (created here). Throws with the real failure text. */
export async function exportStock(stock, dest, { run }) {
  await fs.mkdir(dest, { recursive: true, mode: 0o700 });
  if (stock.kind === "packaged") {
    await fs.cp(stock.dir, dest, { recursive: true });
    return;
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ade-stock-"));
  try {
    const archive = path.join(tmp, "stock.tar");
    const made = await run("git", ["archive", "--format=tar", "-o", archive, "HEAD"], {
      cwd: stock.dir,
    });
    if (made.code !== 0)
      throw new Error(
        `Could not read ADE's source: ${(made.stderr || made.stdout).trim().slice(-300)}`,
      );
    const unpacked = await run("tar", ["-x", "-f", archive, "-C", dest]);
    if (unpacked.code !== 0)
      throw new Error(
        `Could not unpack ADE's source: ${(unpacked.stderr || unpacked.stdout).trim().slice(-300)}`,
      );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
