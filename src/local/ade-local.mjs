import { connect, createServer } from "node:net";
import { terminal } from "./routes/terminal.mjs";
import { editor } from "./routes/editor.mjs";
import { events } from "./routes/events.mjs";
import { sessionReads } from "./routes/sessionReads.mjs";
import { projects } from "./routes/projects.mjs";
import { attachments } from "./routes/attachments.mjs";
import { sessionActions } from "./routes/sessionActions.mjs";
import { browser } from "./routes/browser.mjs";
import { devServer } from "./routes/devServer.mjs";
import { agents } from "./routes/agents.mjs";
import { workflows } from "./routes/workflows.mjs";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findOnPath as which,
  processRunsIn as processMatches,
  runCommand as run,
  spawnCommand as spawn,
  stopProcess as stopChild,
} from "./spawn.mjs";
import { adapters } from "./adapters/index.mjs";
import { describeAgent } from "./adapters/kit.mjs";
import { getDiff, projectInfo } from "./project-git.mjs";
import { checksFor, packageManager } from "./project-scripts.mjs";
import {
  addLog,
  addMessage,
  createSessionTurns,
  shrinkLogLine,
  TurnRefused,
} from "./session-turns.mjs";
import { adeRoot, COMPUTER_ERROR_STATUS, createComputerManager, SCREEN } from "./computer.mjs";
import { createBrowserHub } from "./browser-page.mjs";
import { createBrowserInstaller } from "./browser-install.mjs";
import { createBrowserContexts, INCOGNITO_PROFILE_ID } from "./browser-contexts.mjs";
import { diagnoseLaunchFailure } from "./browser-host.mjs";
import { TOOLS as COMPUTER_TOOLS } from "./computer-tools-defs.mjs";
import { createBrowserStreamServer } from "./browser-stream-server.mjs";
import { createControlRegistry, HumanControlError } from "./browser-control.mjs";
import { MODEL_ID, clearModelsCache } from "./models.mjs";
import { optionCapabilities, validateOptions } from "./capabilities.mjs";
import {
  compareVersions,
  detectInstallMethod,
  latestVersion,
  createHarnessJobs,
} from "./harness.mjs";
import { listWorkflows, upsertWorkflow, deleteWorkflow as removeWorkflow } from "./workflows.mjs";
import { saveWorkspace } from "./workspace-persistence.mjs";
import { createEventHub } from "./events.mjs";
import { createSessionLogs } from "./session-logs.mjs";
import {
  SourceError,
  cloneRepository,
  createProjectFolder,
  expandUserPath,
  makeDirectory,
  parseRepoSource,
} from "./project-sources.mjs";
import {
  decodeBase64,
  readAttachment,
  resolveAttachments,
  saveAttachment,
} from "./attachments.mjs";

const DATA_DIR = path.join(os.homedir(), ".ade");
const DATA_FILE = path.join(DATA_DIR, "workspace.json");
const sessionLogs = createSessionLogs(path.join(DATA_DIR, "session-logs"));
const eventHub = createEventHub();
const state = { projects: [], sessions: [], processes: [], agents: [], workflows: [] };
const children = new Map();
const authChildren = new Map();
// Process ids whose dev-server port has been confirmed to accept a
// connection; a process that dies before that never actually listened.
const listenedProcs = new Set();
// Loopback base URL of the server this module is mounted on, recorded when it
// starts listening (see setListenAddress); null until then.
let listenBaseUrl = null;
const devStartClaims = new Set();
// One agent computer (headless Chrome) per project; see computer.mjs.
const browserInstaller = createBrowserInstaller({ baseDir: DATA_DIR });
const browserContexts = createBrowserContexts({
  profilesDir: path.join(DATA_DIR, "browser", "profiles"),
  executable: () => browserInstaller.executable(),
  diagnose: (executable, cause) => diagnoseLaunchFailure({ executable, cause }),
});
// One control lock per project, shared by the browser stream, computer_* and browser_* tools.
// The hub opens browser sessions lazily on first use.
const controls = createControlRegistry();
// Each project browses in its own persistent profile, or a throwaway context in incognito mode.
const browserHub = createBrowserHub({
  contextFor(projectId) {
    const project = state.projects.find((x) => x.id === projectId);
    return project?.browserProfile === INCOGNITO_PROFILE_ID
      ? browserContexts.contextFor(INCOGNITO_PROFILE_ID, projectId)
      : browserContexts.contextFor(projectId);
  },
});
const computers = createComputerManager({ installer: browserInstaller, hub: browserHub });
// Every session's turns and checks, and the only writer of a session's status.
const turns = createSessionTurns({
  state,
  save,
  adapters,
  dataDir: DATA_DIR,
  logs: sessionLogs,
  emit: (scope) => eventHub.emit(scope),
  turnEnded: () => refreshBootstrapInBackground(eventHub.activeProjects()),
  turnContext: (project) => ({
    computer: computerContext(project),
    devServer: devServerStatus(project),
    agentBrowser: agentComputerFor(project),
  }),
});
// Viewers reach the stream through /preview-stream on the server that serves
// the UI and API (see handleUpgrade); it never listens on its own.
const browserStream = createBrowserStreamServer({
  hub: browserHub,
  controls,
  originAllowed: (origin, req) => streamOriginAllowed(origin, req),
});
const OBSERVE_BROWSER_ACTIONS = new Set(["status", "snapshot", "screenshot", "wait_for"]);
const OBSERVE_COMPUTER_ACTIONS = new Set(["screenshot", "wait"]);
const AGENTS_STATUS_FILE = path.join(DATA_DIR, "agents-status.json");
let probingAgents = false;
// A probe spawns ~17 processes, so the bootstrap poll only starts one this long after the last.
// Explicit refreshes (agentStatus called directly) ignore it.
const AGENT_PROBE_INTERVAL_MS = 60_000;
let lastProbeStartedAt = 0;
let refreshingBootstrap = false;
let clientRefreshTimer = null;
let computerWatchTimer = null;
const computerFingerprints = new Map();
const CLIENT_REFRESH_MS = 10_000;
const id = () => randomUUID();
const now = () => Date.now();
const UNSUPPORTED_RISK =
  /\b(?:deploy(?:ment)?|publish|release (?:to )?prod(?:uction)?|production (?:deployment|database)|git push|push (?:to )?(?:origin|remote|github|gitlab)|open (?:a )?pull request|create (?:a )?pull request|drop database|wipe (?:all )?(?:data|files)|delete all|send (?:an? )?email|charge (?:a )?(?:credit )?card)\b/i;
