// An ACP bridge is the small program that speaks ACP for a CLI that does not
// (claude-agent-acp for Claude Code). The user installs the CLI; the bridge
// is ADE's own plumbing: one already on PATH is used as is, otherwise ADE
// installs the version it was tested with once under ~/.ade/acp.
import fs from "node:fs/promises";
import path from "node:path";

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
/** @type {Map<string, Promise<void>>} one install per directory, shared by concurrent turns */
const installing = new Map();

const exists = (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

/** Where ADE keeps its own copy of a bridge: one directory per pinned version. */
export function bridgeDir(dataDir, spec) {
  return path.join(dataDir, "acp", `${spec.bin}-${spec.version}`);
}

/**
 * The [bin, args] that start a bridge. `spec` is { pkg, version, bin, entry }
 * (entry is the bin script inside the package); `which`/`run` are ADE's own
 * argv-only helpers. `onInstall` runs before a turn waits on the one-time
 * install, so the session can say why it is slow.
 */
export async function acpBridge(spec, { dataDir, which, run, onInstall }) {
  const onPath = await which(spec.bin);
  if (onPath) return [onPath, []];
  const dir = bridgeDir(dataDir, spec);
  const entry = path.join(dir, "node_modules", spec.pkg, spec.entry);
  if (!(await exists(entry))) {
    onInstall?.();
    if (!installing.has(dir))
      installing.set(
        dir,
        install(spec, dir, entry, run).finally(() => installing.delete(dir)),
      );
    await installing.get(dir);
  }
  return [process.execPath, [entry]];
}

async function install(spec, dir, entry, run) {
  // Install beside the final directory and rename it into place, so a
  // half-finished install is never mistaken for a working one.
  const partial = `${dir}.partial-${process.pid}-${Date.now()}`;
  await fs.mkdir(partial, { recursive: true, mode: 0o700 });
  const target = `${spec.pkg}@${spec.version}`;
  try {
    // A bridge also ships its own copy of the agent as an optional binary
    // (Claude Code's is ~280 MB); ADE points it at the user's CLI instead.
    const result = await run(
      "npm",
      [
        "install",
        "--prefix",
        partial,
        "--omit=optional",
        "--no-audit",
        "--no-fund",
        "--loglevel=error",
        target,
      ],
      { timeout: INSTALL_TIMEOUT_MS },
    );
    if (result.code !== 0) {
      const detail = `${result.stderr}\n${result.stdout}`.trim().split(/\r?\n/).at(-1) ?? "";
      throw new Error(
        `ADE could not install ${target} with npm (exit ${result.code}${detail ? `: ${detail.slice(0, 300)}` : ""}). Check your network and send the message again, or install it yourself: npm install -g ${spec.pkg}`,
      );
    }
    try {
      await fs.rename(partial, dir);
    } catch (error) {
      // Another ADE process finished the same install first.
      if (!(await exists(entry))) throw error;
    }
  } finally {
    await fs.rm(partial, { recursive: true, force: true });
  }
  if (!(await exists(entry)))
    throw new Error(`${target} installed, but ${spec.entry} is missing from it.`);
}
