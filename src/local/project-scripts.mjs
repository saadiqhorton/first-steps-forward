// What a project's package.json offers ADE: its package manager, the check
// scripts (typecheck, lint, test, e2e, build), and other service scripts the
// agent should be told about. package.json is read fresh on every call.
import { promises as fs } from "node:fs";
import path from "node:path";

export async function packageManager(project, pkg = {}) {
  const declared = String(pkg.packageManager ?? "").split("@")[0];
  if (["npm", "pnpm", "yarn", "bun"].includes(declared)) return declared;
  for (const [lock, manager] of [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
  ]) {
    if (
      await fs
        .access(path.join(project.path, lock))
        .then(() => true)
        .catch(() => false)
    )
      return manager;
  }
  return "npm";
}

async function detectNonNodeHint(projectPath) {
  try {
    const names = await fs.readdir(projectPath);
    const set = new Set(names);
    if (
      set.has("pyproject.toml") ||
      set.has("requirements.txt") ||
      set.has("Pipfile") ||
      set.has("setup.py") ||
      names.some((n) => n.endsWith(".py"))
    )
      return " This looks like a Python project.";
    if (set.has("Cargo.toml")) return " This looks like a Rust project.";
    if (set.has("go.mod")) return " This looks like a Go project.";
    if (set.has("Gemfile")) return " This looks like a Ruby project.";
  } catch {
    /* ignore */
  }
  return "";
}

/**
 * The project's checks, one row per category: a runnable row (`script`,
 * `command`) when package.json has a script for it, else a skipped row that
 * says why. Never a pass for something that does not exist.
 */
export async function checksFor(project) {
  const categories = [
    { name: "Typecheck", scripts: ["typecheck", "type-check", "check"] },
    { name: "Lint", scripts: ["lint"] },
    { name: "Unit tests", scripts: ["test"] },
    { name: "End-to-end", scripts: ["test:e2e", "e2e"] },
    { name: "Build", scripts: ["build"] },
  ];
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(project.path, "package.json"), "utf8"));
    const scripts = pkg.scripts ?? {};
    const manager = await packageManager(project, pkg);
    return categories.map((category) => {
      const script = category.scripts.find((name) => scripts[name]);
      return script
        ? {
            name: category.name,
            script,
            command: `${manager} run ${script}`,
            status: "not_run",
            detail: "Not run",
          }
        : {
            name: category.name,
            status: "skipped",
            detail: `No ${category.scripts.join(" or ")} script configured.`,
          };
    });
  } catch (error) {
    const missing =
      error?.code === "ENOENT" || /ENOENT|no such file or directory/i.test(String(error?.message));
    if (missing) {
      const hint = await detectNonNodeHint(project.path);
      return [
        {
          name: "Project checks",
          status: "skipped",
          detail:
            "No package.json here. ADE’s check runner only detects npm scripts (typecheck, lint, test, e2e, build)." +
            hint +
            " Run language-specific checks yourself for now, or add a package.json with those scripts.",
        },
      ];
    }
    return [
      {
        name: "Project checks",
        status: "skipped",
        detail: `package.json could not be read or parsed (${error.message}); no scripts detected.`,
      },
    ];
  }
}

/** What the agent is told about services beyond the dev server. */
export async function otherServicesNote(project) {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(project.path, "package.json"), "utf8"));
    const scripts = Object.keys(pkg.scripts ?? {}).filter((name) =>
      /^(dev[:_-]|(?:backend|api|server)(?:[:_-]|$))/.test(name),
    );
    return scripts.length
      ? `Additional package scripts: ${scripts.slice(0, 8).join(", ")}. ADE does not verify whether these services are running.`
      : "ADE does not verify other project services or backends; a running frontend preview does not prove they are running.";
  } catch {
    return "Other project services are unknown; ADE could not read package.json.";
  }
}