// Optional exposure beyond loopback (LAN / Tailscale). Deliberately opt-in and
// always token-gated: with no ADE_HOST the API stays loopback-only, and
// scripts/start-local.mjs refuses to bind a non-loopback address without a
// non-empty ADE_TOKEN. Requests from this machine keep the original strict
// rules; every other peer must present the token as `Authorization: Bearer …`
// or the ade_auth cookie that POST /api/auth exchanges. Read per request so
// the guard never depends on import order.
const EXPOSE_HOST = () => (process.env.ADE_HOST ?? "").trim();
const EXPOSE_TOKEN = () => (process.env.ADE_TOKEN ?? "").trim();
const loopbackBind = () => {
  const host = EXPOSE_HOST();
  return !host || ["localhost", "::1"].includes(host.toLowerCase()) || isLoopbackAddress(host);
};
const sha256 = (value) => createHash("sha256").update(value).digest();
function safeTokenEqual(a, b) {
  try {
    return timingSafeEqual(sha256(String(a ?? "")), sha256(String(b ?? "")));
  } catch {
    return false;
  }
}

let lastBootstrapFingerprint = "";
const summaryOf = (session) => {
  const lastUserMessageAt =
    session.lastUserMessageAt ??
    session.messages?.filter((message) => message.role === "user").at(-1)?.at ??
    session.createdAt;
  return {
    id: session.id,
    projectId: session.projectId,
    agentId: session.agentId,
    createdBy: session.createdBy,
    request: session.request,
    criteria: session.criteria,
    status: session.status,
    summary: session.summary,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    completedAt: session.completedAt,
    model: session.model,
    failureKind: session.failureKind,
    pendingPermissions: session.pendingPermissions,
    lastUserMessageAt,
  };
};
const bootstrapPayload = () => ({
  projects: state.projects.map(safeProject),
  sessions: state.sessions.map(summaryOf),
  processes: state.processes.map(({ output, ...process }) => process),
  agents: state.agents,
});
async function save() {
  await saveWorkspace(DATA_FILE, state);
  const fingerprint = JSON.stringify(bootstrapPayload());
  if (fingerprint !== lastBootstrapFingerprint) {
    lastBootstrapFingerprint = fingerprint;
    eventHub.emit("bootstrap");
  }
}
async function load() {
  try {
    const saved = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    state.projects = Array.isArray(saved.projects) ? saved.projects : [];
    state.sessions = Array.isArray(saved.sessions) ? saved.sessions : [];
    state.processes = Array.isArray(saved.processes) ? saved.processes : [];
    state.workflows = Array.isArray(saved.workflows) ? saved.workflows : [];
    let changed = false;
    for (const session of state.sessions) {
      if (!session.lastUserMessageAt)
        session.lastUserMessageAt =
          session.messages?.filter((message) => message.role === "user").at(-1)?.at ??
          session.createdAt;
    }
    // Older versions stored raw CLI lines whole (up to 1.7 MB each); shrink them once here.
    for (const session of state.sessions) {
      if (!Array.isArray(session.logs)) continue;
      const shrunk = session.logs.map(shrinkLogLine);
      if (shrunk.some((line, i) => line !== session.logs[i])) {
        session.logs = shrunk;
        changed = true;
      }
    }
    if (await sessionLogs.migrate(state.sessions)) changed = true;
    for (const p of state.processes) {
      const project = state.projects.find((item) => item.id === p.projectId);
      const running = !!(p.pid && project && (await processMatches(p.pid, project.path)));
      if (p.status !== (running ? "running" : "stopped") || (!running && p.pid)) changed = true;
      p.status = running ? "running" : "stopped";
      if (!running) delete p.pid;
      p.output = p.output ?? [];
    }
    if (await turns.recover()) changed = true;
    // Older ADE versions queried Git only at the selected folder. Recover a
    // completed task's missing count when a nested repo's changed files still
    // have timestamps inside that task's run. Never attribute later edits.
    for (const session of state.sessions) {
      const project = state.projects.find((item) => item.id === session.projectId);
      if (
        session.status !== "complete" ||
        session.changes?.length ||
        session.changeCountUnavailable ||
        !session.completedAt ||
        project?.branch !== "not a git repository"
      )
        continue;
      const diff = await getDiff(project);
      const recovered = [];
      for (const change of diff.changes) {
        try {
          const stat = await fs.lstat(path.join(project.path, change.path));
          if (
            stat.mtimeMs >= session.createdAt - 1000 &&
            stat.mtimeMs <= session.completedAt + 1000
          )
            recovered.push(change);
        } catch {}
      }
      if (recovered.length && recovered.length === diff.changes.length) session.changes = recovered;
      else session.changeCountUnavailable = true;
      changed = true;
    }
    if (changed) await save();
  } catch {}
}
async function executable(bin) {
  const res = await run(bin, ["--version"], { timeout: 5000 });
  return res.code === 0 ? (res.stdout || res.stderr).trim().split(/\r?\n/)[0].slice(0, 100) : null;
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
  onChange: (job) => eventHub.emit(`harness:${job.agentId}`),
  spawn,
  onFinished: () => {
    clearModelsCache(DATA_DIR, Object.keys(adapters));
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
  eventHub.emit("agents");
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
      eventHub.emit("agents");
    })();
  }
  return results;
}
// Write-then-rename: a reader (another ADE instance, or this one restarting) must never see a
// truncated file, which would parse as "no cache" and re-probe every CLI.
async function writeAgentsStatus(agents, fetchedAt) {
  const tmp = `${AGENTS_STATUS_FILE}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
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
  const lastProbe = Math.max(lastProbeStartedAt, Number(cached?.fetchedAt) || 0);
  if (!probingAgents && now() - lastProbe >= AGENT_PROBE_INTERVAL_MS) {
    probingAgents = true;
    agentStatus()
      .catch(() => {})
      .finally(() => {
        probingAgents = false;
      });
  }
  return state.agents;
}
function refreshBootstrapInBackground(activeProjectIds = []) {
  if (refreshingBootstrap) return;
  refreshingBootstrap = true;
  void (async () => {
    const beforeBootstrap = JSON.stringify(bootstrapPayload());
    const beforeChanges = new Map(
      state.sessions.map((session) => [session.id, JSON.stringify(session.changes ?? [])]),
    );
    const needsDiff = new Set([
      ...state.sessions.filter((item) => item.status !== "complete").map((item) => item.projectId),
      ...activeProjectIds,
    ]);
    let devStateChanged = false;
    for (const p of state.projects.filter((project) => needsDiff.has(project.id))) {
      try {
        await projectInfo(p);
        if (!p.missing) {
          // Re-scan scripts.dev after returning the saved workspace snapshot;
          // the next poll picks up any newly discovered dev process.
          const { changed } = await refreshDevProcess(p);
          if (changed) devStateChanged = true;
        }
        if (p.missing || !needsDiff.has(p.id)) continue;
        const diff = await getDiff(p);
        for (const s of state.sessions.filter(
          (item) => item.projectId === p.id && item.status !== "complete",
        ))
          s.changes = diff.changes.map((c) =>
            s.baselineFiles?.includes(c.path) ? { ...c, preExisting: true } : c,
          );
      } catch (error) {
        console.warn(`ADE background project refresh failed for ${p.path}:`, error);
      }
    }
    const bootstrapChanged = beforeBootstrap !== JSON.stringify(bootstrapPayload());
    const changedSessions = state.sessions.filter(
      (session) => beforeChanges.get(session.id) !== JSON.stringify(session.changes ?? []),
    );
    if (bootstrapChanged || changedSessions.length || devStateChanged) {
      for (const session of changedSessions) eventHub.emit(`session:${session.id}`);
      save().catch(() => {});
    }
  })()
    .catch((error) => console.warn("ADE background bootstrap refresh failed:", error))
    .finally(() => {
      refreshingBootstrap = false;
    });
}
function syncClientRefreshTimer(count) {
  if (count > 0 && !clientRefreshTimer) {
    const tick = () => {
      refreshBootstrapInBackground(eventHub.activeProjects());
      const lastProbe = Math.max(lastProbeStartedAt, 0);
      if (!probingAgents && now() - lastProbe >= AGENT_PROBE_INTERVAL_MS) {
        probingAgents = true;
        agentStatus()
          .catch(() => {})
          .finally(() => {
            probingAgents = false;
          });
      }
    };
    tick();
    clientRefreshTimer = setInterval(tick, CLIENT_REFRESH_MS);
    clientRefreshTimer.unref?.();
    computerWatchTimer = setInterval(() => {
      for (const project of state.projects) {
        const fingerprint = JSON.stringify(computerView(project));
        if (computerFingerprints.get(project.id) !== fingerprint) {
          computerFingerprints.set(project.id, fingerprint);
          eventHub.emit(`computer:${project.id}`);
        }
      }
      for (const projectId of computerFingerprints.keys()) {
        if (!state.projects.some((project) => project.id === projectId))
          computerFingerprints.delete(projectId);
      }
    }, 1000);
    computerWatchTimer.unref?.();
  } else if (!count && clientRefreshTimer) {
    clearInterval(clientRefreshTimer);
    clientRefreshTimer = null;
    if (computerWatchTimer) clearInterval(computerWatchTimer);
    computerWatchTimer = null;
    computerFingerprints.clear();
  }
}
eventHub.onClientsChanged(syncClientRefreshTimer);
const safeProject = (p) => ({ ...p });
async function allocatePort() {
  // Ask the OS for an ephemeral port, but do not return it until nothing
  // answers there: WSL's mirrored networking (verified) keeps a just-closed
  // loopback socket connectable for up to ~500 ms, and a false connect would
  // make waitForListening report "running" before the dev server binds.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = await new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const allocated = server.address().port;
        server.close(() => resolve(allocated));
      });
    });
    const deadline = Date.now() + 1500;
    while (await probeConnection(port)) {
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!(await probeConnection(port))) return port;
    // Still connectable after 1.5 s: something really owns it — fresh port.
  }
  throw new Error("Could not allocate a free loopback port for the dev server.");
}
function probeConnection(port) {
  return new Promise((resolve) => {
    if (!port) return resolve(false);
    const socket = connect({ port, host: "127.0.0.1" });
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
/**
 * Only a port that actually accepts a connection proves the dev server is
 * up. Bounded poll: returns false if the process dies first or nothing
 * listens within the window, so the caller can surface the captured stderr
 * tail and reset the port instead of reporting a stale "running".
 */
async function waitForListening(proc, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!children.has(proc.id)) return false;
    if (await probeConnection(proc.port)) {
      listenedProcs.add(proc.id);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}
/**
 * Launch path shared by POST /processes/:id/start and the project-scoped
 * dev/start endpoint: framework-mapped flags, fresh port, listen-verified
 * "running", and an honest failure that resets the port.
 */
async function startDevServer(proc, project) {
  // Map launch flags to the framework actually in the project: next
  // rejects --host outright (it takes -H/--hostname), vite and other
  // --host users take --host/--port, unknown scripts get only the port
  // plus PORT and HOST=127.0.0.1 in the environment. Launch flags are
  // computed per start from the stored base args, so restarts never
  // stack them.
  const { pkg } = await readDevCommand(project);
  const framework = detectFramework(pkg, pkg?.scripts?.dev ?? "");
  proc.port = await allocatePort();
  listenedProcs.delete(proc.id);
  const launch = {
    args: [...baseLaunchArgs(proc.args), ...devServerArgs(framework, proc.port, proc.bin)],
    // Unknown scripts: --port plus PORT and HOST in the environment. HOST is
    // best effort (some servers ignore it and bind wider) — the listen probe
    // then still gates reporting "running", but it connects to 127.0.0.1 and
    // cannot tell a loopback-only bind from a wide one; say so honestly.
    ...(framework === "unknown" ? { env: { PORT: String(proc.port), HOST: "127.0.0.1" } } : {}),
  };
  spawnProcess(proc, project, launch);
  // "running" is only reported once the port accepts a connection;
  // otherwise surface the captured stderr tail and reset the port.
  const up = await waitForListening(proc);
  if (up) {
    proc.status = "running";
  } else {
    const allocatedPort = proc.port;
    const alive = children.has(proc.id);
    if (alive) stopChild(children.get(proc.id));
    // Either way it never listened, so the allocated port is unusable:
    // reset it here (and again in the close handler) so a failed start
    // never reports a stale port.
    proc.port = 0;
    proc.output.push(
      alive
        ? `The dev server did not accept a connection on port ${allocatedPort} within 10 seconds; ADE stopped it. Its output is above.`
        : "The dev server exited before it could listen; its error output is above.",
    );
    proc.status = "stopped";
  }
  proc.updatedAt = now();
  await save();
  return proc;
}
/** Compact agent-facing view of a dev record: port only while running. */
const devView = (proc) => ({
  status: proc.status,
  port: proc.status === "running" ? proc.port : 0,
  command: proc.command,
});
/** Resolve and validate effort/speed/permission against the model's capability row. */
async function resolveSessionOptions(agentId, modelId, options) {
  const listed = await listAgentModels(agentId);
  const modelRow =
    modelId && listed?.available
      ? (listed.models?.find((m) => m.id === modelId) ?? { id: modelId })
      : undefined;
  return validateOptions(adapters[agentId], options, modelRow);
}

function syncOptionFields(session, value, cleared) {
  for (const key of ["effort", "speed", "permission"]) {
    if (cleared.has(key)) delete session[key];
    else if (value[key] !== undefined) session[key] = value[key];
  }
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
    cacheDir: DATA_DIR,
    canProbe: !!(agent?.installed && agent.signedIn),
  });
}
/**
 * Current dev-server state from the ADE-managed process record, rebuilt on
 * every manifest so start/stop between turns is always reflected. Awareness
 * only: the agent is told the workspace owns start/stop (see constraints).
 */
function devServerStatus(project) {
  const proc = state.processes.find((p) => p.projectId === project.id);
  if (!proc)
    return project.devScriptNote
      ? "status unknown (package.json could not be read)"
      : "no dev script detected";
  if (proc.status === "running") return `running on 127.0.0.1:${proc.port}`;
  if (proc.status === "starting") return "starting";
  return proc.startedAt ? "stopped" : "stopped (never started this session)";
}
/**
 * Records where the serving HTTP server listens, so agents get a base URL that
 * reaches it from this machine. A wildcard bind is reachable on 127.0.0.1; a
 * specific non-loopback bind is not reachable as a loopback peer at all, so
 * agents get no URL (their tools are omitted) rather than one that needs the token.
 * @param {import("node:net").AddressInfo | string | null} address `server.address()`
 */
export function setListenAddress(address) {
  if (!address || typeof address === "string") return;
  const host = address.address;
  if (host === "::1") listenBaseUrl = `http://[::1]:${address.port}`;
  else if (["0.0.0.0", "::"].includes(host) || isLoopbackAddress(host))
    listenBaseUrl = `http://127.0.0.1:${address.port}`;
  else listenBaseUrl = null;
}
/**
 * What a CLI needs to drive this project's agent computer: the MCP server
 * (Codex/OpenCode) or Pi extension path, plus the real loopback base URL of
 * the serving ADE instance. Null when that URL is not known yet — the tools
 * are then omitted rather than pointed at a guessed address.
 */
