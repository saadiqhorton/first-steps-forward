/**
 * Model catalog probes for the ADE model picker.
 *
 * Every probe uses the CLI's own non-interactive list command, which reads
 * that CLI's local catalog cache. None of them consumes inference quota and
 * none is allowed to force a network refresh (`opencode models --refresh` and
 * `pi update --models` stay off this path). When listing is impossible we
 * return a structured failure with a reason; the UI then offers manual entry.
 * We never fabricate a list and never ship a static stand-in catalog in the
 * picker: provenance is either "live" (the CLI's own cached listing) or
 * "bundled" (codex's offline fallback shipped with the binary).
 */
import { promises as fsp } from "node:fs";
import path from "node:path";

// Model ids are data, never flags: the first character must be alphanumeric
// so a value can never read as a CLI option (e.g. "--something"). The rest
// allows the shapes the CLIs actually use (provider/model, [brackets],
// colons, dots, hyphens, plus). ADE spawns argv arrays and runs no shell.
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/[\]\-+]{0,255}$/;

const CACHE_TTL_MS = 60_000;
// Persistent catalog cache (per agent, under ~/.ade, private 0600). TTL 300s
// mirrors OpenCode's own catalog freshness window. Rows are only ever what a
// probe returned; a corrupt or mismatched file is ignored, never merged.
const FILE_CACHE_TTL_MS = 300_000;
const FILE_CACHE_SCHEMA = 1;
const modelsCache = new Map();

async function readFileCache(cacheDir, fingerprint) {
  try {
    const raw = JSON.parse(
      await fsp.readFile(
        path.join(cacheDir, `models-cache-${fingerprint.split("|")[0]}.json`),
        "utf8",
      ),
    );
    if (
      raw?.version === FILE_CACHE_SCHEMA &&
      raw?.fingerprint === fingerprint &&
      Array.isArray(raw?.models) &&
      Date.now() - Number(raw?.fetchedAt) < FILE_CACHE_TTL_MS
    )
      return { models: raw.models, source: raw.source, command: raw.command };
  } catch {}
  return null;
}
async function writeFileCache(cacheDir, fingerprint, entry) {
  try {
    await fsp.mkdir(cacheDir, { recursive: true, mode: 0o700 });
    await fsp.writeFile(
      path.join(cacheDir, `models-cache-${fingerprint.split("|")[0]}.json`),
      JSON.stringify(
        { version: FILE_CACHE_SCHEMA, fingerprint, fetchedAt: Date.now(), ...entry },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  } catch {}
}

/** Parse `codex debug models` JSON. Only visibility === "list" is offered. */
export function parseCodexModels(stdout) {
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return null;
  }
  const list = Array.isArray(payload?.models) ? payload.models : null;
  if (!list) return null;
  return list
    .filter((m) => m?.visibility === "list" && typeof m.slug === "string" && m.slug)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
    .map((m) => ({ id: m.slug, ...(m.display_name ? { label: m.display_name } : {}) }));
}

/** Parse `opencode models` plain lines of `provider/model`. */
export function parseOpencodeModels(stdout) {
  const ids = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/\s/.test(line) && line.includes("/"));
  return ids.length ? ids.map((id) => ({ id })) : [];
}

/**
 * Parse the `pi --list-models` fixed-width table.
 * Pi extensions may print banner lines before the header, so we skip until a
 * header row containing both "provider" and "model" and only then read rows
 * of 5-6 whitespace-separated columns.
 */
export function parsePiModels(stdout) {
  const lines = stdout.split(/\r?\n/);
  let headerSeen = false;
  const models = [];
  for (const line of lines) {
    const cols = line.trim().split(/\s+/).filter(Boolean);
    if (!headerSeen) {
      if (cols.includes("provider") && cols.includes("model")) headerSeen = true;
      continue;
    }
    if (cols.length < 5 || cols.length > 6) continue;
    const [provider, model, context, maxOut] = cols;
    if (!provider || !model) continue;
    const meta = [context ? `context ${context}` : "", maxOut ? `max-out ${maxOut}` : ""]
      .filter(Boolean)
      .join(" · ");
    models.push({ id: `${provider}/${model}`, label: model, ...(meta ? { meta } : {}) });
  }
  return models;
}

