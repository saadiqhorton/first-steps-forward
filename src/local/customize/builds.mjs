// Kept versions of ADE: `<DATA_DIR>/self/builds/<sha>/` is the user's copy at
// one commit of `mine`, with its build output, ready for the launcher to run.
// `current.json` names the version `ade` starts: { sha, version, previous }.
// A null sha means stock ADE (every kept change was removed).
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
];

/**
 * Only what decides the installed packages: the dependency fields of
 * package.json and the lockfile's packages, without the project's own name
 * and version. A release that only bumps ADE's version must not reinstall
 * ~0.7 GB of build tools. Unparsable files hash as written.
 */
function depsOnly(manifest, lock) {
  try {
    const pkg = JSON.parse(manifest || "{}");
    const lockJson = JSON.parse(lock || "{}");
    const packages = { ...(lockJson.packages ?? {}) };
    if (packages[""]) {
      const { name: _name, version: _version, ...root } = packages[""];
      packages[""] = root;
    }
    return JSON.stringify([DEP_FIELDS.map((key) => pkg[key] ?? null), packages]);
  } catch {
    return `${manifest}\0${lock}`;
  }
}

/** What a folder's dependencies are, as one hash of package.json and package-lock.json. */
export const hashDeps = (manifest, lock) =>
  createHash("sha256").update(depsOnly(manifest, lock)).digest("hex");

export async function depsHash(dir) {
  const read = (name) => fs.readFile(path.join(dir, name), "utf8").catch(() => "");
  return hashDeps(await read("package.json"), await read("package-lock.json"));
}

/**
 * Give `dir` its dependencies: linked from the private copy when `dir` needs the
 * same ones the copy installed (`installed` is their hash; unknown counts as the
 * same), else its own `npm ci`.
 * @throws {Error} with npm's last lines
 */
export async function provideDeps({ paths, run, dir, installed, home, timeout = 600_000 }) {
  if (!installed || (await depsHash(dir)) === installed) {
    // A junction needs no admin rights on Windows.
    await fs.symlink(
      path.join(paths.source, "node_modules"),
      path.join(dir, "node_modules"),
      "junction",
    );
    return;
  }
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  const result = await run("npm", ["ci", "--no-audit", "--no-fund"], {
    cwd: dir,
    env: { HOME: home, USERPROFILE: home, CI: "1" },
    timeout,
  });
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
  if (result.code !== 0 || result.timedOut)
    throw new Error(
      `Installing build tools failed: ${tail(`${result.stdout}\n${result.stderr}`, 12)}`,
    );
}

/** The folder a kept version lives in. */
export const buildDir = (paths, sha) => path.join(paths.builds, sha);

/** A kept version the launcher can start: its launcher and built UI are there. */
export const usableBuild = (paths, sha) =>
  !!sha &&
  /^[0-9a-f]{7,64}$/.test(sha) &&
  existsSync(path.join(buildDir(paths, sha), "bin", "ade.mjs")) &&
  existsSync(path.join(buildDir(paths, sha), ".output", "public"));

/**
 * `current.json`, or null when there is none (stock ADE) or it cannot be read.
 * @returns {Promise<{ sha: string|null, version: string, previous: { sha: string|null } | null } | null>}
 */
export async function readCurrent(paths) {
  try {
    const saved = JSON.parse(await fs.readFile(paths.current, "utf8"));
    if (!saved || typeof saved !== "object") return null;
    return {
      sha: typeof saved.sha === "string" ? saved.sha : null,
      version: String(saved.version ?? ""),
      previous:
        saved.previous && typeof saved.previous === "object"
          ? { sha: typeof saved.previous.sha === "string" ? saved.previous.sha : null }
          : null,
    };
  } catch {
    return null;
  }
}