export function computerContext(project) {
  const api = listenBaseUrl;
  if (!api) return null;
  const local = path.join(adeRoot(), "src", "local");
  return {
    node: process.execPath,
    mcpScript: path.join(local, "computer-mcp.mjs"),
    piExtension: path.join(local, "computer-pi-extension.mjs"),
    env: { ADE_API: api, ADE_PROJECT_ID: project.id },
  };
}
/** The project's agent computer status, with the browser profile it uses. */
function computerView(project) {
  return { ...computers.status(project.id), profile: project.browserProfile ?? "default" };
}
/** Manifest section telling the agent it has (or lacks) its own computer. */
function agentComputerFor(project) {
  if (!computerContext(project))
    return {
      available: false,
      note: "ADE's agent browser could not be connected this turn (the ADE URL is not known yet). Tell the user you could not test visually; ask them to reopen ADE and send a follow-up.",
    };
  return {
    available: true,
    screen: `${SCREEN.width}x${SCREEN.height}`,
    tools: COMPUTER_TOOLS.map((tool) => tool.name).join(", "),
    note: "You have your own browser (headless Chrome on this machine) that the user watches live in ADE. To view or test the project: dev_server_start, then computer_open_url with the localhost URL it reports, then use browser_snapshot refs or screenshots, clicks, and typing to verify behavior like a human QA tester.",
  };
}
/**
 * Strip dev-server flags an earlier start may have left in the stored base
 * args (an older ADE persisted them into proc.args): the flags themselves
 * plus the value each one was appended with, so restarts never stack them.
 */
