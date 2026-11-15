/**
 * Homebrew ownership and updates for already-installed harnesses.
 *
 * Homebrew's installed inventory and verbose file listing identify the exact
 * formula/cask; an adapter-provided allowlist prevents a global npm package in
 * a Homebrew Node keg from being mistaken for the Node formula. No shell is
 * used. See https://docs.brew.sh/Manpage and https://docs.brew.sh/Querying-Brew.
 */
import path from "node:path";

const TIMEOUT_MS = 15000;
const NAME =
  /^[A-Za-z0-9][A-Za-z0-9._+@-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+@-]*\/[A-Za-z0-9][A-Za-z0-9._+@-]*)?$/;

function validItem(item) {
  return (
    item &&
    (item.kind === "formula" || item.kind === "cask") &&
    typeof item.name === "string" &&
    NAME.test(item.name)
  );
}

/**
 * Find the unique allowed Homebrew item containing the resolved executable.
 * `allowedItems` are explicit {kind: "formula"|"cask", name: fullName} pairs
 * from the agent adapter, not inferred from the binary's basename.
 *
 * `deps` supplies which, realpath and run as in harness.mjs. Returns null if
 * metadata, a file listing, or ownership is ambiguous or unavailable.
 */
export async function detectBrewInstall(selectedPath, allowedItems, deps) {
  if (
    !path.isAbsolute(selectedPath ?? "") ||
    !Array.isArray(allowedItems) ||
    !allowedItems.length ||
    !allowedItems.every(validItem)
  )
    return null;
  try {
    if (!(await deps.which("brew"))) return null;
    const resolved = path.resolve(await deps.realpath(selectedPath));
    const info = await deps.run("brew", ["info", "--json=v2", "--installed"], {
      timeout: TIMEOUT_MS,
    });
    if (info?.code !== 0) return null;
    const data = JSON.parse(String(info.stdout ?? ""));
    if (!Array.isArray(data?.formulae) || !Array.isArray(data?.casks)) return null;

    const candidates = [];
    for (const allowed of allowedItems) {
      const rows = allowed.kind === "formula" ? data.formulae : data.casks;
      const key = allowed.kind === "formula" ? "full_name" : "full_token";
      const matches = rows.filter((row) => row?.[key] === allowed.name);
      if (matches.length > 1) return null;
      if (
        matches.length === 1 &&
        !candidates.some((item) => item.kind === allowed.kind && item.name === allowed.name)
      )
        candidates.push(allowed);
    }
    const owners = [];
    for (const item of candidates) {
      const result = await deps.run("brew", ["list", "--verbose", `--${item.kind}`, item.name], {
        timeout: TIMEOUT_MS,
      });
      // A failed listing could conceal a second owner; do not guess.
      if (result?.code !== 0 || typeof result.stdout !== "string") return null;
      const ownsFile = result.stdout
        .split(/\r?\n/)
        .some((line) => path.isAbsolute(line) && path.resolve(line) === resolved);
      if (ownsFile) owners.push(item);
    }
    if (owners.length !== 1) return null;
    return { method: "brew", path: selectedPath, brewItem: { ...owners[0] } };
  } catch {
    return null;
  }
}

/** Construct an argv-only update for a previously detected item. */
export function brewUpdateCommand(item) {
  return validItem(item) ? ["brew", ["upgrade", `--${item.kind}`, item.name]] : null;
}

/**
 * Query only the installed item, preserving its formula/cask and tap/channel.
 * Returns {outdated, latestVersion, pinned} or null on an unknown result.
 * Homebrew returns exit code 1 for an outdated named item. An empty result is
 * current according to Homebrew's ordinary policy, which excludes some casks
 * with auto_updates or version :latest; this is not a vendor release check.
 */
export async function checkBrewUpdate(item, run) {
  if (!validItem(item)) return null;
  try {
    const result = await run("brew", ["outdated", "--json=v2", `--${item.kind}`, item.name], {
      timeout: TIMEOUT_MS,
    });
    if (result?.code !== 0 && result?.code !== 1) return null;
    const data = JSON.parse(String(result.stdout ?? ""));
    if (!Array.isArray(data?.formulae) || !Array.isArray(data?.casks)) return null;
    const rows = item.kind === "formula" ? data.formulae : data.casks;
    const otherRows = item.kind === "formula" ? data.casks : data.formulae;
    if (otherRows.length || rows.length > 1) return null;
    if (!rows.length)
      return result.code === 0 ? { outdated: false, latestVersion: null, pinned: false } : null;
    const row = rows[0];
    const shortName = item.name.split("/").at(-1);
    if (
      (row?.name !== item.name && row?.name !== shortName) ||
      typeof row.current_version !== "string" ||
      !row.current_version.trim()
    )
      return null;
    return { outdated: true, latestVersion: row.current_version, pinned: row.pinned === true };
  } catch {
    return null;
  }
}
