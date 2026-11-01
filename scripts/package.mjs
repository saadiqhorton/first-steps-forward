// `npm run package`: stages the publishable `@dezignerdrugz/ade` package in .pack/stage and runs
// `npm pack` there. The repo's package.json is the Lovable/dev manifest (the whole React
// toolchain), so the package gets its own: only what the Node server imports at runtime, pinned
// to the versions package-lock.json resolved. It ships the SPA build, not the Nitro server bundle.
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packDir = path.join(root, ".pack");
const stage = path.join(packDir, "stage");
const rel = (...parts) => path.join(root, ...parts);

// node-pty@1.1.0 has no Linux prebuild, so installing it compiles C++ (python3, make, g++).
// @lydell/node-pty is the same API with prebuilds for linux, darwin and win32 on x64 and arm64.
// Aliased under the name terminal.mjs imports, so no source changes. See ADR 0002.
const PTY_ALIAS = "npm:@lydell/node-pty@1.2.0-beta.18";
const OPTIONAL = new Set(["node-pty"]);

/** Source files that are not shipped: tests and their helpers, and the Vite-facing type stubs. */
const isDevOnly = (name) => /\.test(-helper)?\.mjs$/.test(name) || name.endsWith(".d.mts");

const BARE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"'./][^"']*)["']/g;
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/** The npm package a bare specifier names: `a/b` -> `a`, `@s/a/b` -> `@s/a`. */
function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

async function listFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
}

/** Bare package names the staged .mjs files import (comments count: a false positive fails loudly). */
async function importedPackages(dir) {
  const found = new Set();
  for (const file of await listFiles(dir)) {
    if (!file.endsWith(".mjs")) continue;
    const source = await fs.readFile(file, "utf8");
    for (const match of source.matchAll(BARE_IMPORT)) {
      if (!builtins.has(match[1])) found.add(packageName(match[1]));
    }
  }
  return [...found].sort();
}

async function main() {
  const rootManifest = JSON.parse(await fs.readFile(rel("package.json"), "utf8"));
  const lock = JSON.parse(await fs.readFile(rel("package-lock.json"), "utf8"));
  const client = rel(".output", "public");
  try {
    await fs.access(path.join(client, "_shell.html"));
  } catch {
    throw new Error("No SPA build at .output/public. Run `npm run build` first.");
  }

  await fs.rm(packDir, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });
  const copy = (from, to = from, filter) =>
    fs.cp(rel(from), path.join(stage, to), { recursive: true, filter });
  await copy("bin");
  await copy("scripts/start-local.mjs");
  await copy("scripts/browser-setup.mjs");
  await copy("src/local", "src/local", (source) => !isDevOnly(path.basename(source)));
  await copy(".output/public");
  await copy("public/licenses");
  await copy("README.md");
  await copy("LICENSE");
  await copy("THIRD_PARTY_NOTICES.md");

  const dependencies = {};
  const optionalDependencies = {};
  for (const name of await importedPackages(stage)) {
    const resolved = lock.packages?.[`node_modules/${name}`]?.version;
    const declared = rootManifest.dependencies?.[name] ?? rootManifest.optionalDependencies?.[name];
    if (!declared || !resolved) {
      throw new Error(
        `The server imports "${name}", which is not a locked dependency of the repo. Add it to package.json (and install) before packaging.`,
      );
    }
    if (OPTIONAL.has(name)) optionalDependencies[name] = PTY_ALIAS;
    else dependencies[name] = resolved;
  }

  const manifest = {
    name: "@dezignerdrugz/ade",
    version: rootManifest.version,
    description:
      "ADE: a local web UI that drives coding-agent CLIs (Codex, OpenCode, Pi, Claude Code) on your machine.",
    license: "MIT",
    type: "module",
    bin: { ade: "bin/ade.mjs" },
    engines: { node: ">=22" },
    files: [
      "bin",
      "scripts",
      "src/local",
      ".output/public",
      "public/licenses",
      "README.md",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
    ],
    dependencies,
    optionalDependencies,
    publishConfig: { access: "public" },
  };
  await fs.writeFile(path.join(stage, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // --ignore-scripts: nothing in the staged tree needs a lifecycle script to pack.
  const pack = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", packDir], {
    cwd: stage,
    stdio: "inherit",
    shell: false,
  });
  if (pack.status !== 0) throw new Error("npm pack failed");
  const tarball = (await fs.readdir(packDir)).find((name) => name.endsWith(".tgz"));
  console.log(`\nPackage: ${path.join(".pack", tarball)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