function baseLaunchArgs(args) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--" || arg === "127.0.0.1") continue;
    if (["--host", "-H", "--hostname", "--port", "-p"].includes(arg)) {
      i += 1;
      continue;
    }
    out.push(arg);
  }
  return out;
}
function spawnProcess(proc, project, launch = {}) {
  const args = launch.args ?? proc.args;
  const child = spawn(proc.bin, args, {
    cwd: project.path,
    env: { ...process.env, ...(launch.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    detached: process.platform !== "win32",
  });
  proc.pid = child.pid;
  // "starting" until the port proves it accepts connections (see
  // waitForListening); the start route flips it to "running" or back.
  proc.status = "starting";
  proc.startedAt = now();
  proc.output = [`$ ${proc.bin} ${args.join(" ")}`];
  children.set(proc.id, child);
  const line = (data) => {
    proc.output = [...proc.output, ...data.toString().split(/\r?\n/).filter(Boolean)].slice(-300);
    proc.updatedAt = now();
    save().catch(() => {});
  };
  child.stdout.on("data", line);
  child.stderr.on("data", line);
  child.on("error", (e) => {
    proc.status = "stopped";
    delete proc.pid;
    // A process that never listened leaves no usable port behind.
    if (!listenedProcs.has(proc.id)) proc.port = 0;
    proc.output.push(e.message);
    children.delete(proc.id);
    save().catch(() => {});
  });
  child.on("close", (code) => {
    proc.status = "stopped";
    delete proc.pid;
    if (!listenedProcs.has(proc.id)) proc.port = 0;
    proc.exitCode = code;
    proc.output.push(`Process exited (${code ?? "signal"})`);
    children.delete(proc.id);
    save().catch(() => {});
  });
  return proc;
}
/**
 * Read package.json fresh on every call (never cached): detect the dev
 * script and its package manager, or return a distinct note when the file
 * is unreadable or malformed instead of silently reporting "no script".
 */
async function readDevCommand(project) {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(project.path, "package.json"), "utf8"));
    const manager = await packageManager(project, pkg);
    return { pkg, devCommand: pkg.scripts?.dev ? `${manager} run dev` : "", note: null };
  } catch (error) {
    return {
      pkg: {},
      devCommand: "",
      note: `package.json could not be read or parsed (${error.message}); the dev script cannot be detected until the file is valid JSON.`,
    };
  }
}
/**
 * Re-evaluate scripts.dev for a project — called on every bootstrap poll —
 * and create or refresh its single ADE-managed dev-server record, keeping
 * the record id stable across rescans. Returns whether state changed so
 * the caller can persist cheaply.
 */
