/**
 * Model listings for the ADE model picker: the rules every agent's listing
 * follows, and the caches they share. Each agent adapter knows how to ask
 * its own CLI (see adapters/*.agent.mjs).
 *
 * A JSON-lines CLI is asked with its own non-interactive list command, which
 * reads that CLI's local catalog cache. None of them consumes inference quota
 * and none is allowed to force a network refresh. When listing is impossible
 * the result is a structured failure with a reason; the UI then offers manual
 * entry. ADE never fabricates a list and never ships a static stand-in
 * catalog: provenance is "live" (the CLI's own cached listing), "bundled"
 * (a fallback shipped with the CLI) or "acp" (reported by the agent itself).
 */
import { promises as fsp } from "node:fs";
import path from "node:path";

// Model ids are data, never flags: the first character must be alphanumeric
// so a value can never read as a CLI option (e.g. "--something"). The rest
// allows the shapes the CLIs actually use (provider/model, [brackets],
// colons, dots, hyphens, plus). ADE spawns argv arrays and runs no shell.
// `~` appears in OpenCode OpenRouter alias ids (e.g. openrouter/~anthropic/…).
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/[\]\-+~]{0,255}$/;

const CACHE_TTL_MS = 60_000;
// Persistent catalog cache (per agent, under ~/.ade, private 0600). TTL 300s
// mirrors OpenCode's own catalog freshness window. Rows are only ever what a
// probe returned; a corrupt or mismatched file is ignored, never merged.
// Schema 3: rows may carry efforts/defaultEffort/speeds from verbose/catalog
// probes (schema 2 only covered extension-provider pi listings).
const FILE_CACHE_TTL_MS = 300_000;
const FILE_CACHE_SCHEMA = 3;
// Process-wide, like the browser installer: when Vite loads ADE's modules
// twice, every copy reads and clears the same cache.
const modelsCache = (globalThis.__adeModelsCache ??= new Map());

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
      return {
        models: raw.models,
        source: raw.source,
        command: raw.command,
        ...(raw.note ? { note: raw.note } : {}),
      };
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

// ACP agents have no list command: their model choices arrive in each
// session's `configOptions`. ADE keeps the last list an agent reported, keyed
// by CLI version; with none yet, `probe` asks the agent (a session that is
// never prompted). Turns refresh the list too.
const acpModelsFile = (cacheDir, agentId) => path.join(cacheDir, `acp-models-${agentId}.json`);
/** @type {Map<string, Promise<object[]>>} one probe per agent and version at a time */
const acpProbes = (globalThis.__adeAcpModelProbes ??= new Map());

const acpListed = (agentName, models) => ({
  available: true,
  models,
  source: "acp",
  completeCatalog: true,
  command: `reported by ${agentName}`,
});

/** Record the model list an ACP agent offered (rows from acp.mjs); returns the rows kept. */
export async function rememberAcpModels(cacheDir, agentId, version, models) {
  const rows = models.filter((model) => MODEL_ID.test(model?.id ?? "")).slice(0, 200);
  if (!rows.length) return rows;
  try {
    await fsp.mkdir(cacheDir, { recursive: true, mode: 0o700 });
    await fsp.writeFile(
      acpModelsFile(cacheDir, agentId),
      JSON.stringify({ version, reportedAt: Date.now(), models: rows }, null, 2),
      { mode: 0o600 },
    );
  } catch {}
  return rows;
}

/**
 * An ACP agent's models: the list it last reported for this version, or
 * (with `probe`) the list it reports when asked. One probe per agent and
 * version runs at a time; a failed probe is reported, never kept.
 * @param {string} agentId
 * @param {string} agentName
 * @param {{ version?: string, cacheDir?: string, probe?: () => Promise<object[]> }} opts
 */
export async function acpModelListing(
  agentId,
  agentName,
  { version = "", cacheDir = "", probe } = {},
) {
  try {
    const raw = JSON.parse(await fsp.readFile(acpModelsFile(cacheDir, agentId), "utf8"));
    if (raw?.version === version && Array.isArray(raw.models) && raw.models.length)
      return acpListed(agentName, raw.models);
  } catch {}
  if (!probe)
    return {
      available: false,
      reason: "acp-not-reported",
      hint: "It lists them once it is installed and signed in. You can also enter a model id manually.",
    };
  const key = `${agentId}|${version}`;
  if (!acpProbes.has(key))
    acpProbes.set(
      key,
      Promise.resolve()
        .then(probe)
        .then((rows) => rememberAcpModels(cacheDir, agentId, version, rows))
        .finally(() => acpProbes.delete(key)),
    );
  try {
    const rows = await acpProbes.get(key);
    if (rows.length) return acpListed(agentName, rows);
    return {
      available: false,
      reason: "acp-no-models",
      hint: "It uses its own configured model. You can still enter a model id manually.",
    };
  } catch (error) {
    return {
      available: false,
      reason: "acp-probe-failed",
      hint: `${String(error?.message ?? error).slice(0, 300)} You can still enter a model id manually.`,
    };
  }
}

export const MANUAL_HINT =
  "You can still enter a model id manually; availability depends on your account.";

/**
 * A JSON-lines CLI's models, from `probe` (its own list command). Two cache
 * layers, both keyed by agent plus the CLI's reported version, so an upgraded
 * or replaced binary never sees a stale catalog:
 *  - in-memory, 60s TTL (hot path for the UI's polling);
 *  - file under opts.cacheDir (~/.ade, 0600), 300s TTL, survives restarts.
 * Cache hits carry `cached: true`. Failures are never cached into a list;
 * only successful probes are stored.
 * @param {string} agentId
 * @param {() => Promise<any>} probe
 * @param {{ version?: string, cacheDir?: string, now?: number }} opts
 */
export async function cliModelListing(agentId, probe, opts = {}) {
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
  const result = await probe();
  modelsCache.set(key, { at: now, result });
  if (result.available && opts.cacheDir && version)
    await writeFileCache(opts.cacheDir, key, {
      models: result.models,
      source: result.source,
      command: result.command,
      ...(result.note ? { note: result.note } : {}),
    });
  return result;
}

export function clearModelsCache(cacheDir, agentIds = []) {
  modelsCache.clear();
  if (!cacheDir) return;
  // Best-effort: drop on-disk catalogs so a truncated probe cannot linger for
  // the file TTL after an intentional clear (e.g. harness install/update).
  for (const agentId of agentIds) {
    fsp.unlink(path.join(cacheDir, `models-cache-${agentId}.json`)).catch(() => {});
  }
}