/** Write `current.json` atomically with private permissions. */
export async function writeCurrent(paths, current) {
  await fs.mkdir(path.dirname(paths.current), { recursive: true, mode: 0o700 });
  const tmp = `${paths.current}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(current, null, 2), { mode: 0o600 });
  await fs.rename(tmp, paths.current);
}

/**
 * Point `current.json` at `sha` (null = stock); what ran before becomes `previous`.
 * @returns {Promise<{ sha: string|null, version: string, previous: { sha: string|null } | null }>}
 */
export async function setCurrent(paths, sha, version) {
  const before = await readCurrent(paths);
  const previous = before
    ? before.sha === sha
      ? before.previous
      : { sha: before.sha }
    : sha
      ? { sha: null }
      : null;
  const next = { sha, version, previous };
  await writeCurrent(paths, next);
  return next;
}

/** Remove kept versions other than current and previous (and half-made ones). */
export async function pruneBuilds(paths) {
  const current = await readCurrent(paths);
  const keep = new Set([current?.sha, current?.previous?.sha].filter(Boolean));
  const names = await fs.readdir(paths.builds).catch(() => []);
  for (const name of names)
    if (!keep.has(name))
      await fs.rm(path.join(paths.builds, name), { recursive: true, force: true }).catch(() => {});
}

const tail = (text, n = 40) => text.trim().split(/\r?\n/).slice(-n).join("\n");

/**
 * Make `builds/<sha>/`: the tracked files of `sha`, node_modules linked from
 * the private copy, and `.output` either moved in from `output` (the checks
 * already built this exact tree) or built here. Built in `<sha>.partial` and
 * renamed when complete, so a failure leaves nothing half-made.
 * @param {{ paths: ReturnType<typeof import("./paths.mjs").selfPaths>, run: typeof import("../spawn.mjs").runCommand, sha: string, output?: string|null, timeout?: number, installed?: string|null }} options
 * @throws {Error} with the build's last output lines
 */
export async function prepareBuild({
  paths,
  run,
  sha,
  output = null,
  timeout = 600_000,
  installed = null,
}) {
  const dir = buildDir(paths, sha);
  if (usableBuild(paths, sha)) {
    if (output) await fs.rm(output, { recursive: true, force: true }).catch(() => {});
    return dir;
  }
  const partial = `${dir}.partial`;
  await fs.rm(partial, { recursive: true, force: true });
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(partial, { recursive: true, mode: 0o700 });
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "ade-build-"));
  try {
    const archive = path.join(scratch, "build.tar");
    const made = await run("git", ["archive", "--format=tar", "-o", archive, sha], {
      cwd: paths.source,
    });
    if (made.code !== 0)
      throw new Error(`Could not read your version: ${tail(made.stderr || made.stdout, 4)}`);
    const unpacked = await run("tar", ["-x", "-f", archive, "-C", partial]);
    if (unpacked.code !== 0)
      throw new Error(`Could not unpack your version: ${tail(unpacked.stderr, 4)}`);
    // Dependencies come from the private copy, unless this version changed them.
    await provideDeps({
      paths,
      run,
      dir: partial,
      installed,
      home: path.join(paths.homes, `deps-${sha.slice(0, 12)}`),
      timeout,
    });
    if (output) await fs.rename(output, path.join(partial, ".output"));
    else {
      const home = path.join(paths.homes, `build-${sha.slice(0, 12)}`);
      await fs.mkdir(home, { recursive: true, mode: 0o700 });
      const built = await run("npm", ["run", "build"], {
        cwd: partial,
        env: { HOME: home, USERPROFILE: home, CI: "1" },
        timeout,
      });
      await fs.rm(home, { recursive: true, force: true }).catch(() => {});
      if (built.code !== 0 || built.timedOut)
        throw Object.assign(
          new Error(
            built.timedOut
              ? "Building your version took too long."
              : "Building your version failed.",
          ),
          { output: tail(`${built.stdout}\n${built.stderr}`) },
        );
    }
    if (!existsSync(path.join(partial, ".output", "public")))
      throw new Error("Building your version left no app to serve.");
    await fs.rename(partial, dir);
    return dir;
  } catch (error) {
    await fs.rm(partial, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
    if (output) await fs.rm(output, { recursive: true, force: true }).catch(() => {});
  }
}