const MANUAL_HINT =
  "You can still enter a model id manually; availability depends on your account.";

async function probe(agentId, run) {
  if (agentId === "codex") {
    let result = await run("codex", ["debug", "models"], { timeout: 15000 });
    let source = "live";
    let command = "codex debug models";
    if (result.code === 127)
      return { available: false, reason: "not-installed", hint: MANUAL_HINT };
    if (result.code !== 0) {
      result = await run("codex", ["debug", "models", "--bundled"], { timeout: 15000 });
      source = "bundled";
      command = "codex debug models --bundled";
      if (result.code !== 0) return { available: false, reason: "cli-failed", hint: MANUAL_HINT };
    }
    const models = parseCodexModels(result.stdout);
    if (models === null) return { available: false, reason: "cli-failed", hint: MANUAL_HINT };
    if (!models.length) return { available: false, reason: "empty", hint: MANUAL_HINT };
    return { available: true, models, source, command };
  }
  if (agentId === "opencode") {
    // Never pass --refresh here: that is an opt-in network refresh elsewhere.
    const result = await run("opencode", ["models"], { timeout: 20000 });
    if (result.code === 127)
      return { available: false, reason: "not-installed", hint: MANUAL_HINT };
    if (result.code !== 0) return { available: false, reason: "cli-failed", hint: MANUAL_HINT };
    const models = parseOpencodeModels(result.stdout);
    if (!models.length)
      return {
        available: false,
        reason: "no-providers-configured",
        hint:
          "OpenCode lists only models from providers configured in its own auth store. Run `opencode auth login` in a terminal, or " +
          MANUAL_HINT.toLowerCase(),
      };
    return { available: true, models, source: "live", command: "opencode models" };
  }
  if (agentId === "pi") {
    const result = await run("pi", ["--offline", "--no-extensions", "--list-models"], {
      timeout: 20000,
    });
    if (result.code === 127)
      return { available: false, reason: "not-installed", hint: MANUAL_HINT };
    if (result.code !== 0) return { available: false, reason: "cli-failed", hint: MANUAL_HINT };
    const models = parsePiModels(result.stdout);
    if (!models.length)
      return {
        available: false,
        reason: "no-providers-configured",
        hint:
          "Pi lists only models for providers enabled in its own config. " +
          MANUAL_HINT.toLowerCase(),
      };
    return {
      available: true,
      models,
      source: "live",
      command: "pi --offline --list-models",
    };
  }
  return { available: false, reason: "unknown-agent", hint: MANUAL_HINT };
}

/**
 * List models for an agent. Two cache layers, both keyed by agent plus the
 * CLI's reported version string (opts.version), so an upgraded or replaced
 * binary never sees a stale catalog:
 *  - in-memory, 60s TTL (hot path for the UI's polling);
 *  - file under opts.cacheDir (~/.ade, 0600), 300s TTL, survives restarts.
 * Cache hits carry `cached: true`. Failures are never cached into a list;
 * only successful probes are stored.
 */
export async function listModels(agentId, run, opts = {}) {
  const version = opts.version ?? "";
  const key = `${agentId}|${version}`;
  const now = opts.now ?? Date.now();
  const cached = modelsCache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) return { ...cached.result, cached: true };
  if (opts.cacheDir && version) {
    const stored = await readFileCache(opts.cacheDir, key);
    if (stored) {
      const result = { available: true, ...stored };
      modelsCache.set(key, { at: now, result });
      return { ...result, cached: true };
    }
  }
  const result = await probe(agentId, run);
  modelsCache.set(key, { at: now, result });
  if (result.available && opts.cacheDir && version)
    await writeFileCache(opts.cacheDir, key, {
      models: result.models,
      source: result.source,
      command: result.command,
    });
  return result;
}

export function clearModelsCache() {
  modelsCache.clear();
}
