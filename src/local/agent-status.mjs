import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { findOnPath as which, runCommand as run, spawnCommand as spawn } from "./spawn.mjs";
import { adapters } from "./adapters/index.mjs";
import { describeAgent } from "./adapters/kit.mjs";
import { clearModelsCache } from "./models.mjs";
import { validateOptions } from "./capabilities.mjs";
import {
  compareVersions,
  detectInstallMethod,
  latestVersion,
  createHarnessJobs,
} from "./harness.mjs";

// A probe spawns ~17 processes, so the bootstrap poll only starts one this long after the last.
// Explicit refreshes (agentStatus called directly) ignore it.
const AGENT_PROBE_INTERVAL_MS = 60_000;

/**
 * Which agent CLIs are installed and signed in (`state.agents`, cached in
 * `dataDir`), their install/update jobs, and their model listings.
 * @param {{ state: { agents: any[] }, dataDir: string, emit: (scope: string) => void }} deps
 */
export function createAgentStatus({ state, dataDir, emit }) {
  const AGENTS_STATUS_FILE = path.join(dataDir, "agents-status.json");
  let probingAgents = false;
  let lastProbeStartedAt = 0;
  const now = () => Date.now();
  async function executable(bin) {
    const res = await run(bin, ["--version"], { timeout: 5000 });
    return res.code === 0
      ? (res.stdout || res.stderr).trim().split(/\r?\n/)[0].slice(0, 100)
      : null;
  }
  // The global npm root only changes when npm itself does, so one lookup serves every probe.
  // A failed lookup is retried, and a finished harness job clears it.
  let npmRootLookup = null;
  function npmRoot() {
    npmRootLookup ??= (async () => {
      const res = await run("npm", ["root", "-g"], { timeout: 5000 });
      if (res.code !== 0) return null;
      const root = (res.stdout || "").trim().split(/\r?\n/)[0]?.trim();
      return root || null;
    })()
      .catch(() => null)
      .then((root) => {
        if (!root) npmRootLookup = null;
        return root;
      });
    return npmRootLookup;
  }
  const harnessDetectDeps = {
    which,
    npmRoot,
    realpath: (p) => fs.realpath(p),
  };
  const harnessJobs = createHarnessJobs({
    onChange: (job) => emit(`harness:${job.agentId}`),
    spawn,
    onFinished: () => {
      clearModelsCache(dataDir, Object.keys(adapters));
      npmRootLookup = null;
      agentStatus().catch(() => {});
    },
  });

  async function agentStatus() {
    lastProbeStartedAt = now();
    const results = await Promise.all(
      Object.values(adapters).map(async (adapter) => {
        const version = await executable(adapter.bin);
        const auth = version ? await adapter.detectAuth(run) : { signedIn: false };
        const install = await detectInstallMethod(adapter, harnessDetectDeps);
        const row = {
          ...describeAgent(adapter),
          installed: !!version,
          // "codex-cli 0.158.0" and "2.1.307 (Claude Code)" both report the number.
          ...(version
            ? { version: version.match(/\d+(?:\.\d+)+\S*/)?.[0] ?? version.replace(/^.*?\s/, "") }
            : {}),
          ...auth,
          carriesConversation: true,
          installMethod: install.method,
          ...(install.path ? { installPath: install.path } : {}),
        };
        return row;
      }),
    );
    state.agents = results;
    // The cache is stamped with when this probe finished. The latest-version writes below reuse it:
    // stamping them with their own, later time would push the next probe back each time one lands.
    const fetchedAt = Date.now();
    await writeAgentsStatus(results, fetchedAt);
    emit("agents");
    // Background, non-blocking latest-version checks — next bootstrap poll picks them up.
    for (const agent of results) {
      // A CLI that updates itself in place is never behind in a way ADE can fix.
      if (adapters[agent.id]?.harness.selfUpdates && agent.installMethod !== "npm") continue;
      void (async () => {
        const latest = await latestVersion(adapters[agent.id], run);
        if (latest == null) return;
        const current = state.agents.find((a) => a.id === agent.id);
        if (!current) return;
        current.latestVersion = latest;
        if (current.version && compareVersions(current.version, latest) < 0)
          current.updateAvailable = true;
        else delete current.updateAvailable;
        await writeAgentsStatus(state.agents, fetchedAt);
        emit("agents");
      })();
    }
    return results;
  }
  // Write-then-rename: a reader (another ADE instance, or this one restarting) must never see a
  // truncated file, which would parse as "no cache" and re-probe every CLI.
  async function writeAgentsStatus(agents, fetchedAt) {
    const tmp = `${AGENTS_STATUS_FILE}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(tmp, JSON.stringify({ fetchedAt, agents }), { mode: 0o600 });
      await fs.rename(tmp, AGENTS_STATUS_FILE);
    } catch {
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  }

  /**
   * Fast path for the UI's 2-second bootstrap poll: return the last probed
   * agent status immediately (persisted under ~/.ade) and refresh the real
   * probes in the background — the next poll picks them up. Only the very
   * first bootstrap after the store is wiped pays the full probe latency.
   * A single background probe runs at a time, and none starts within
   * AGENT_PROBE_INTERVAL_MS of the last (this process's, or the cached file's
   * `fetchedAt` after a restart) so polls can't stampede CLIs.
   */
  async function bootstrapAgents() {
    let cached = null;
    try {
      cached = JSON.parse(await fs.readFile(AGENTS_STATUS_FILE, "utf8"));
    } catch {}
    if (cached?.agents) {
      // What an agent is comes from its adapter, never from an older cache;
      // only detection (installed, version, sign-in) is reused until the
      // background probe refreshes it. Agents without an adapter are dropped.
      state.agents = cached.agents
        .filter((agent) => adapters[agent.id])
        .map((agent) => ({ ...agent, ...describeAgent(adapters[agent.id]) }));
    }
    // Never make the project list wait on CLI version/auth probes. If there's
    // no cache yet, return the current (possibly empty) agent list; the normal
    // bootstrap poll picks up the probe result when it finishes.
    probeAgentsIfDue(Number(cached?.fetchedAt) || 0);
    return state.agents;
  }
  /** Starts a background probe unless one is running or one began within AGENT_PROBE_INTERVAL_MS. */
  function probeAgentsIfDue(fetchedAt = 0) {
    if (probingAgents || now() - Math.max(lastProbeStartedAt, fetchedAt) < AGENT_PROBE_INTERVAL_MS)
      return;
    probingAgents = true;
    agentStatus()
      .catch(() => {})
      .finally(() => {
        probingAgents = false;
      });
  }
  /**
   * An agent's model listing at its detected version. An installed, signed-in
   * agent may be asked for its list when ADE has none for that version yet.
   */
  function listAgentModels(agentId) {
    const agent = state.agents.find((a) => a.id === agentId);
    return adapters[agentId].listModels({
      run,
      version: agent?.version ?? "",
      cacheDir: dataDir,
      canProbe: !!(agent?.installed && agent.signedIn),
    });
  }
  /** Resolve and validate effort/speed/permission against the model's capability row. */
  async function resolveSessionOptions(agentId, modelId, options) {
    const listed = await listAgentModels(agentId);
    const modelRow =
      modelId && listed?.available
        ? (listed.models?.find((m) => m.id === modelId) ?? { id: modelId })
        : undefined;
    return validateOptions(adapters[agentId], options, modelRow);
  }
  return {
    harnessJobs,
    agentStatus,
    bootstrapAgents,
    probeAgentsIfDue,
    listAgentModels,
    resolveSessionOptions,
  };
}