export async function refreshDevProcess(project) {
  const { devCommand, note } = await readDevCommand(project);
  const existing = state.processes.find((p) => p.projectId === project.id);
  if (note) {
    const changed = project.devScriptNote !== note;
    if (changed) project.devScriptNote = note;
    return { proc: existing ?? null, changed };
  }
  let changed = false;
  if (project.devScriptNote !== undefined) {
    delete project.devScriptNote;
    changed = true;
  }
  if (!devCommand) {
    // No dev script: retire a stopped record, but never one currently running.
    if (existing && existing.status !== "running" && !children.has(existing.id)) {
      state.processes = state.processes.filter((p) => p.id !== existing.id);
      return { proc: null, changed: true };
    }
    return { proc: existing ?? null, changed };
  }
  if (existing) {
    if (existing.command !== devCommand) {
      existing.command = devCommand;
      existing.output = [...(existing.output ?? []), `dev script changed: ${devCommand}`].slice(
        -300,
      );
      changed = true;
    }
    // While the record is not running, args always mirror the re-derived
    // devCommand: an older start route persisted mutated args into proc.args
    // (orphan positionals like "run dev -- 3000") and those must never leak
    // into the next launch argv. A running record keeps the args its live
    // child was started with.
    const [bin, ...args] = devCommand.split(" ");
    if (existing.status !== "running" && !children.has(existing.id)) {
      if (existing.bin !== bin || (existing.args ?? []).join(" ") !== args.join(" ")) {
        existing.bin = bin;
        existing.args = args;
        changed = true;
      }
    }
    return { proc: existing, changed };
  }
  const proc = {
    id: id(),
    projectId: project.id,
    name: "Development server",
    command: devCommand,
    bin: devCommand.split(" ")[0],
    args: devCommand.split(" ").slice(1),
    port: 0,
    status: "stopped",
    output: [],
  };
  state.processes.push(proc);
  return { proc, changed: true };
}
/**
 * The dev-server flag family the project's framework accepts: `next` rejects
 * --host outright (it takes -H/--hostname and -p), vite and other --host
 * users take --host/--port, and unknown scripts get only the port — the most
 * widely supported flag — with PORT and HOST=127.0.0.1 set in the environment
 * as belt-and-braces (servers that honor neither may bind wider; the listen
 * probe cannot tell, see startDevServer).
 */
