import { promises as fs } from "node:fs";
import path from "node:path";
import { exportStock } from "./source.mjs";
import { depsHash } from "./builds.mjs";
import { createGit } from "./git.mjs";
import { SELF_PROJECT_ID } from "./paths.mjs";

/** Top-level packages `npm ci` installs, from the lockfile; null when there is none. */
export async function lockedPackages(dir) {
  try {
    const lock = JSON.parse(await fs.readFile(path.join(dir, "package-lock.json"), "utf8"));
    return Object.entries(lock.packages ?? {})
      .filter(([key, entry]) => /^node_modules\/(@[^/]+\/)?[^/]+$/.test(key) && !entry?.link)
      .map(([key]) => key);
  } catch {
    return null;
  }
}

/** How many of `packages` have landed in `dir` so far. */
export async function installedCount(dir, packages) {
  const found = await Promise.all(
    packages.map((key) =>
      fs.access(path.join(dir, key, "package.json")).then(
        () => true,
        () => false,
      ),
    ),
  );
  return found.filter(Boolean).length;
}

const IGNORED = ["node_modules", "dist", ".output", ".vinxi", ".tanstack", ".nitro"];

/** The hidden project record the agent's sessions live under. */
export const selfProjectRecord = (ctx) => ({
  id: SELF_PROJECT_ID,
  kind: "ade-self",
  hidden: true,
  name: "ADE (your copy)",
  path: ctx.paths.source,
  branch: "mine",
  ahead: 0,
  uncommittedFiles: [],
  defaultAgent: "codex",
  addedAt: ctx.now(),
});

export async function registerSelfProject(ctx) {
  const projects = ctx.appState.projects;
  const existing = projects.find((project) => project.id === SELF_PROJECT_ID);
  if (existing) {
    Object.assign(existing, { kind: "ade-self", hidden: true, path: ctx.paths.source });
  } else projects.push(selfProjectRecord(ctx));
  if (ctx.appState.deletedProjects) delete ctx.appState.deletedProjects[SELF_PROJECT_ID];
  await ctx.saveApp();
}

/**
 * copy → install → save. Everything happens in `source.partial`, renamed to
 * `source` only when complete, so a failure leaves no half-made copy.
 */
export async function runSetup(ctx) {
  const { data, paths, run } = ctx;
  const step = (name, label) => {
    data.setup = { status: "running", step: name, progress: { done: 0, total: null, label } };
    ctx.changed();
  };
  try {
    await fs.rm(paths.partial, { recursive: true, force: true });
    await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
    const stock = await ctx.resolveStock();
    if (!stock.available) throw new Error(stock.reason);

    step("copy", "Copying ADE's source");
    await exportStock(stock, paths.partial, { run });

    step("install", "Installing build tools");
    const home = path.join(paths.homes, "setup");
    await fs.mkdir(home, { recursive: true, mode: 0o700 });
    const started = ctx.now();
    const packages = await lockedPackages(paths.partial);
    const total = packages?.length || null;
    if (total) data.setup.progress = { done: 0, total, label: `0 of ${total} packages` };
    let counting = false;
    const ticker = setInterval(async () => {
      if (counting) return;
      counting = true;
      try {
        let progress;
        if (total && packages) {
          const done = Math.min(total, await installedCount(paths.partial, packages));
          progress = { done, total, label: `${done} of ${total} packages` };
        } else {
          const seconds = Math.round((ctx.now() - started) / 1000);
          progress = { done: seconds, total: null, label: `Installing build tools · ${seconds}s` };
        }
        if (data.setup.status === "running" && data.setup.step === "install") {
          data.setup.progress = progress;
          ctx.changed();
        }
      } finally {
        counting = false;
      }
    }, 2000);
    ticker.unref?.();
    let install;
    try {
      install = await run("npm", ["ci", "--no-audit", "--no-fund"], {
        cwd: paths.partial,
        env: { HOME: home, USERPROFILE: home, CI: "1" },
      });
    } finally {
      clearInterval(ticker);
    }
    if (install.code !== 0)
      throw new Error(
        `Installing build tools failed: ${(install.stderr || install.stdout).trim().split(/\r?\n/).slice(-12).join("\n")}`,
      );

    step("save", "Saving your copy");
    const git = createGit({ run, cwd: paths.partial });
    await git.must(["init"]);
    await git.must(["symbolic-ref", "HEAD", "refs/heads/stock"]);
    await fs.mkdir(path.join(paths.partial, ".git", "info"), { recursive: true });
    await fs.appendFile(
      path.join(paths.partial, ".git", "info", "exclude"),
      `${IGNORED.join("\n")}\n`,
    );
    await git.must(["add", "-A"]);
    await git.must(["commit", "--allow-empty", "-m", `ADE ${stock.version || "stock"}`]);
    await git.must(["branch", "mine"]);
    await git.must(["checkout", "mine"]);
    data.installedDeps = await depsHash(paths.partial);
    data.stockVersion = stock.version;
    await fs.rename(paths.partial, paths.source);
    await registerSelfProject(ctx);
    data.current = { stock: true, sha: null };
    data.setup = { status: "ready" };
  } catch (error) {
    await fs.rm(paths.partial, { recursive: true, force: true }).catch(() => {});
    // Keep the step, so the user sees which one stopped.
    data.setup = {
      status: "failed",
      ...(data.setup.step ? { step: data.setup.step } : {}),
      error: error?.message ?? String(error),
    };
  }
  ctx.changed();
}