export function detectFramework(pkg, devScript = "") {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  if (deps.next || /\bnext\s+dev\b/.test(devScript)) return "next";
  if (deps.vite || /\bvite\b/.test(devScript)) return "vite";
  return "unknown";
}
export function devServerArgs(framework, port, manager = "npm") {
  const flags =
    framework === "next"
      ? ["-H", "127.0.0.1", "-p"]
      : framework === "vite"
        ? ["--host", "127.0.0.1", "--port"]
        : ["--port"];
  // npm run requires `--` to forward flags to the script; pnpm/yarn/bun pass
  // `--` literally into the script argv, which makes vite/next ignore --port.
  return manager === "npm" ? ["--", ...flags, String(port)] : [...flags, String(port)];
}
// A browser disconnect ends the response before it is written. Waiting reads
// listen for that so a closed tab does not hold a PTY poll open.
function terminalWaitSignal(req, res) {
  if (req.signal) return req.signal;
  if (!res || typeof res.on !== "function") return undefined;
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}
function isAttachmentUploadPath(pathname) {
  const cleaned = String(pathname ?? "").replace(/\/$/, "");
  return cleaned === "/api/attachments" || cleaned === "/attachments";
}

class PayloadTooLarge extends Error {
  constructor() {
    super("Request body too large.");
    this.status = 413;
  }
}
// API request bodies are small JSON (attachments up to 14 MB). A larger body is
// refused before it is read, or as soon as it outgrows the limit: an exposed
// instance must not let an unauthenticated peer stream an unbounded body into memory.
async function body(req) {
  const url = new URL(req.url, "http://127.0.0.1");
  const attachmentUpload = req.method === "POST" && isAttachmentUploadPath(url.pathname);
  const limit = attachmentUpload ? 14 * 1024 * 1024 : 1_000_000;
  if (Number(req.headers["content-length"]) > limit) throw new PayloadTooLarge();
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new PayloadTooLarge();
  }
  return raw ? JSON.parse(raw) : {};
}
function isLoopbackAddress(address) {
  if (!address) return false;
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  return (
    normalized === "::1" || normalized === "127.0.0.1" || /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}
const hostnameOf = (hostHeader) =>
  hostHeader ? new URL(`http://${hostHeader}`).hostname.toLowerCase().replace(/^\[|\]$/g, "") : "";
function isLoopbackPeer(req) {
  const host = hostnameOf(req.headers.host);
  return (
    new Set(["127.0.0.1", "localhost", "::1"]).has(host) &&
    isLoopbackAddress(req.socket?.remoteAddress) &&
    originAllowed(req)
  );
}
function tokenAccepted(req) {
  const expected = EXPOSE_TOKEN();
  if (!expected) return false;
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ""))?.[1] ?? "";
  const cookie = /(?:^|;\s*)ade_auth=([^;]*)/.exec(String(req.headers.cookie ?? ""))?.[1] ?? "";
  for (const candidate of [bearer, cookie]) {
    if (!candidate) continue;
    if (safeTokenEqual(candidate, expected)) return true;
  }
  return false;
}
/**
 * Origin fence. Direct HTTP: the Origin authority must equal the request
 * authority. Behind an HTTPS-terminating proxy (`tailscale serve`): scheme
 * must stay https and the Origin host must equal X-Forwarded-Host when the
 * proxy sets it; without that header any https origin passes, because the
 * token (and the host-scoped SameSite=Lax cookie) remains the real gate.
 * Requests without an Origin (curl, top-level navigations) pass.
 */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let parsed;
  try {
    parsed = new URL(String(origin));
  } catch {
    return false;
  }
  const forwardProto = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    .trim();
  if (!forwardProto) return origin === `http://${req.headers.host}`;
  if (forwardProto !== "https" || parsed.protocol !== "https:") return false;
  const forwardHost = String(req.headers["x-forwarded-host"] ?? "")
    .split(",")[0]
    .trim();
  return !forwardHost || parsed.host === forwardHost;
}
/** Origin rule for the agent-browser stream socket; `req` is the upgrade request. */
export function streamOriginAllowed(origin, req) {
  // Without an Origin the caller is not a page; only this machine may be that.
  if (!origin) return isLoopbackAddress(req.socket?.remoteAddress);
  if (originAllowed(req)) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return new Set(["127.0.0.1", "localhost", "::1"]).has(host);
  } catch {
    return false;
  }
}
function localRequest(req) {
  const host = hostnameOf(req.headers.host);
  // Loopback peers (the UI on this machine, agent CLIs, dev-control curls)
  // keep same-origin Origin checks. No other peer is trusted without the token.
  if (isLoopbackPeer(req)) return true;
  // A loopback reverse proxy (`tailscale serve`) forwards with a preserved,
  // non-loopback Host and X-Forwarded-Proto; the proxy itself connects from
  // loopback and its remote clients are gated by the proxy.
  if (
    isLoopbackAddress(req.socket?.remoteAddress) &&
    req.headers["x-forwarded-proto"] &&
    originAllowed(req)
  )
    return true;
  // Opt-in LAN/Tailscale exposure: the peer must prove the token, and (for a
  // specific bind address) the Host header must name the exposed interface —
  // a DNS-rebound page presenting some other authority never reaches the API.
  // Binding 0.0.0.0/:: spans every interface, so any Host name is accepted
  // there; the token (and the host-scoped cookie) remains the gate.
  if (loopbackBind()) return false;
  if (!tokenAccepted(req) || !originAllowed(req)) return false;
  const bindHost = EXPOSE_HOST().toLowerCase();
  return bindHost === "0.0.0.0" || bindHost === "::" || host === bindHost;
}
// Registers an existing directory as a project and answers the request. Shared
// by "add a folder", "clone a repository" and "create a folder".
async function registerProject(res, real, name) {
  if (state.projects.some((p) => p.path === real))
    return json(res, 409, { error: "This project is already added." });
  const project = {
    id: id(),
    name: String(name || path.basename(real)),
    path: real,
    branch: "",
    ahead: 0,
    uncommittedFiles: [],
    defaultAgent: "codex",
    addedAt: now(),
  };
  await projectInfo(project);
  state.projects.push(project);
  // Same detection path as the bootstrap re-scan: an unreadable or
  // malformed package.json records a distinct note instead of silently
  // reporting no dev script.
  const { proc } = await refreshDevProcess(project);
  await save();
  return json(res, 201, { project, process: proc });
}
/**
 * The API router: every `/api/*` request, from the dev server or the
 * production server (src/local/server.mjs). Call start() first.
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
export async function handle(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const parts = url.pathname
    .replace(/^\/api\/?/, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  // The token exchange must be reachable by not-yet-authorized peers —
  // proving the token here is exactly how a LAN/Tailscale client becomes
  // authorized (the route itself validates it).
  const isAuthExchange = req.method === "POST" && parts[0] === "auth" && parts.length === 1;
  if (!localRequest(req) && !isAuthExchange) {
    // In exposed mode an unauthorized peer gets 401 + authRequired (the UI
    // shows its token gate). Otherwise — including ADE_HOST without
    // ADE_TOKEN, which start-local refuses to boot — the strict
    // loopback-only 403: without a token the address is never exposed.
    if (loopbackBind() || !EXPOSE_TOKEN())
      return json(res, 403, { error: "ADE local API only accepts requests from this machine." });
    return json(res, 401, {
      error: "ADE requires its access token for requests from other machines.",
      authRequired: true,
    });
  }
  // Host terminal, file editing, and harness install/update stay on loopback
  // even when ADE_TOKEN exposes other API routes. All can operate directly on
  // the user's machine.
  const harnessRoute =
    parts[0] === "agents" &&
    parts.length === 3 &&
    ["install", "update", "harness"].includes(parts[2]);
  if ((["terminal", "editor"].includes(parts[0]) || harnessRoute) && !isLoopbackPeer(req))
    return json(res, 403, { error: "Host tools are available only on this machine." });
  try {
    if (isAuthExchange) {
      const data = await body(req);
      const token = String(data.token ?? "").trim();
      if (!EXPOSE_TOKEN() || !token || !safeTokenEqual(token, EXPOSE_TOKEN()))
        return json(res, 401, { error: "Incorrect access token." });
      res.setHeader(
        "set-cookie",
        `ade_auth=${encodeURIComponent(EXPOSE_TOKEN())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`,
      );
      return json(res, 200, { ok: true });
    }
    const routeContext = {
      path,
      spawn,
      adapters,
      optionCapabilities,
      state,
      authChildren,
      id,
      harnessJobs,
      agentStatus,
      listAgentModels,
      start,
      decodeBase64,
      readAttachment,
      saveAttachment,
      DATA_DIR,
      body,
      which,
      run,
      COMPUTER_ERROR_STATUS,
      INCOGNITO_PROFILE_ID,
      HumanControlError,
      resolveAttachments,
      browserContexts,
      controls,
      browserHub,
      computers,
      browserStream,
      OBSERVE_BROWSER_ACTIONS,
      OBSERVE_COMPUTER_ACTIONS,
      save,
      computerView,
      PayloadTooLarge,
      stop,
      processMatches,
      stopChild,
      children,
      devStartClaims,
      now,
      startDevServer,
      devView,
      refreshDevProcess,
      connect,
      eventHub,
      bootstrapPayload,
      bootstrapAgents,
      refreshBootstrapInBackground,
      fs,
      os,
      getDiff,
      checksFor,
      cloneRepository,
      createProjectFolder,
      expandUserPath,
      makeDirectory,
      parseRepoSource,
      sessionLogs,
      turns,
      addMessage,
      MODEL_ID,
      UNSUPPORTED_RISK,
      resolveSessionOptions,
      syncOptionFields,
      projectInfo,
      terminalWaitSignal,
      listWorkflows,
      upsertWorkflow,
      removeWorkflow,
      req,
      res,
      url,
      parts,
      handled: false,
      registerProject: async (...args) => {
        await registerProject(...args);
        routeContext.handled = true;
        return true;
      },
      json: (...args) => {
        json(...args);
        routeContext.handled = true;
        return true;
      },
    };
    routeContext.handled = false;
    if (await terminal(routeContext)) return;
    routeContext.handled = false;
    if (await editor(routeContext)) return;
    routeContext.handled = false;
    if (await events(routeContext)) return;
    routeContext.handled = false;
    if (await sessionReads(routeContext)) return;
    routeContext.handled = false;
    if (await projects(routeContext)) return;
    routeContext.handled = false;
    if (await attachments(routeContext)) return;
    routeContext.handled = false;
    if (await sessionActions(routeContext)) return;
    routeContext.handled = false;
    if (await browser(routeContext)) return;
    routeContext.handled = false;
    if (await devServer(routeContext)) return;
    routeContext.handled = false;
    if (await agents(routeContext)) return;
    routeContext.handled = false;
    if (await workflows(routeContext)) return;
    return json(res, 404, { error: "Not found." });
  } catch (error) {
    if (
      error instanceof SourceError ||
      error instanceof TurnRefused ||
      error instanceof PayloadTooLarge
    )
      return json(res, error.status, { error: error.message });
    return json(res, 500, { error: error?.message ?? String(error) });
  }
}
/** Test-only: pin agent rows so route tests are not raced by CLI probes. */
export function _setAgentsForTest(agents) {
  state.agents = agents;
}
/** Test-only: read a live session without the bootstrap route's CLI probes. */
export function _getSessionForTest(sessionId) {
  return state.sessions.find((item) => item.id === sessionId);
}
/**
 * Test-only: whether a turn or checks run still holds the session's slot —
 * including a stopped session whose run is winding down. A stopped session
 * answers 409 to a new session in its project until this turns false.
 */
export function _sessionBusyForTest(sessionId) {
  return turns.isBusy(_getSessionForTest(sessionId));
}
let started = null;
/**
 * Loads the saved workspace and recovers its processes and turns. Importing this
 * module does nothing on its own: the server that mounts handle() calls start()
 * first (Vite's dev/preview servers, or src/local/server.mjs). Idempotent.
 */
export function start() {
  started ??= load();
  return started;
}
/**
 * Closes the agent browser and its viewers. A Vite restart (an edit to the
 * config or to a module it imports) evaluates a fresh copy of this module; the
 * old copy must let go of Chrome's profile directories before the new one
 * opens them.
 */
export async function stop() {
  if (clientRefreshTimer) clearInterval(clientRefreshTimer);
  clientRefreshTimer = null;
  if (computerWatchTimer) clearInterval(computerWatchTimer);
  computerWatchTimer = null;
  eventHub.close();
  await browserStream.close();
  await browserHub.closeAll();
  await browserContexts.close();
}
/**
 * Hands a `/preview-stream` WebSocket upgrade to the agent-browser stream,
 * after the same peer/token/Host guard as the API. Returns false for any other
 * path so the caller (or Vite's HMR socket) can handle it.
 * @returns {boolean}
 */
export function handleUpgrade(req, socket, head) {
  const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname !== "/preview-stream") return false;
  if (!localRequest(req)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return true;
  }
  return browserStream.handleUpgrade(req, socket, head);
}
/** Mounts the API and the stream on a Vite dev or preview server. */
function mount(server) {
  const httpServer = server.httpServer;
  if (httpServer) {
    httpServer.on("upgrade", (req, socket, head) => handleUpgrade(req, socket, head));
    httpServer.once("listening", () => setListenAddress(httpServer.address()));
    httpServer.once("close", () => void stop().catch(() => {}));
  }
  server.middlewares.use("/api", (req, res) => {
    handle(req, res).catch((e) => json(res, 500, { error: e.message }));
  });
}

export function adeLocalApi() {
  return {
    name: "ade-loopback-local-api",
    async configureServer(server) {
      await start();
      mount(server);
    },
    async configurePreviewServer(server) {
      // TanStack Start's SPA build renders the shell through a throwaway
      // `vite preview`; that must never touch the user's ~/.ade.
      if (process.env.TSS_PRERENDERING === "true") return;
      await start();
      mount(server);
    },
  };
}
