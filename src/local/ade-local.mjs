import { connect, createServer } from "node:net";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { killTree, spawnCommand as spawn } from "./spawn.mjs";
import { adapters } from "./adapters/index.mjs";
import { acpComputerServers } from "./adapters/computer-tools.mjs";
import { listAcpModels, runAcpTurn } from "./acp.mjs";
import { acpBridge } from "./acp-bridge.mjs";
import { classifyFailure, modelSuggestion, retryHint } from "./classify.mjs";
import { adeRoot, COMPUTER_ERROR_STATUS, createComputerManager, SCREEN } from "./computer.mjs";
import { createBrowserHub } from "./browser-page.mjs";
import { createBrowserInstaller } from "./browser-install.mjs";
import { createBrowserContexts, INCOGNITO_PROFILE_ID } from "./browser-contexts.mjs";
import { diagnoseLaunchFailure } from "./browser-host.mjs";
import { TOOLS as COMPUTER_TOOLS } from "./computer-tools-defs.mjs";
import { createBrowserStreamServer } from "./browser-stream-server.mjs";
import { createControlRegistry, HumanControlError } from "./browser-control.mjs";
import { listModels, MODEL_ID, clearModelsCache, rememberAcpModels } from "./models.mjs";
import { optionCapabilities, validateOptions } from "./capabilities.mjs";
import {
  HARNESS,
  commandLine,
  compareVersions,
  detectInstallMethod,
  latestVersion,
  createHarnessJobs,
} from "./harness.mjs";
import { listWorkflows, upsertWorkflow, deleteWorkflow as removeWorkflow } from "./workflows.mjs";
import { reconcileWorkspaceMessages, saveWorkspace } from "./workspace-persistence.mjs";
import {
  decodeBase64,
  formatAttachmentPrompt,
  readAttachment,
  resolveAttachments,
  saveAttachment,
} from "./attachments.mjs";

const DATA_DIR = path.join(os.homedir(), ".ade");
const DATA_FILE = path.join(DATA_DIR, "workspace.json");
const state = { projects: [], sessions: [], processes: [], agents: [], workflows: [] };
const children = new Map();
const authChildren = new Map();
// Process ids whose dev-server port has been confirmed to accept a
// connection; a process that dies before that never actually listened.
const listenedProcs = new Set();
// Real base URL of the serving ADE instance, taken from the latest loopback
// request's Host header; null until the first request after boot.
let lastApiBaseUrl = null;
const devStartClaims = new Set();
// One agent computer (headless Chrome) per project; see computer.mjs. The installer and the
// Playwright contexts are process-wide: when Vite loads this module a second time, both copies
// share one Chrome instead of fighting over the same profile directory.
const browserInstaller = (globalThis.__adeBrowserInstaller ??= createBrowserInstaller({
  baseDir: DATA_DIR,
}));
const browserContexts = (globalThis.__adeBrowserContexts ??= createBrowserContexts({
  profilesDir: path.join(DATA_DIR, "browser", "profiles"),
  executable: () => browserInstaller.executable(),
  diagnose: (executable, cause) => diagnoseLaunchFailure({ executable, cause }),
}));
// One control lock per project, shared by the browser stream, computer_* and browser_* tools.
// The hub and the WebSocket stream server start lazily on first use.
const controls = createControlRegistry();
void globalThis.__adeBrowserStream?.close?.().catch?.(() => {});
void globalThis.__adeBrowserHub?.closeAll?.().catch?.(() => {});
// Each project browses in its own persistent profile, or a throwaway context in incognito mode.
const browserHub = createBrowserHub({
  contextFor(projectId) {
    const project = state.projects.find((x) => x.id === projectId);
    return project?.browserProfile === INCOGNITO_PROFILE_ID
      ? browserContexts.contextFor(INCOGNITO_PROFILE_ID, projectId)
      : browserContexts.contextFor(projectId);
  },
});
globalThis.__adeBrowserHub = browserHub;
const computers = createComputerManager({ installer: browserInstaller, hub: browserHub });
// Address headers of the latest trusted loopback API request (see handle()).
// The stream's Origin check runs the same originAllowed rule against them.
let lastApiHeaders = null;
let sharedUpgradeAttached = false;
const browserStream = createBrowserStreamServer({
  hub: browserHub,
  controls,
  originAllowed: (origin) => {
    if (lastApiHeaders !== null && originAllowed({ headers: { ...lastApiHeaders, origin } }))
      return true;
    if (!origin) return true;
    try {
      const parsed = new URL(origin);
      const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (new Set(["127.0.0.1", "localhost", "::1"]).has(host)) return true;
      if (!EXPOSE_HOST() && !EXPOSE_TOKEN() && isPrivateIpAddress(host)) return true;
    } catch {}
    return false;
  },
});
globalThis.__adeBrowserStream = browserStream;
const OBSERVE_BROWSER_ACTIONS = new Set(["status", "snapshot", "screenshot", "wait_for"]);
const OBSERVE_COMPUTER_ACTIONS = new Set(["screenshot", "wait"]);
const AGENTS_STATUS_FILE = path.join(DATA_DIR, "agents-status.json");
let probingAgents = false;
let refreshingBootstrap = false;
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

async function save() {
  await saveWorkspace(DATA_FILE, state);
}
async function load() {
  try {
    const saved = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    state.projects = Array.isArray(saved.projects) ? saved.projects : [];
    state.sessions = Array.isArray(saved.sessions) ? saved.sessions : [];
    state.processes = Array.isArray(saved.processes) ? saved.processes : [];
    state.workflows = Array.isArray(saved.workflows) ? saved.workflows : [];
    let changed = false;
    for (const p of state.processes) {
      const project = state.projects.find((item) => item.id === p.projectId);
      const running = !!(p.pid && project && (await processMatches(p.pid, project.path)));
      if (p.status !== (running ? "running" : "stopped") || (!running && p.pid)) changed = true;
      p.status = running ? "running" : "stopped";
      if (!running) delete p.pid;
      p.output = p.output ?? [];
    }
    for (const s of state.sessions) {
      const active = ["working", "verifying"].includes(s.status);
      const project = state.projects.find((item) => item.id === s.projectId);
      if (s.pid && project && (await processMatches(s.pid, project.path))) stopChild(s.pid);
      if (active) {
        s.status = "stopped";
        addMessage(
          s,
          "system",
          "ADE restarted and stopped the interrupted CLI process. Any project edits made before it stopped are kept.",
        );
        changed = true;
      }
      if (s.pid) {
        delete s.pid;
        changed = true;
      }
      if (s.steerNow) {
        delete s.steerNow;
        changed = true;
      }
      // A permission request dies with the agent process that asked it.
      if (s.pendingPermissions) {
        delete s.pendingPermissions;
        changed = true;
      }
    }
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
async function processMatches(pid, projectPath) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    if (process.platform === "linux")
      return (await fs.realpath(`/proc/${pid}/cwd`)) === projectPath;
    if (process.platform === "darwin") {
      const result = await run("lsof", ["-Fn", "-a", "-p", String(pid), "-d", "cwd"], {
        timeout: 3000,
      });
      const cwd = result.stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith("n"))
        ?.slice(1);
      return cwd ? (await fs.realpath(cwd)) === projectPath : false;
    }
  } catch {}
  return false;
}
const run = (bin, args, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "",
      stderr = "";
    const timer = opts.timeout ? setTimeout(() => child.kill("SIGTERM"), opts.timeout) : null;
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}${e.message}` });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
async function executable(bin) {
  const res = await run(bin, ["--version"], { timeout: 5000 });
  return res.code === 0 ? (res.stdout || res.stderr).trim().split(/\r?\n/)[0].slice(0, 100) : null;
}
async function which(bin) {
  const res = await run(process.platform === "win32" ? "where" : "which", [bin], {
    timeout: 3000,
  });
  if (res.code !== 0) return null;
  const line = (res.stdout || "").trim().split(/\r?\n/)[0]?.trim();
  return line || null;
}
async function npmRoot() {
  const res = await run("npm", ["root", "-g"], { timeout: 5000 });
  if (res.code !== 0) return null;
  const root = (res.stdout || "").trim().split(/\r?\n/)[0]?.trim();
  return root || null;
}
const harnessDetectDeps = {
  which,
  npmRoot,
  realpath: (p) => fs.realpath(p),
};
const harnessJobs = createHarnessJobs({
  spawn,
  onFinished: () => {
    clearModelsCache(DATA_DIR);
    agentStatus().catch(() => {});
  },
});

async function agentStatus() {
  const results = await Promise.all(
    Object.values(adapters).map(async (adapter) => {
      const version = await executable(adapter.bin);
      const auth = version ? await adapter.detectAuth(run) : { signedIn: false };
      const install = await detectInstallMethod(adapter.id, harnessDetectDeps);
      const entry = HARNESS[adapter.id];
      const harness = entry
        ? { install: commandLine(entry.install), update: commandLine(entry.update) }
        : { install: "", update: "" };
      const row = {
        id: adapter.id,
        name: adapter.name,
        short: adapter.short,
        tools: adapter.tools,
        authMethod: adapter.authMethod,
        authNote: adapter.authNote,
        installHint: adapter.installHint,
        installed: !!version,
        // "codex-cli 0.158.0" and "2.1.307 (Claude Code)" both report the number.
        ...(version
          ? { version: version.match(/\d+(?:\.\d+)+\S*/)?.[0] ?? version.replace(/^.*?\s/, "") }
          : {}),
        ...auth,
        carriesConversation: true,
        installMethod: install.method,
        ...(install.path ? { installPath: install.path } : {}),
        harness,
      };
      return row;
    }),
  );
  state.agents = results;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      AGENTS_STATUS_FILE,
      JSON.stringify({ fetchedAt: Date.now(), agents: results }),
      { mode: 0o600 },
    );
  } catch {}
  // Background, non-blocking latest-version checks — next bootstrap poll picks them up.
  for (const agent of results) {
    // A CLI that updates itself in place is never behind in a way ADE can fix.
    if (HARNESS[agent.id]?.selfUpdates && agent.installMethod !== "npm") continue;
    void (async () => {
      const latest = await latestVersion(agent.id, run);
      if (latest == null) return;
      const current = state.agents.find((a) => a.id === agent.id);
      if (!current) return;
      current.latestVersion = latest;
      if (current.version && compareVersions(current.version, latest) < 0)
        current.updateAvailable = true;
      else delete current.updateAvailable;
      try {
        await fs.writeFile(
          AGENTS_STATUS_FILE,
          JSON.stringify({ fetchedAt: Date.now(), agents: state.agents }),
          { mode: 0o600 },
        );
      } catch {}
    })();
  }
  return results;
}

/**
 * Fast path for the UI's 2-second bootstrap poll: return the last probed
 * agent status immediately (persisted under ~/.ade) and refresh the real
 * probes in the background — the next poll picks them up. Only the very
 * first bootstrap after the store is wiped pays the full probe latency.
 * A single background probe runs at a time so polls can't stampede CLIs.
 */
async function bootstrapAgents() {
  let cached = null;
  try {
    cached = JSON.parse(await fs.readFile(AGENTS_STATUS_FILE, "utf8"));
  } catch {}
  if (cached?.agents) {
    // Caches written before agentStatus copied the adapter tools string lack
    // it: backfill from the adapter so buildManifest resolves the real tool
    // set immediately, while the background probe refreshes the rest.
    state.agents = cached.agents.map((agent) => {
      const entry = HARNESS[agent.id];
      return {
        ...agent,
        tools: agent.tools ?? adapters[agent.id]?.tools,
        harness:
          agent.harness ??
          (entry
            ? { install: commandLine(entry.install), update: commandLine(entry.update) }
            : undefined),
      };
    });
  }
  // Never make the project list wait on CLI version/auth probes. If there's
  // no cache yet, return the current (possibly empty) agent list; the normal
  // bootstrap poll picks up the probe result when it finishes.
  if (!probingAgents) {
    probingAgents = true;
    agentStatus()
      .catch(() => {})
      .finally(() => {
        probingAgents = false;
      });
  }
  return state.agents;
}
function refreshBootstrapInBackground() {
  if (refreshingBootstrap) return;
  refreshingBootstrap = true;
  void (async () => {
    const needsDiff = new Set(
      state.sessions.filter((item) => item.status !== "complete").map((item) => item.projectId),
    );
    let devStateChanged = false;
    for (const p of state.projects) {
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
    if (devStateChanged) save().catch(() => {});
  })()
    .catch((error) => console.warn("ADE background bootstrap refresh failed:", error))
    .finally(() => {
      refreshingBootstrap = false;
    });
}
const safeProject = (p) => ({ ...p });
async function gitAt(directory, args) {
  return run("git", ["-C", directory, ...args], { timeout: 10000 });
}
// Users can select a workspace folder whose actual repository is one level
// down (for example project/code/.git). Keep paths relative to the selected
// folder so the UI, manifests, and diff views all refer to the same files.
async function gitRepositories(project) {
  const root = await gitAt(project.path, ["rev-parse", "--show-toplevel"]);
  if (root.code === 0) return [{ directory: project.path, prefix: "" }];
  let entries;
  try {
    entries = await fs.readdir(project.path, { withFileTypes: true });
  } catch {
    return [];
  }
  const repositories = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(project.path, entry.name);
    try {
      await fs.stat(path.join(directory, ".git"));
    } catch {
      continue;
    }
    const found = await gitAt(directory, ["rev-parse", "--show-toplevel"]);
    if (found.code === 0 && path.resolve(found.stdout.trim()) === path.resolve(directory))
      repositories.push({ directory, prefix: `${entry.name}/` });
  }
  return repositories;
}
async function projectInfo(project) {
  try {
    await fs.stat(project.path);
    project.missing = false;
  } catch {
    project.missing = true;
    project.branch = "folder missing";
    project.uncommittedFiles = [];
    project.ahead = 0;
    return safeProject(project);
  }
  const repositories = await gitRepositories(project);
  const changedFiles = [];
  const branches = [];
  let ahead = 0;
  for (const repo of repositories) {
    const branchRes = await gitAt(repo.directory, ["branch", "--show-current"]);
    const statusRes = await gitAt(repo.directory, ["status", "--porcelain=v1", "-uall"]);
    const aheadRes = await gitAt(repo.directory, ["rev-list", "--count", "@{upstream}..HEAD"]);
    branches.push(branchRes.code === 0 ? branchRes.stdout.trim() || "(detached)" : "unknown");
    changedFiles.push(
      ...statusRes.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => `${repo.prefix}${line.slice(3)}`),
    );
    if (aheadRes.code === 0) ahead += Number(aheadRes.stdout.trim()) || 0;
  }
  project.branch =
    branches.length === 0
      ? "not a git repository"
      : branches.length === 1
        ? branches[0]
        : `${branches.length} repositories`;
  project.uncommittedFiles = [...new Set(changedFiles)];
  project.ahead = ahead;
  return safeProject(project);
}
async function getDiff(project) {
  const repositories = await gitRepositories(project);
  const diffs = [];
  const files = [];
  const changes = [];
  for (const repo of repositories) {
    const tracked = await gitAt(repo.directory, ["diff", "HEAD", "--no-ext-diff", "--unified=3"]);
    const names = await gitAt(repo.directory, ["status", "--porcelain=v1", "-uall"]);
    const diff = tracked.stdout;
    diffs.push(diff);
    let current;
    for (const line of diff.split(/\r?\n/)) {
      if (line.startsWith("diff --git ")) {
        const filePath =
          line.match(/ (?:b|w)\/(.*)$/)?.[1] ??
          line.slice("diff --git ".length).split(/\s+/).at(-1);
        current = { path: `${repo.prefix}${filePath}`, added: 0, removed: 0, hunk: [] };
        changes.push(current);
      } else if (current && line.startsWith("@@")) current.hunk.push(line);
      else if (current && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
        current.hunk.push(line);
        if (line.startsWith("+") && !line.startsWith("+++")) current.added++;
        if (line.startsWith("-") && !line.startsWith("---")) current.removed++;
      }
    }
    for (const line of names.stdout.split(/\r?\n/).filter(Boolean)) {
      const file = { status: line.slice(0, 2).trim(), path: `${repo.prefix}${line.slice(3)}` };
      files.push(file);
      if (changes.some((change) => change.path === file.path)) continue;
      const absolute = path.resolve(project.path, file.path);
      const rel = path.relative(project.path, absolute);
      let hunk = [
        `${file.status || "??"} · diff unavailable (binary, oversized, or unreadable file)`,
      ];
      let added = 0;
      if (
        file.status === "??" &&
        rel &&
        !rel.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(rel)
      ) {
        try {
          const stat = await fs.lstat(absolute);
          if (stat.isFile() && stat.size <= 262144) {
            const content = await fs.readFile(absolute);
            if (!content.includes(0)) {
              const lines = content.toString("utf8").split(/\r?\n/);
              added = lines.filter(
                (line, index) => index < lines.length - 1 || line.length > 0,
              ).length;
              hunk = ["@@ added file @@", ...lines.map((line) => `+${line}`)];
            }
          }
        } catch {}
      }
      changes.push({ path: file.path, added, removed: 0, hunk });
    }
  }
  return { diff: diffs.join("\n"), files, changes };
}
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
function addLog(session, text) {
  session.logs = [...(session.logs ?? []), text].slice(-500);
  session.updatedAt = now();
}
function addMessage(session, role, text, extra = {}) {
  if (!text.trim()) return;
  const last = session.messages.at(-1);
  if (role === "agent" && last?.role === "agent" && now() - last.at < 1200) {
    last.text += text;
    last.at = now();
  } else session.messages.push({ id: id(), role, text, at: now(), ...extra });
  session.updatedAt = now();
}

function attachmentMeta(files) {
  return files.length
    ? {
        attachments: files.map(({ id, name, mime, size, kind }) => ({
          id,
          name,
          mime,
          size,
          kind,
        })),
      }
    : {};
}

function adapterAttachments(files) {
  return files.map(({ absPath, mime, kind, name }) => ({
    path: absPath,
    mime,
    kind,
    name,
  }));
}
function parseAgentOutput(session, line) {
  addLog(session, line);
  const update = adapters[session.agentId].parse(line, session);
  if (update.text) addMessage(session, "agent", update.text);
  if (update.error) addMessage(session, "system", update.error);
  return update;
}
/**
 * Classify one agent turn from its own output slice only: history before
 * logStart/messageStart belongs to earlier turns, so an old line (e.g. an
 * earlier "rate limit") can never re-classify this turn. A successful turn
 * clears any stale failureKind so it cannot haunt later failures either.
 */
export function classifyTurnFailure(session, code, logStart, messageStart) {
  const texts = [
    ...session.messages
      .slice(messageStart)
      .filter((m) => m.role === "system")
      .map((m) => m.text),
    ...session.logs.slice(logStart),
  ];
  if (code === 0) {
    delete session.failureKind;
    return { kind: undefined, texts };
  }
  const kind = classifyFailure(texts);
  // failureKind must describe the CURRENT turn only: a generic process
  // failure clears any quota/model diagnosis left by an earlier turn.
  if (kind === "process") delete session.failureKind;
  else session.failureKind = kind;
  return { kind, texts };
}
/** Resolve and validate effort/speed/permission against the model's capability row. */
async function resolveSessionOptions(agentId, modelId, options) {
  const listed = await listAgentModels(agentId);
  const modelRow =
    modelId && listed?.available
      ? (listed.models?.find((m) => m.id === modelId) ?? { id: modelId })
      : undefined;
  return validateOptions(agentId, options, modelRow);
}

function syncOptionFields(session, value, cleared) {
  for (const key of ["effort", "speed", "permission"]) {
    if (cleared.has(key)) delete session[key];
    else if (value[key] !== undefined) session[key] = value[key];
  }
}

/** ACP permission requests waiting on the user: request id → resolve. */
const permissionWaiters = new Map();
/** Answer every open request "cancelled" (the turn is ending) and clear them. */
function dropPermissions(session) {
  for (const request of session.pendingPermissions ?? []) {
    permissionWaiters.get(request.id)?.({ outcome: "cancelled" });
    permissionWaiters.delete(request.id);
  }
  delete session.pendingPermissions;
}
/**
 * Drive one ACP turn (see acp.mjs) on the spawned agent, then end the agent:
 * close stdin, and SIGTERM its group if it lingers. Never rejects. Settles
 * with { ok, sawText }; a failure's own error is already a system message.
 */
function runAcpSession(session, project, child, prompt, attachments, continuing) {
  const adapter = adapters[session.agentId];
  const version = state.agents.find((a) => a.id === session.agentId)?.version ?? "";
  const computer = computerContext(project);
  let sawText = false;
  const end = () => {
    child.stdin?.end();
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) stopChild(child);
    }, 3000);
    timer.unref?.();
    child.once("close", () => clearTimeout(timer));
  };
  return runAcpTurn({
    child,
    name: adapter.name,
    cwd: project.path,
    prompt,
    images: attachments.filter((a) => a.kind === "image"),
    resumeId: continuing ? session.agentSessionId : undefined,
    permission: session.permission ?? "build",
    modes: adapter.modes,
    model: session.model,
    defaultModel: session.acpDefaultModel,
    mcpServers: acpComputerServers(computer),
    sessionMeta: adapter.sessionMeta?.({ computer: !!computer }),
    on: {
      sessionId: (value) => {
        session.agentSessionId = value;
      },
      defaultModel: (value) => {
        session.acpDefaultModel = value;
      },
      text: (text) => {
        addMessage(session, "agent", text);
        if (text.trim()) sawText = true;
      },
      log: (line) => addLog(session, line),
      notice: (text) => addMessage(session, "system", text),
      models: (models) => void rememberAcpModels(DATA_DIR, adapter.id, version, models),
      permission: (request) =>
        new Promise((resolve) => {
          const entry = { id: id(), at: now(), ...request };
          session.pendingPermissions = [...(session.pendingPermissions ?? []), entry];
          permissionWaiters.set(entry.id, resolve);
          addLog(
            session,
            JSON.stringify({ type: "permission", decision: "asked", title: request.title }),
          );
          void save();
        }),
    },
  }).then(
    ({ stopReason, declinedModeSwitch }) => {
      end();
      // Plan's own decline of "leave plan mode" ends Claude's turn as
      // cancelled; the plan was delivered, so that is a finished turn.
      const cancelled = stopReason === "cancelled" && !declinedModeSwitch;
      if (stopReason === "max_tokens" || stopReason === "max_turn_requests")
        addMessage(
          session,
          "system",
          `${adapter.name} stopped early: it reached its ${stopReason === "max_tokens" ? "output token" : "tool request"} limit for one turn. Send a follow-up to let it continue.`,
        );
      if (stopReason === "refusal")
        addMessage(session, "system", `${adapter.name} refused to continue this request.`);
      if (cancelled)
        addMessage(session, "system", `${adapter.name} cancelled the turn before finishing.`);
      return { ok: stopReason !== "refusal" && !cancelled, sawText };
    },
    (error) => {
      end();
      // A stop or "send now" kills the agent on purpose, and a spawn failure
      // is reported by runAgent's own error handler: neither is news here.
      if (child.pid && session.status !== "stopped" && !session.steerNow)
        addMessage(session, "system", error.message);
      return { ok: false, sawText };
    },
  );
}
/**
 * What an ACP adapter's command() needs beyond the session: its bridge's
 * [bin, args] (set up on first use, announced through onInstall) and the
 * user's own CLI on PATH.
 */
async function acpLaunch(adapter, onInstall) {
  if (!adapter.bridge) return {};
  const executable = await which(adapter.bin);
  if (!executable)
    throw new Error(`${adapter.name} is not on PATH (\`${adapter.bin}\`). ${adapter.installHint}.`);
  const bridge = await acpBridge(adapter.bridge, { dataDir: DATA_DIR, which, run, onInstall });
  return { bridge, executable };
}
/** An ACP agent's models, from a session it opens and is never prompted in. */
async function probeAcpModels(adapter) {
  const [bin, args, env] = adapter.command(await acpLaunch(adapter));
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const child = spawn(bin, args, {
    cwd: DATA_DIR,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "ignore"],
    shell: false,
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), 30000);
  try {
    return await listAcpModels({
      child,
      name: adapter.name,
      cwd: DATA_DIR,
      sessionMeta: adapter.sessionMeta?.({ computer: false, ephemeral: true }),
    });
  } finally {
    clearTimeout(timer);
    child.stdin?.end();
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }, 3000).unref?.();
  }
}
/**
 * listModels for an agent at its detected version. An installed, signed-in
 * ACP agent is asked for its list when ADE has none for that version yet.
 */
function listAgentModels(agentId) {
  const agent = state.agents.find((a) => a.id === agentId);
  const adapter = adapters[agentId];
  return listModels(agentId, run, {
    version: agent?.version ?? "",
    cacheDir: DATA_DIR,
    ...(adapter?.protocol === "acp" && agent?.installed && agent.signedIn
      ? { probeAcp: () => probeAcpModels(adapter) }
      : {}),
  });
}
export function agentCommand(session, project, prompt, continuing, attachments = [], launch = {}) {
  const adapter = adapters[session.agentId];
  return adapter.command({
    ...launch,
    projectPath: project.path,
    prompt,
    session,
    continuing,
    dataDir: DATA_DIR,
    providers: state.agents.find((a) => a.id === session.agentId)?.providers,
    model: session.model,
    effort: session.effort,
    speed: session.speed,
    permission: session.permission,
    attachments,
    computer: computerContext(project),
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
// Only NITRO_PORT is ADE's own configured listen port (set by
// scripts/start-local.mjs); a generic shell PORT could belong to anything.
function knownListenBaseUrl() {
  const port = process.env.NITRO_PORT;
  return port && /^\d+$/.test(String(port)) ? `http://127.0.0.1:${port}` : null;
}
/**
 * What a CLI needs to drive this project's agent computer: the MCP server
 * (Codex/OpenCode) or Pi extension path, plus the real loopback base URL of
 * the serving ADE instance. Null when that URL is not known yet — the tools
 * are then omitted rather than pointed at a guessed address.
 */
export function computerContext(project) {
  const api = lastApiBaseUrl ?? knownListenBaseUrl();
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
async function otherServiceStatus(project) {
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
export async function buildManifest(session, project) {
  const agent = state.agents.find((a) => a.id === session.agentId);
  const repositories = await gitRepositories(project);
  const files = (
    await Promise.all(
      repositories.map(async (repo) => {
        const tracked = await gitAt(repo.directory, ["ls-files", "-co", "--exclude-standard"]);
        return tracked.stdout
          .split(/\r?\n/)
          .filter(Boolean)
          .map((file) => `${repo.prefix}${file}`);
      }),
    )
  )
    .flat()
    .slice(0, 400);
  const candidates = files.filter((file) =>
    /(readme|package\.json|src|app|lib|components|routes|pages|server|api|test|spec)/i.test(file),
  );
  return {
    createdAt: now(),
    project: { id: project.id, name: project.name, path: project.path, branch: project.branch },
    task: session.request,
    ...(session.criteria ? { acceptanceCriteria: session.criteria } : {}),
    agent: {
      id: session.agentId,
      account: agent?.account ?? null,
      model: session.model ?? "agent default",
    },
    devServer: devServerStatus(project),
    agentComputer: agentComputerFor(project),
    otherServices: await otherServiceStatus(project),
    constraints: [
      "Work only within the project directory",
      "No deployments, publishing, or external/shared-system changes without the user",
      "Do not revert or overwrite user changes",
      "The devServer status is ADE's observed snapshot at turn start. If it includes a running URL, use that URL instead of asking the user which frontend port to open. Do not infer that other services are running from the frontend alone.",
      "Start, stop, and inspect the dev server only with the dev_server_start/dev_server_stop/dev_server_status tools; never start a server yourself (no nohup, &, disown, or a foreground dev command) and never leave one running that ADE does not manage",
      "After changing anything visible, verify it in your agent browser (computer_open_url, screenshots, clicks, typing) before reporting done, and say what you checked; if the browser tools fail, report the exact error instead of claiming it works",
    ],
    relevantFiles: candidates.slice(0, 60),
    tools: agent?.tools ?? "agent's default CLI tools",
    dirtyWorktree: (project.uncommittedFiles ?? []).length > 0,
    ...(project.uncommittedFiles?.length
      ? { uncommittedFiles: project.uncommittedFiles.slice(0, 40) }
      : {}),
  };
}
async function runAgent(session, prompt, continuing = false, attachments = []) {
  const project = state.projects.find((p) => p.id === session.projectId);
  if (!project) {
    releaseTurn(session);
    return;
  }
  const meta = state.agents.find((a) => a.id === session.agentId);
  if (!meta?.installed || !meta.signedIn) {
    session.status = "blocked";
    addMessage(
      session,
      "system",
      `${meta?.name ?? session.agentId} is not available or not authenticated. Check the Agents page.`,
    );
    releaseTurn(session);
    await save();
    return;
  }
  // Mark where this turn's output starts so failure classification only ever
  // sees the current turn, never earlier history.
  const turnLogStart = session.logs.length;
  const turnMessageStart = session.messages.length;
  let bin = "";
  let args = [];
  let extraEnv = {};
  let turnPrompt = "";
  const acp = adapters[session.agentId].protocol === "acp";
  try {
    session.status = "working";
    await save();
    await projectInfo(project);
    delete session.changeCountUnavailable;
    // Refresh the preserved-changes baseline at the start of every turn so it
    // reflects the tree as it is right now (the user may edit between turns).
    if (project.uncommittedFiles.length) {
      const baseline = await getDiff(project);
      session.baselineFiles = baseline.files.map((f) => f.path);
    } else {
      delete session.baselineFiles;
    }
    session.manifest = await buildManifest(session, project);
    addLog(
      session,
      `Context manifest: ${session.manifest.relevantFiles.length} candidate files, tools: ${session.manifest.tools}`,
    );
    const manifestLine =
      `Context manifest: project ${project.name} (${project.branch}); task: ${session.request}` +
      (session.criteria ? `; acceptance criteria: ${session.criteria}` : "") +
      `; model: ${session.model ?? "agent default"}` +
      `; dev server at turn start: ${session.manifest.devServer}` +
      `; other services: ${session.manifest.otherServices}` +
      `; agent browser: ${session.manifest.agentComputer.available ? `available (${session.manifest.agentComputer.screen}; tools: ${session.manifest.agentComputer.tools}). ` : "unavailable. "}${session.manifest.agentComputer.note}` +
      `; constraints: ${session.manifest.constraints.join("; ")}; candidate files: ${session.manifest.relevantFiles.join(", ") || "(none listed)"}` +
      (session.manifest.uncommittedFiles
        ? `; the user has uncommitted changes in these files: ${session.manifest.uncommittedFiles.join(", ")} — never revert, stash, commit, or overwrite them; work around them`
        : "");
    const safetyPreamble =
      "Safety instructions: Work only in this project. Do not deploy, publish, send external communications, modify shared or production systems, or delete data. If such an action is necessary, stop and ask the user instead. Preserve existing files unless the requested code change requires editing them. ";
    turnPrompt = `${safetyPreamble}${manifestLine}\n\nTask: ${prompt}`;
    const command = agentCommand(
      session,
      project,
      turnPrompt,
      continuing,
      attachments,
      acp
        ? await acpLaunch(adapters[session.agentId], () => {
            const { name, bin, bridge } = adapters[session.agentId];
            addMessage(
              session,
              "system",
              `Setting up ${name} for ADE, once: installing its ACP bridge (${bridge.pkg}@${bridge.version}) under ~/.ade/acp. Your own \`${bin}\` stays the one that runs.`,
            );
            void save();
          })
        : {},
    );
    bin = command[0];
    args = command[1];
    // Optional third element: per-turn environment (agent-computer wiring).
    extraEnv = command[2] ?? {};
    if (session.agentId === "pi")
      await fs.mkdir(path.join(DATA_DIR, "sessions"), { recursive: true, mode: 0o700 });
    // The user may have stopped the session while the manifest was being
    // built: honor that instead of spawning a CLI nobody is waiting for.
    if (session.status === "stopped" || session.status === "complete") {
      releaseTurn(session);
      addLog(session, "Turn not started: the session was stopped before the CLI launched.");
      await save();
      return;
    }
  } catch (error) {
    // Any pre-spawn failure must free the claimTurn placeholder, or the
    // session would queue follow-ups forever with no live child to drain them.
    releaseTurn(session);
    if (!["stopped", "complete"].includes(session.status)) session.status = "blocked";
    addMessage(session, "system", `ADE could not start this turn: ${error.message}`);
    await save().catch(() => {});
    return;
  }
  const child = spawn(bin, args, {
    cwd: project.path,
    env: { ...process.env, ...extraEnv },
    // An ACP agent takes the whole turn as JSON-RPC over stdin/stdout.
    stdio: [acp ? "pipe" : "ignore", "pipe", "pipe"],
    shell: false,
    detached: process.platform !== "win32",
  });
  session.pid = child.pid;
  // Register the child and its handlers with no await in between: an await
  // here would let a very fast exit fire close before anyone is listening,
  // leaving a dead child in `children` that /messages would queue behind.
  children.set(session.id, child);
  let stdoutBuffer = "",
    stderrBuffer = "";
  // Some CLIs (Pi print mode) exit 0 even when the provider rejected the
  // turn, so an adapter's own settled-event failure is recorded here for
  // this turn only. sawAgentText tracks real output from this turn's own
  // events, which message positions cannot (consecutive agent messages merge).
  let turnFailed = false;
  let sawAgentText = false;
  const consume = (data, isErr = false) => {
    if (isErr) {
      const text = data.toString();
      stderrBuffer += text;
      const lines = text.split(/\r?\n/).filter(Boolean);
      session.logs = [...session.logs, ...lines].slice(-500);
      for (const line of lines) {
        const permission = line.match(/permission requested: (.*?); auto-rejecting/i);
        if (permission)
          addMessage(
            session,
            "system",
            `OpenCode requested permission for ${permission[1]}; its non-interactive CLI rejected the request. ADE did not approve or run that action.`,
          );
      }
      session.updatedAt = now();
      return;
    }
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const update = parseAgentOutput(session, line);
      if (update?.failsTurn) turnFailed = true;
      if (update?.text?.trim()) sawAgentText = true;
    }
  };
  // ADE ends an ACP agent itself once the turn settles, so its exit code says
  // nothing about the turn: the close handler takes the ACP outcome instead.
  const acpTurn = acp
    ? runAcpSession(session, project, child, turnPrompt, attachments, continuing)
    : null;
  if (!acp) child.stdout.on("data", (d) => consume(d));
  child.stderr.on("data", (d) => consume(d, true));
  child.on("error", async (error) => {
    children.delete(session.id);
    delete session.pid;
    session.status = "blocked";
    addMessage(session, "system", `${bin} failed to start: ${error.message}`);
    await save();
  });
  child.on("close", async (exitCode, exitSignal) => {
    let code = exitCode;
    let signal = exitSignal;
    if (acpTurn) {
      const outcome = await acpTurn;
      dropPermissions(session);
      code = outcome.ok ? 0 : 1;
      signal = null;
      if (!outcome.ok) turnFailed = true;
      if (outcome.sawText) sawAgentText = true;
    }
    if (stdoutBuffer.trim()) {
      const update = parseAgentOutput(session, stdoutBuffer);
      if (update?.failsTurn) turnFailed = true;
      if (update?.text?.trim()) sawAgentText = true;
    }
    children.delete(session.id);
    delete session.pid;
    // Refresh the live diff on every exit path and flag files that were
    // already dirty before this turn as pre-existing (the user's), so the
    // diff view separates their work from the agent's.
    const flagBaseline = (changes) => {
      const baseline = new Set(session.baselineFiles ?? []);
      return changes.map((c) => (baseline.has(c.path) ? { ...c, preExisting: true } : c));
    };
    if (session.steerNow && !["stopped", "complete"].includes(session.status)) {
      const prompt = session.steerNow;
      delete session.steerNow;
      session.changes = flagBaseline((await getDiff(project)).changes);
      if (!claimTurn(session)) {
        (session.queuedMessages ??= []).push(prompt);
        await save();
        return;
      }
      session.status = "working";
      await save();
      return runAgent(session, prompt, true, []);
    }
    if (session.status === "stopped") {
      session.changes = flagBaseline((await getDiff(project)).changes);
      await save();
      return;
    }
    const queue = session.queuedMessages ?? [];
    session.queuedMessages = [];
    if (queue.length) {
      // The slot was freed by the children.delete above with no await in
      // between; re-claim synchronously so /messages queues instead of
      // racing this drain with a second spawn.
      claimTurn(session);
      await save();
      // Queued turns only carry the path appendix in text; native CLI flags apply
      // to the immediately spawned turn, not to drained queue entries.
      return runAgent(session, queue.join("\n\n"), true, []);
    }
    // A CLI that exits 0 after its own settled error (Pi print mode) still
    // failed: never report "ready to review" for a turn that produced nothing.
    // OpenCode does the same thing on an uncaught provider/model rejection —
    // exit 0, empty stdout, stack trace on stderr — so a zero exit with no
    // agent output and real error wording is also a failed turn.
    let effectiveCode = turnFailed && code === 0 ? 1 : code;
    let turnSlice = classifyTurnFailure(session, effectiveCode, turnLogStart, turnMessageStart);
    if (effectiveCode === 0 && !sawAgentText && classifyFailure(turnSlice.texts) !== "process") {
      effectiveCode = 1;
      turnSlice = classifyTurnFailure(session, effectiveCode, turnLogStart, turnMessageStart);
    }
    session.status = effectiveCode === 0 ? "ready" : "blocked";
    // Classify from this turn's own output slice only; a successful turn
    // also clears any stale failureKind left by an earlier failure.
    const { kind: failureKind, texts: failureTexts } = turnSlice;
    if (effectiveCode === 0 && !sawAgentText)
      addMessage(
        session,
        "system",
        "The CLI exited successfully but did not emit a parseable response. Review the Logs tab for its raw output.",
      );
    if (effectiveCode !== 0) {
      const modelNote = session.model ? ` The selected model was "${session.model}".` : "";
      const suggestion = failureKind === "model_not_found" ? modelSuggestion(failureTexts) : "";
      addMessage(
        session,
        "system",
        failureKind === "provider_quota"
          ? `Provider quota or rate limit reached — no work was performed.${retryHint(failureTexts) ? ` ${retryHint(failureTexts)}.` : ""} Your task is kept; nothing in the project was changed. Retry later or switch agents.`
          : failureKind === "model_not_found"
            ? `The agent rejected the selected model — no work was performed.${modelNote}${suggestion ? ` ${suggestion}` : ""} Pick a different model with Change model, or clear it to use the agent's configured default, then send a follow-up. Nothing in the project was changed; your task is kept.`
            : failureKind === "provider_unavailable"
              ? `The agent reported that its provider is unavailable — no work was performed.${modelNote} Check this CLI's own provider setup (Agents page); ADE does not manage provider credentials. Nothing in the project was changed.`
              : failureKind === "auth_expired"
                ? `The agent's sign-in or credentials were refused — no work was performed. Re-authenticate with this CLI's own sign-in flow from the Agents page, then retry. Nothing in the project was changed; your task is kept.`
                : failureKind === "context_overflow"
                  ? `The conversation exceeded the model's context window and the turn stopped. Shorten or summarize your follow-up (or start a fresh session for a narrower task); a larger-context model may also help — use Change model. Any project edits made before the failure were left in place.`
                  : acpTurn
                    ? `${meta.name} did not finish this turn; its own error is shown above and in Logs. Any project edits it made before stopping are kept. Your task is kept — retry, switch model, or switch agents.`
                    : turnFailed
                      ? `The agent reported that this turn failed and produced no result; nothing was applied. The CLI's own error is shown above and in Logs. Your task is kept — retry, switch model, or switch agents.`
                      : `Agent process exited with ${signal ?? `code ${code}`}. Existing project changes were left in place. See Logs for details.`,
      );
    }
    session.summary = session.messages.filter((m) => m.role === "agent").at(-1)?.text;
    session.updatedAt = now();
    session.changes = flagBaseline((await getDiff(project)).changes);
    session.checks = [
      {
        name: "Project checks",
        status: "not_run",
        detail: "ADE did not run checks automatically.",
      },
    ];
    await save();
  });
  await save();
}
function stopChild(child) {
  const pid = typeof child === "number" ? child : child?.pid;
  if (!pid) return;
  try {
    if (process.platform !== "win32") process.kill(-pid, "SIGTERM");
    else if (killTree(pid)) return;
    else if (typeof child === "number") process.kill(pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    try {
      if (typeof child === "number") process.kill(pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch {}
  }
}
/**
 * Claim a session's single CLI-turn slot. The check-and-set is synchronous
 * by contract: no await may sit between a children.has() check and
 * claimTurn(), which is what makes "check then spawn" atomic — a close
 * handler draining the queue can never double-spawn against a route.
 * The placeholder holds the slot from the claim until the real child is
 * registered (or the turn is abandoned).
 */
function claimTurn(session) {
  if (children.has(session.id)) return false;
  children.set(session.id, { placeholder: true });
  return true;
}
function releaseTurn(session) {
  if (children.get(session.id)?.placeholder) children.delete(session.id);
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
async function packageManager(project, pkg = {}) {
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
export async function executeChecks(session) {
  // Claim the verifying state before the first await: a /stop handled while
  // checksFor yields must not be overwritten by this loop afterwards.
  session.status = "verifying";
  session.checksCancelled = false;
  const project = state.projects.find((p) => p.id === session.projectId);
  if (!project) {
    // Defensive: the route only admits ready sessions, so restore that state
    // rather than wedging the session in verifying with no loop running.
    session.status = "ready";
    return;
  }
  const checks = await checksFor(project);
  // Re-check immediately after the yield: if /stop (or completion) landed
  // while checksFor was reading, abandon before touching any check state.
  if (session.status !== "verifying" || session.checksCancelled) {
    session.updatedAt = now();
    if (session.steerNow && !["stopped", "complete"].includes(session.status)) {
      const prompt = session.steerNow;
      delete session.steerNow;
      if (!claimTurn(session)) {
        (session.queuedMessages ??= []).push(prompt);
        await save();
        return;
      }
      session.status = "working";
      await save();
      runAgent(session, prompt, true, []);
      return;
    }
    await save();
    return;
  }
  session.checks = checks.filter((check) => !check.script);
  const pkg = JSON.parse(
    await fs.readFile(path.join(project.path, "package.json"), "utf8").catch(() => "{}"),
  );
  const manager = await packageManager(project, pkg);
  for (const check of checks.filter((item) => item.script)) {
    // Checks have no tracked child to kill, so cancellation is a flag tested
    // between steps: /stop must not be overwritten by this loop finishing.
    if (session.checksCancelled || ["stopped", "complete"].includes(session.status)) break;
    const actualCmd = `${manager} run ${check.script}`;
    const r = await run(manager, ["run", check.script], { cwd: project.path, timeout: 120000 });
    const output = (r.stdout + r.stderr).trim().slice(-4000);
    session.checks.push({
      name: check.name,
      status: r.code === 0 ? "passed" : "failed",
      detail: `${actualCmd} · exit ${r.code}\n${output}`,
    });
    session.logs.push(`$ ${actualCmd}\n${output}`);
    await save();
  }
  session.updatedAt = now();
  // Never write over a stopped or completed session, whatever the loop did.
  if (session.checksCancelled || ["stopped", "complete"].includes(session.status)) {
    if (session.steerNow && !["stopped", "complete"].includes(session.status)) {
      const prompt = session.steerNow;
      delete session.steerNow;
      if (!claimTurn(session)) {
        (session.queuedMessages ??= []).push(prompt);
        await save();
        return;
      }
      session.status = "working";
      await save();
      runAgent(session, prompt, true, []);
      return;
    }
    await save();
    return;
  }
  if (session.steerNow) {
    const prompt = session.steerNow;
    delete session.steerNow;
    if (!claimTurn(session)) {
      (session.queuedMessages ??= []).push(prompt);
      await save();
      return;
    }
    session.status = "working";
    await save();
    runAgent(session, prompt, true, []);
    return;
  }
  const queue = session.queuedMessages ?? [];
  if (children.has(session.id)) {
    // A turn is (still) live: report what is actually true instead of
    // claiming ready; its close handler owns the queue.
    session.status = "working";
    await save();
    return;
  }
  if (queue.length) {
    // Drain follow-ups that arrived during verifying: claim the turn slot
    // synchronously before the await, so a second /messages queues instead
    // of racing this drain with another spawn.
    claimTurn(session);
    session.queuedMessages = [];
    session.status = "working";
    await save();
    runAgent(session, queue.join("\n\n"), true, []);
    return;
  }
  // verifying -> ready only when no child is running.
  session.status = "ready";
  await save();
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

async function body(req) {
  const url = new URL(req.url, "http://127.0.0.1");
  const attachmentUpload = req.method === "POST" && isAttachmentUploadPath(url.pathname);
  const limit = attachmentUpload ? 14 * 1024 * 1024 : 1_000_000;
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error("Request too large");
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
function isPrivateIpAddress(address) {
  if (!address) return false;
  const normalized = address
    .toLowerCase()
    .replace(/^::ffff:/, "")
    .replace(/%.*$/, "");
  return (
    /^10(?:\.\d{1,3}){3}$/.test(normalized) ||
    /^192\.168(?:\.\d{1,3}){2}$/.test(normalized) ||
    /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(normalized) ||
    /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}$/.test(normalized) ||
    /^(?:fc|fd)[0-9a-f]{2}:/.test(normalized) ||
    /^fe[89ab][0-9a-f]:/.test(normalized)
  );
}
const hostnameOf = (hostHeader) =>
  hostHeader ? new URL(`http://${hostHeader}`).hostname.toLowerCase().replace(/^\[|\]$/g, "") : "";
function isTrustedLocalOrLanPeer(req) {
  const host = hostnameOf(req.headers.host);
  const remote = req.socket?.remoteAddress;
  if (new Set(["127.0.0.1", "localhost", "::1"]).has(host))
    return isLoopbackAddress(remote) && originAllowed(req);
  if (
    !EXPOSE_HOST() &&
    !EXPOSE_TOKEN() &&
    isPrivateIpAddress(host) &&
    (isLoopbackAddress(remote) || isPrivateIpAddress(remote))
  )
    return originAllowed(req);
  return false;
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
function localRequest(req) {
  const host = hostnameOf(req.headers.host);
  // Loopback peers (the UI on this machine, agent CLIs, dev-control curls)
  // and direct private-LAN peers (when no explicit ADE_HOST/ADE_TOKEN gate is
  // configured) keep same-origin Origin checks.
  if (isTrustedLocalOrLanPeer(req)) return true;
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
async function handle(req, res) {
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
  if ((["terminal", "editor"].includes(parts[0]) || harnessRoute) && !isTrustedLocalOrLanPeer(req))
    return json(res, 403, { error: "Host tools are available only on this machine." });
  // Remember the real base URL of this serving instance for the agent-facing
  // dev-control curls. Only LOCAL requests count (the agent CLIs run on this
  // machine), and only with loopback Host names — a LAN browser polling
  // bootstrap must not poison manifests with an authority that would require
  // the token, and the exempt POST /api/auth path must not either (its peer
  // is by definition not yet authorized; a forged loopback Host header on a
  // remote peer fails localRequest's peer check).
  if (localRequest(req) && req.headers.host) {
    const reqHost = hostnameOf(req.headers.host);
    if (["127.0.0.1", "localhost", "::1"].includes(reqHost)) {
      lastApiBaseUrl = `http://${req.headers.host}`;
      lastApiHeaders = {
        host: req.headers.host,
        "x-forwarded-proto": req.headers["x-forwarded-proto"],
        "x-forwarded-host": req.headers["x-forwarded-host"],
      };
    } else if (isTrustedLocalOrLanPeer(req)) {
      if (!lastApiBaseUrl) {
        const reqPort = new URL(`http://${req.headers.host}`).port;
        lastApiBaseUrl = `http://127.0.0.1${reqPort ? `:${reqPort}` : ""}`;
      }
      lastApiHeaders = {
        host: req.headers.host,
        "x-forwarded-proto": req.headers["x-forwarded-proto"],
        "x-forwarded-host": req.headers["x-forwarded-host"],
      };
    }
  }
  try {
    if (parts[0] === "terminal") {
      const terminal = await import("./terminal.mjs");
      if (req.method === "POST" && parts.length === 1) {
        const data = await body(req);
        const project = state.projects.find((item) => item.id === data.projectId);
        if (!project) return json(res, 404, { error: "Select an existing project first." });
        const size = terminal.terminalSize(data.cols, data.rows);
        if (!size) return json(res, 400, { error: "Invalid terminal dimensions." });
        let cwd;
        try {
          cwd = await fs.realpath(project.path);
          if (!(await fs.stat(cwd)).isDirectory()) throw new Error("Not a directory");
        } catch {
          return json(res, 400, { error: "The project folder is unavailable." });
        }
        try {
          return json(res, 201, terminal.openTerminal(cwd, size));
        } catch (error) {
          return json(res, 503, { error: error.message });
        }
      }
      if (parts.length === 2 && req.method === "GET") {
        const cursor = Number(url.searchParams.get("cursor") ?? "0");
        if (!Number.isInteger(cursor) || cursor < 0)
          return json(res, 400, { error: "Invalid output cursor." });
        const waitParam = url.searchParams.get("wait");
        const waitMs = waitParam == null || waitParam === "" ? 0 : Number(waitParam);
        if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 10_000)
          return json(res, 400, { error: "Invalid output wait." });
        const output = await terminal.readTerminal(
          parts[1],
          cursor,
          waitMs,
          terminalWaitSignal(req, res),
        );
        return output
          ? json(res, 200, output)
          : json(res, 404, { error: "Terminal session ended." });
      }
      if (parts.length === 3 && req.method === "POST") {
        const data = await body(req);
        if (parts[2] === "input") {
          if (typeof data.data !== "string" || !data.data.length || data.data.length > 8192)
            return json(res, 400, { error: "Invalid terminal input." });
          return terminal.writeTerminal(parts[1], data.data)
            ? json(res, 200, { ok: true })
            : json(res, 404, { error: "Terminal session ended." });
        }
        if (parts[2] === "resize") {
          const size = terminal.terminalSize(data.cols, data.rows);
          if (!size) return json(res, 400, { error: "Invalid terminal dimensions." });
          return terminal.resizeTerminal(parts[1], size)
            ? json(res, 200, { ok: true })
            : json(res, 404, { error: "Terminal session ended." });
        }
        if (parts[2] === "close")
          return terminal.closeTerminal(parts[1])
            ? json(res, 200, { ok: true })
            : json(res, 404, { error: "Terminal session ended." });
      }
      return json(res, 404, { error: "Not found." });
    }
    if (parts[0] === "editor") {
      const editor = await import("./editor.mjs");
      const project = state.projects.find((item) => item.id === parts[1]);
      if (!project) return json(res, 404, { error: "Select an existing project first." });
      try {
        if (parts.length === 3 && req.method === "GET" && parts[2] === "entries")
          return json(res, 200, {
            entries: await editor.listEditorEntries(
              project.path,
              url.searchParams.get("path") ?? "",
            ),
          });
        if (parts.length === 3 && req.method === "GET" && parts[2] === "search")
          return json(res, 200, {
            entries: await editor.searchEditorFiles(project.path, url.searchParams.get("q") ?? ""),
          });
        if (parts.length === 3 && req.method === "GET" && parts[2] === "file")
          return json(
            res,
            200,
            await editor.readEditorFile(project.path, url.searchParams.get("path") ?? ""),
          );
        if (parts.length === 3 && req.method === "GET" && parts[2] === "documents")
          return json(res, 200, { documents: await editor.listDocuments(project.path) });
        if (parts.length === 3 && req.method === "POST" && parts[2] === "file") {
          const data = await body(req);
          return json(
            res,
            200,
            await editor.writeEditorFile(project.path, data.path, data.content, data.version),
          );
        }
        if (parts.length === 3 && req.method === "POST" && parts[2] === "create") {
          const data = await body(req);
          return json(res, 201, await editor.createEditorFile(project.path, data.path));
        }
        if (parts.length === 3 && req.method === "POST" && parts[2] === "delete") {
          const data = await body(req);
          return json(res, 200, await editor.deleteEditorFile(project.path, data.path));
        }
      } catch (error) {
        if (error instanceof editor.EditorError)
          return json(res, error.status, { error: error.message });
        throw error;
      }
      return json(res, 404, { error: "Not found." });
    }
    // Token exchange for exposed mode: browsers POST the token once and get an
    // HttpOnly cookie; scripts use `Authorization: Bearer` directly. Loopback
    // callers can also use this route (no-op there).
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
    if (req.method === "GET" && parts[0] === "bootstrap") {
      await reconcileWorkspaceMessages(DATA_FILE, state);
      const agents = await bootstrapAgents();
      // Return the persisted workspace snapshot immediately. Git inspection,
      // diffs, and dev-script re-scan update the next 2-second poll instead
      // of holding the project list behind subprocesses.
      json(res, 200, {
        projects: state.projects.map(safeProject),
        sessions: state.sessions,
        processes: state.processes,
        agents,
        now: now(),
      });
      refreshBootstrapInBackground();
      return;
    }
    if (req.method === "GET" && parts[0] === "browse") {
      // Read-only directory listing for ADE's built-in folder picker. Same
      // loopback/origin guards as every other route; never exposes file
      // contents, only directory names one level at a time.
      const query = new URL(req.url, "http://127.0.0.1").searchParams;
      const requested = query.get("path") || os.homedir();
      const expanded = requested.startsWith("~")
        ? path.join(os.homedir(), requested.slice(1))
        : path.resolve(requested);
      let real;
      try {
        real = await fs.realpath(expanded);
      } catch {
        return json(res, 400, { error: "That path does not exist." });
      }
      const stat = await fs.stat(real);
      if (!stat.isDirectory()) return json(res, 400, { error: "That path is not a directory." });
      const showHidden = query.get("hidden") === "1";
      const dirents = await fs.readdir(real, { withFileTypes: true });
      const dirs = dirents
        .filter((entry) => entry.isDirectory() && (showHidden || !entry.name.startsWith(".")))
        .map((entry) => ({ name: entry.name, path: path.join(real, entry.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const parent = path.dirname(real);
      return json(res, 200, {
        path: real,
        parent: parent === real ? null : parent,
        dirs,
      });
    }
    if (req.method === "GET" && parts[0] === "pick-folder") {
      const choices =
        process.platform === "darwin"
          ? [["osascript", ["-e", "POSIX path of (choose folder)"]]]
          : process.platform === "win32"
            ? [
                [
                  "powershell",
                  [
                    "-NoProfile",
                    "-Command",
                    "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; if($d.ShowDialog() -eq 'OK'){$d.SelectedPath}",
                  ],
                ],
              ]
            : [
                [
                  "zenity",
                  ["--file-selection", "--directory", "--title=Choose a project folder for ADE"],
                ],
                ["kdialog", ["--getexistingdirectory", os.homedir()]],
              ];
      for (const [bin, args] of choices) {
        const picked = await run(bin, args, { timeout: 120000 });
        if (picked.code === 0 && picked.stdout.trim())
          return json(res, 200, { path: picked.stdout.trim() });
        if (process.platform !== "linux") break;
      }
      return json(res, 501, {
        error:
          "No supported native folder picker was found. Enter the absolute local folder path instead.",
      });
    }
    if (req.method === "POST" && parts[0] === "projects" && parts.length === 1) {
      const data = await body(req);
      const requested = String(data.path ?? "").trim();
      if (!requested) return json(res, 400, { error: "Choose a local folder path." });
      const expanded = requested.startsWith("~")
        ? path.join(os.homedir(), requested.slice(1))
        : path.resolve(requested);
      const real = await fs.realpath(expanded);
      const stat = await fs.stat(real);
      if (!stat.isDirectory()) return json(res, 400, { error: "That path is not a directory." });
      if (state.projects.some((p) => p.path === real))
        return json(res, 409, { error: "This project is already added." });
      const project = {
        id: id(),
        name: String(data.name || path.basename(real)),
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
    if (req.method === "POST" && parts[0] === "projects" && parts[2] === "default-agent") {
      const project = state.projects.find((p) => p.id === parts[1]);
      const data = await body(req);
      if (!project || !Object.hasOwn(adapters, String(data.agentId)))
        return json(res, 400, { error: "Choose a supported agent and project." });
      project.defaultAgent = data.agentId;
      await save();
      return json(res, 200, project);
    }
    if (req.method === "POST" && parts[0] === "projects" && parts[2] === "remove") {
      const idx = state.projects.findIndex((p) => p.id === parts[1]);
      if (idx === -1) return json(res, 404, { error: "Project not found." });
      const busy =
        state.sessions.some((s) => s.projectId === parts[1] && children.has(s.id)) ||
        state.processes.some((x) => x.projectId === parts[1] && children.has(x.id));
      if (busy)
        return json(res, 409, {
          error: "Stop the running agent or dev process before removing this project.",
        });
      for (const p of state.processes.filter((x) => x.projectId === parts[1]))
        stopChild(children.get(p.id));
      // The project's browser and its stored profile are ADE metadata too.
      await computers.stop(parts[1]).catch(() => {});
      await controls.delete(parts[1]);
      await browserContexts.clearProfile(parts[1]).catch(() => {});
      state.projects.splice(idx, 1);
      state.sessions = state.sessions.filter((s) => s.projectId !== parts[1]);
      state.processes = state.processes.filter((x) => x.projectId !== parts[1]);
      await save();
      return json(res, 200, {
        removed: parts[1],
        note: "Only ADE metadata was removed. The project folder and its files were not touched.",
      });
    }
    if (req.method === "GET" && parts[0] === "projects" && parts[2] === "diff") {
      const project = state.projects.find((p) => p.id === parts[1]);
      if (!project) return json(res, 404, { error: "Project not found." });
      return json(res, 200, await getDiff(project));
    }
    if (req.method === "GET" && parts[0] === "projects" && parts[2] === "checks") {
      const project = state.projects.find((p) => p.id === parts[1]);
      if (!project) return json(res, 404, { error: "Project not found." });
      return json(res, 200, { checks: await checksFor(project) });
    }
    if (req.method === "POST" && parts[0] === "attachments" && parts.length === 1) {
      try {
        const data = await body(req);
        const bytes = decodeBase64(data.contentBase64);
        const meta = await saveAttachment(DATA_DIR, {
          name: data.name,
          mime: data.mime,
          bytes,
        });
        return json(res, 201, meta);
      } catch (error) {
        if (error?.status) return json(res, error.status, { error: error.message });
        throw error;
      }
    }
    if (req.method === "GET" && parts[0] === "attachments" && parts.length === 2) {
      try {
        const meta = await readAttachment(DATA_DIR, parts[1]);
        res.statusCode = 200;
        res.setHeader("content-type", meta.mime || "application/octet-stream");
        res.setHeader("cache-control", "private, max-age=3600");
        res.setHeader("content-disposition", `inline; filename="${encodeURIComponent(meta.name)}"`);
        return res.end(meta.bytes);
      } catch (error) {
        if (error?.status) return json(res, error.status, { error: error.message });
        throw error;
      }
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts.length === 1) {
      const data = await body(req);
      // Sanitize the optional model before anything else so a malformed id is
      // refused with an honest 400 without ever spawning a CLI.
      const model = String(data.model ?? "").trim();
      if (model && !MODEL_ID.test(model))
        return json(res, 400, {
          error:
            "Model ids must start with a letter or digit and may then contain letters, digits, and . _ / : [ ] - + (max 256 characters), so they can never read as a CLI flag. Nothing was started.",
        });
      const project = state.projects.find((p) => p.id === data.projectId);
      const agent = state.agents.find((a) => a.id === data.agentId);
      if (!project || !agent) return json(res, 400, { error: "Select a valid project and agent." });
      const optionCheck = await resolveSessionOptions(agent.id, model || undefined, {
        effort: data.effort,
        speed: data.speed,
        permission: data.permission,
      });
      if (!optionCheck.ok) return json(res, 400, { error: optionCheck.error });
      if (!agent.installed || !agent.signedIn)
        return json(res, 400, {
          error: `${agent.name} must be installed and authenticated using its supported sign-in flow first.`,
        });
      const request = String(data.request ?? "").trim();
      if (request.length < 4)
        return json(res, 400, { error: "Describe the task in at least four characters." });
      if (UNSUPPORTED_RISK.test(`${request} ${data.criteria ?? ""}`))
        return json(res, 403, {
          error:
            "This request appears to require a destructive or external action. ADE cannot mediate this CLI's per-action approval flow yet, so it will not start it. Use the agent CLI directly after reviewing the action's scope.",
        });
      await projectInfo(project);
      if (project.missing)
        return json(res, 409, {
          error: `The folder ${project.path} no longer exists on disk. Remove the project from ADE (Remove button) and re-add it.`,
        });
      // Uncommitted work does not block a task: ADE records it as the
      // baseline, tells the agent to preserve it, and flags those files as
      // pre-existing in the diff view so the user can tell their edits from
      // the agent's.
      const baseline = project.uncommittedFiles.length ? await getDiff(project) : null;
      if (
        state.sessions.some(
          (s) => s.projectId === project.id && ["working", "verifying"].includes(s.status),
        )
      )
        return json(res, 409, {
          error:
            "Another agent task is still running in this project. Wait until it stops before starting another.",
        });
      const attachmentIds = Array.isArray(data.attachmentIds) ? data.attachmentIds : [];
      let files = [];
      try {
        files = attachmentIds.length ? await resolveAttachments(DATA_DIR, attachmentIds) : [];
      } catch (error) {
        if (error?.status) return json(res, error.status, { error: error.message });
        throw error;
      }
      const userVisibleText =
        request + (data.criteria ? `\n\nAcceptance criteria: ${data.criteria}` : "");
      const prompt = `${userVisibleText}${formatAttachmentPrompt(files)}`;
      const s = {
        id: id(),
        projectId: project.id,
        agentId: agent.id,
        createdBy: agent.id,
        request,
        criteria: String(data.criteria ?? ""),
        status: "working",
        messages: [
          {
            id: id(),
            role: "user",
            text: userVisibleText,
            at: now(),
            ...attachmentMeta(files),
          },
        ],
        changes: baseline ? baseline.changes.map((c) => ({ ...c, preExisting: true })) : [],
        ...(baseline ? { baselineFiles: baseline.files.map((f) => f.path) } : {}),
        checks: [{ name: "Project checks", status: "not_run", detail: "Not run yet." }],
        logs: [],
        createdAt: now(),
        updatedAt: now(),
        queuedMessages: [],
        ...(model ? { model } : {}),
        ...optionCheck.value,
      };
      state.sessions.unshift(s);
      // Hold the single-turn slot across the awaits inside runAgent so an
      // immediate follow-up queues instead of spawning a second CLI.
      claimTurn(s);
      await save();
      runAgent(s, prompt, false, adapterAttachments(files));
      return json(res, 201, s);
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "messages") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      if (!s) return json(res, 404, { error: "Session not found." });
      const data = await body(req);
      const when = ["now", "later", "drop", "release"].includes(data.when) ? data.when : undefined;
      if (when === "drop" || when === "release") {
        if (s.status === "complete")
          return json(res, 409, { error: "Reopen this session before sending a message." });
        if (when === "drop") {
          const waiting = (s.queuedMessages ?? []).length;
          s.queuedMessages = [];
          if (waiting) addMessage(s, "system", "The waiting message will not be sent.");
          await save();
          return json(res, 200, s);
        }
        const waiting = [...(s.queuedMessages ?? [])];
        if (!waiting.length)
          return json(res, 400, { error: "There is no waiting message to send." });
        s.queuedMessages = [];
        const queuedPrompt = waiting.join("\n\n");
        if (children.has(s.id) || s.status === "verifying") {
          s.steerNow = queuedPrompt;
          s.status = "working";
          s.checksCancelled = true;
          const child = children.get(s.id);
          if (child) stopChild(child);
          addLog(s, "Switching to your message.");
          await save();
          return json(res, 200, s);
        }
        addLog(s, "Sending the waiting message.");
        s.status = "working";
        const claimed = claimTurn(s);
        await save();
        if (claimed) runAgent(s, queuedPrompt, true, []);
        return json(res, 200, s);
      }
      const text = String(data.text ?? "").trim();
      if (!text) return json(res, 400, { error: "Message cannot be empty." });
      if (UNSUPPORTED_RISK.test(text))
        return json(res, 403, {
          error:
            "ADE cannot mediate this destructive or external action's approval flow yet; the message was not sent.",
        });
      if (s.status === "complete")
        return json(res, 409, { error: "Reopen this session before sending a message." });
      const attachmentIds = Array.isArray(data.attachmentIds) ? data.attachmentIds : [];
      let files = [];
      try {
        files = attachmentIds.length ? await resolveAttachments(DATA_DIR, attachmentIds) : [];
      } catch (error) {
        if (error?.status) return json(res, error.status, { error: error.message });
        throw error;
      }
      const userVisibleText = text;
      const prompt = `${userVisibleText}${formatAttachmentPrompt(files)}`;
      const msgExtra = attachmentMeta(files);
      // Follow-ups stay non-blocking: the user may keep editing between
      // turns. runAgent re-reads the working tree at the start of each turn
      // and refreshes the preserved-changes baseline, so the agent always
      // sees current reality. Checks spawn no tracked child, so "verifying"
      // must queue here too instead of racing the checks run while the
      // header still says verifying. "now" stops the current step and runs
      // this message as soon as that process exits.
      if ((children.has(s.id) || s.status === "verifying") && when === "now") {
        addMessage(s, "user", userVisibleText, msgExtra);
        s.steerNow = prompt;
        s.status = "working";
        s.checksCancelled = true;
        const child = children.get(s.id);
        if (child) stopChild(child);
        addLog(s, "Switching to your message.");
        await save();
        return json(res, 200, s);
      }
      if (children.has(s.id) || s.status === "verifying") {
        // v1: native CLI flags apply only to the immediately spawned turn; queued
        // follow-ups rely on the path appendix baked into the queued text.
        (s.queuedMessages ??= []).push(prompt);
        addMessage(s, "user", userVisibleText, msgExtra);
        addLog(s, "Follow-up queued until the current CLI turn exits.");
        await save();
        return json(res, 200, s);
      }
      addMessage(s, "user", userVisibleText, msgExtra);
      s.status = "working";
      // Claim the turn slot synchronously: nothing awaits between the
      // children.has() check above and this registration, so a close handler
      // draining the queue can never double-spawn against this handler.
      const claimed = claimTurn(s);
      if (claimed) s.queuedMessages = [];
      await save();
      if (claimed) runAgent(s, prompt, true, adapterAttachments(files));
      return json(res, 200, s);
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "switch-agent") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      if (!s) return json(res, 404, { error: "Session not found." });
      const data = await body(req);
      const target = state.agents.find((a) => a.id === data.agentId);
      const project = state.projects.find((p) => p.id === s.projectId);
      if (!target?.installed || !target.signedIn)
        return json(res, 400, {
          error: `${target?.name ?? data.agentId} must be installed and authenticated before switching.`,
        });
      if (!project) return json(res, 404, { error: "Project not found." });
      if (children.has(s.id))
        return json(res, 409, {
          error: "Stop or wait for the current CLI turn to finish before switching agents.",
        });
      if (s.status === "complete")
        return json(res, 409, { error: "Reopen this session before switching agents." });
      await projectInfo(project);
      const from = state.agents.find((a) => a.id === s.agentId);
      s.createdBy = s.agentId;
      s.agentId = target.id;
      s.agentSessionId = undefined;
      delete s.acpDefaultModel;
      // Model ids belong to one CLI's catalog; never transplant them across
      // agents. The new CLI starts on its own configured default. Effort and
      // speed are model-scoped too: a level valid for the old CLI (e.g. Pi's
      // "high") can map to a flag the new CLI rejects outright, so they go
      // with the model rather than breaking the next turn.
      const droppedModel = s.model;
      const droppedEffort = s.effort;
      const droppedSpeed = s.speed;
      delete s.model;
      delete s.effort;
      delete s.speed;
      const carriesConversation = false;
      addMessage(
        s,
        "system",
        `Switched from ${from?.name ?? s.agentId} to ${target.name}. The new CLI starts fresh: repository state, the task, and the current diff carry over, but the prior conversation does not.` +
          (droppedModel
            ? ` The selected model (${droppedModel}) belonged to the previous agent and was dropped; ${target.name} starts with its own configured default.`
            : " The model resets to the new agent's configured default.") +
          (droppedEffort || droppedSpeed
            ? ` Its model settings (${[droppedEffort && `effort ${droppedEffort}`, droppedSpeed && `speed ${droppedSpeed}`].filter(Boolean).join(", ")}) were cleared too, because they are tied to the previous agent's model.`
            : ""),
      );
      addLog(
        s,
        `agent switch: ${from?.short ?? s.agentId} → ${target.short} (conversation not carried)`,
      );
      s.status = "working";
      await save();
      runAgent(
        s,
        `A different coding agent worked on this task before you. Review the current repository state and continue or finish the task. Original request: ${s.request}${s.criteria ? `\nAcceptance criteria: ${s.criteria}` : ""}`,
      );
      return json(res, 200, { ...s, carriesConversation });
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "stop") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      if (!s) return json(res, 404, { error: "Session not found." });
      const alreadyStopped = s.status === "stopped";
      s.status = "stopped";
      // A stop cancels an in-flight "send now" so the exit does not restart work.
      delete s.steerNow;
      // Checks have no child to kill: flag cancellation so executeChecks
      // stops at the next step boundary instead of overwriting this state
      // with "ready" when the loop ends.
      s.checksCancelled = true;
      dropPermissions(s);
      const child = children.get(s.id);
      stopChild(child ?? s.pid);
      addLog(s, "Stopped by user. Existing worktree changes are kept.");
      if (!alreadyStopped)
        addMessage(
          s,
          "system",
          "Stopped. Files are kept. Send a message when you want it to continue.",
        );
      await save();
      return json(res, 200, s);
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "permission") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      if (!s) return json(res, 404, { error: "Session not found." });
      const data = await body(req);
      const request = (s.pendingPermissions ?? []).find((p) => p.id === data.requestId);
      const resolve = request && permissionWaiters.get(request.id);
      if (!resolve)
        return json(res, 409, { error: "The agent is no longer waiting for this answer." });
      // Only an option the agent itself offered; ADE never invents one.
      const option = request.options.find((o) => o.optionId === data.optionId);
      if (!option) return json(res, 400, { error: "Choose one of the options the agent offered." });
      s.pendingPermissions = s.pendingPermissions.filter((p) => p !== request);
      if (!s.pendingPermissions.length) delete s.pendingPermissions;
      permissionWaiters.delete(request.id);
      resolve({ outcome: "selected", optionId: option.optionId });
      addLog(
        s,
        JSON.stringify({
          type: "permission",
          decision: option.kind.startsWith("allow") ? "allowed" : "rejected",
          title: request.title,
          option: option.name,
        }),
      );
      await save();
      return json(res, 200, s);
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "complete") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      if (!s || !["ready", "blocked", "stopped"].includes(s.status))
        return json(res, 409, {
          error: "Wait for the agent to stop before completing this session.",
        });
      // A "ready" that lies (a live child still running) must not complete.
      if (children.has(s.id))
        return json(res, 409, {
          error: "The agent is still running. Wait for it to stop before completing this session.",
        });
      s.status = "complete";
      s.completedAt = now();
      await save();
      return json(res, 200, s);
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "reopen") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      if (!s) return json(res, 404, { error: "Session not found." });
      s.status = "ready";
      s.completedAt = undefined;
      await save();
      return json(res, 200, s);
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "checks") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      if (!s) return json(res, 404, { error: "Session not found." });
      if (children.has(s.id))
        return json(res, 409, { error: "Stop or wait for the agent before running checks." });
      // Mirrors the UI contract: checks run only on a session that is
      // actually ready to review; verifying/stopped/complete must not race.
      if (s.status !== "ready")
        return json(res, 409, {
          error: `Checks run only when the session is ready to review; this session is "${s.status}".`,
        });
      await executeChecks(s);
      return json(res, 200, s);
    }
    if (req.method === "GET" && parts[0] === "sessions" && parts[2] === "diff") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      const p = state.projects.find((x) => x.id === s?.projectId);
      if (!p) return json(res, 404, { error: "Session not found." });
      return json(res, 200, await getDiff(p));
    }
    // ---- Agent computer: each project's headless Chrome (see computer.mjs) ----
    if (parts[0] === "projects" && parts[2] === "computer") {
      const project = state.projects.find((x) => x.id === parts[1]);
      if (!project) return json(res, 404, { error: "Project not found." });
      if (req.method === "GET" && parts.length === 3) return json(res, 200, computerView(project));
      if (req.method === "POST" && parts[3] === "start") {
        // Returns at once; the UI polls status through installing/starting.
        computers.start(project.id).catch(() => {});
        return json(res, 202, computerView(project));
      }
      if (req.method === "POST" && parts[3] === "stop") {
        await computers.stop(project.id);
        // The control lock belonged to the browser that just closed.
        await controls.delete(project.id);
        return json(res, 200, computerView(project));
      }
      if (req.method === "POST" && (parts[3] === "profile" || parts[3] === "clear")) {
        // Switch between the project's persistent profile and a throwaway incognito context,
        // or delete the persistent profile's cookies, storage and cache. Both restart the
        // browser if it was running.
        const input = parts[3] === "profile" ? await body(req) : {};
        const profile = input.profile === INCOGNITO_PROFILE_ID ? INCOGNITO_PROFILE_ID : "default";
        const changing = parts[3] === "clear" || (project.browserProfile ?? "default") !== profile;
        if (changing) {
          const wasRunning = computers.status(project.id).status === "running";
          await computers.stop(project.id);
          await controls.delete(project.id);
          if (parts[3] === "clear") await browserContexts.clearProfile(project.id);
          else {
            if (profile === "default") delete project.browserProfile;
            else project.browserProfile = profile;
            await save();
          }
          if (wasRunning) computers.start(project.id).catch(() => {});
        }
        return json(res, 200, computerView(project));
      }
      if (req.method === "POST" && parts[3] === "action") {
        // Agent tools (MCP server / Pi extension): starts the browser on first use, then runs
        // one screenshot/mouse/keyboard action on its page.
        try {
          const input = await body(req);
          const control = controls.for(project.id);
          const run = () => computers.action(project.id, input);
          const { status, payload } = OBSERVE_COMPUTER_ACTIONS.has(input.action)
            ? await control.observe(run)
            : await control.agent(run);
          return json(res, status, payload);
        } catch (error) {
          if (error instanceof HumanControlError)
            return json(res, 409, { error: error.message, code: error.code });
          return json(res, 503, { error: error.message });
        }
      }
      if (req.method === "POST" && parts[3] === "control") {
        // Take or hand back control of the browser; shared with the browser stream.
        const input = await body(req);
        const viewer = String(input.viewer ?? "");
        if (!viewer) return json(res, 400, { error: "viewer is required." });
        const control = controls.for(project.id);
        try {
          if (input.action === "take") return json(res, 200, control.take(viewer));
          if (input.action === "release")
            return json(
              res,
              200,
              control.release(viewer, async () => {
                // Best effort: release keys and buttons the viewer left held in the page.
                browserHub.peek(project.id)?.releaseInput();
              }),
            );
        } catch (error) {
          if (error instanceof HumanControlError)
            return json(res, 409, { error: error.message, code: error.code });
          throw error;
        }
        return json(res, 400, { error: 'action must be "take" or "release".' });
      }
      return json(res, 404, { error: "Not found." });
    }
    // ---- Agent browser preview: live view of the project's browser (see browser-page.mjs) ----
    if (parts[0] === "projects" && parts[2] === "browser") {
      const project = state.projects.find((x) => x.id === parts[1]);
      if (!project) return json(res, 404, { error: "Project not found." });
      if (req.method === "GET" && parts.length === 3) {
        const computer = computers.status(project.id);
        const { owner, generation } = controls.for(project.id).state();
        const control = { owner, generation };
        if (computer.status !== "running") {
          const reason =
            computer.status === "stopped"
              ? "The agent browser is off. Start it to watch the agent work."
              : (computer.detail ?? "The agent browser is not running yet.");
          return json(res, 200, { available: false, reason, control });
        }
        await browserStream.start();
        const streamUrl = new URL(browserStream.url(project.id));
        const reqHost = hostnameOf(req.headers.host);
        if (sharedUpgradeAttached && req.headers.host) {
          streamUrl.host = req.headers.host;
        } else if (isPrivateIpAddress(reqHost)) {
          streamUrl.hostname = reqHost;
        }
        return json(res, 200, {
          available: true,
          streamUrl: streamUrl.toString(),
          control,
        });
      }
      if (req.method === "POST" && parts[3] === "action") {
        // Agent tools (browser_* in computer-tools-defs.mjs): one Playwright action.
        const input = await body(req);
        const name = String(input.action ?? "").replace(/^browser_/, "");
        const control = controls.for(project.id);
        const run = () => browserHub.get(project.id).then((s) => s.runAgentAction(input));
        try {
          const result = OBSERVE_BROWSER_ACTIONS.has(name)
            ? await control.observe(run)
            : await control.agent(run);
          return json(res, 200, result);
        } catch (error) {
          const code = error?.code;
          return json(res, COMPUTER_ERROR_STATUS[code] ?? 500, {
            error: error?.message ?? String(error),
            ...(code ? { code } : {}),
          });
        }
      }
      if (req.method === "POST" && parts[3] === "file-chooser") {
        // The viewer in control answers the page's file picker with files it uploaded through
        // /api/attachments. No attachments closes the picker without a file.
        const input = await body(req);
        const viewer = String(input.viewer ?? "");
        const chooserId = String(input.chooserId ?? "");
        if (!viewer || !chooserId)
          return json(res, 400, { error: "viewer and chooserId are required." });
        const session = browserHub.peek(project.id);
        if (!session) return json(res, 409, { error: "The agent browser is not running." });
        try {
          const ids = Array.isArray(input.attachmentIds) ? input.attachmentIds : [];
          const files = (await resolveAttachments(DATA_DIR, ids)).map((file) => ({
            name: file.name,
            mimeType: file.mime,
            buffer: file.bytes,
          }));
          const answered = await controls
            .for(project.id)
            .human(viewer, () => session.answerFileChooser(chooserId, files));
          if (!answered)
            return json(res, 409, {
              error: "That file picker is no longer open.",
              code: "no_file_chooser",
            });
          return json(res, 200, { answered: true });
        } catch (error) {
          if (error instanceof HumanControlError)
            return json(res, 409, { error: error.message, code: error.code });
          if (error?.status) return json(res, error.status, { error: error.message });
          throw error;
        }
      }
      return json(res, 404, { error: "Not found." });
    }
    // ---- Project-scoped dev-server control (driven by the agent tools) ----
    if (req.method === "GET" && parts[0] === "projects" && parts[2] === "dev") {
      const project = state.projects.find((x) => x.id === parts[1]);
      if (!project) return json(res, 404, { error: "Project not found." });
      const proc = state.processes.find((x) => x.projectId === project.id);
      const note = project.devScriptNote ? { devScriptNote: project.devScriptNote } : {};
      if (!proc)
        return json(res, 200, {
          found: false,
          ...note,
          hint: "No dev-server record yet: POST this path + /start to re-scan package.json and start it.",
        });
      return json(res, 200, {
        found: true,
        ...devView(proc),
        ...note,
        outputTail: (proc.output ?? []).slice(-5),
      });
    }
    if (
      req.method === "POST" &&
      parts[0] === "projects" &&
      parts[2] === "dev" &&
      parts[3] === "start"
    ) {
      const project = state.projects.find((x) => x.id === parts[1]);
      if (!project) return json(res, 404, { error: "Project not found." });
      if (devStartClaims.has(project.id)) {
        const current = state.processes.find((x) => x.projectId === project.id);
        return json(res, 409, {
          error: "The dev server is already running for this project.",
          ...(current
            ? {
                ...devView(current),
                status: current.status === "running" ? "running" : "starting",
              }
            : { status: "starting", port: 0 }),
        });
      }
      devStartClaims.add(project.id);
      try {
        // Inline re-scan FIRST: a scripts.dev scaffolded earlier this same
        // turn must be detected without waiting for the next bootstrap poll.
        const { proc, changed } = await refreshDevProcess(project);
        if (changed) save().catch(() => {});
        if (!proc)
          return json(res, 404, {
            error: "No dev script for this project, even after re-scanning package.json.",
            guidance:
              'Add a proper "dev" script to package.json and call this endpoint again, or tell the user. Never start a detached background server (no nohup, &, or disown) to work around this.',
          });
        if (proc.status === "running" || proc.status === "starting")
          return json(res, 409, {
            error: "The dev server is already running for this project.",
            ...devView(proc),
          });
        await startDevServer(proc, project);
        return json(res, 200, devView(proc));
      } finally {
        devStartClaims.delete(project.id);
      }
    }
    if (
      req.method === "POST" &&
      parts[0] === "projects" &&
      parts[2] === "dev" &&
      parts[3] === "stop"
    ) {
      const project = state.projects.find((x) => x.id === parts[1]);
      if (!project) return json(res, 404, { error: "Project not found." });
      const proc = state.processes.find((x) => x.projectId === project.id);
      if (!proc)
        return json(res, 404, { error: "No dev-server record for this project; nothing to stop." });
      // PID-reuse guard: with no live child, only signal a persisted pid that
      // still matches the project's path — a recycled pid belongs to an
      // unrelated process, and killing it would be worse than a stale record.
      const child = children.get(proc.id);
      if (!child && proc.pid && !(await processMatches(proc.pid, project.path)))
        return json(res, 200, {
          ...devView(proc),
          note: "The stored pid no longer matches this project's dev process; nothing was signalled.",
        });
      // Works during "starting": the live child is in `children` and gets
      // killed; its close handler resets the port if it never listened.
      stopChild(child ?? proc.pid);
      if (proc.status !== "stopped") {
        proc.status = "stopped";
        delete proc.pid;
        proc.updatedAt = now();
        await save();
      }
      // Idempotent: stopping an already-stopped record is a 200 no-op.
      return json(res, 200, devView(proc));
    }
    if (req.method === "POST" && parts[0] === "processes" && parts[2] === "start") {
      const proc = state.processes.find((x) => x.id === parts[1]);
      const project = state.projects.find((x) => x.id === proc?.projectId);
      if (!proc || !project) return json(res, 404, { error: "Process not found." });
      // Both start routes claim per-project synchronously before the first await.
      if (devStartClaims.has(project.id))
        return json(res, 200, {
          ...proc,
          status: proc.status === "running" ? "running" : "starting",
        });
      if (proc.status === "running" || proc.status === "starting") return json(res, 200, proc);
      devStartClaims.add(project.id);
      try {
        await startDevServer(proc, project);
        return json(res, 200, proc);
      } finally {
        devStartClaims.delete(project.id);
      }
    }
    if (req.method === "POST" && parts[0] === "processes" && parts[2] === "stop") {
      const proc = state.processes.find((x) => x.id === parts[1]);
      if (!proc) return json(res, 404, { error: "Process not found." });
      // Same PID-reuse guard as dev/stop: never signal a persisted pid whose
      // cwd no longer matches the project.
      const child = children.get(proc.id);
      const project = state.projects.find((x) => x.id === proc.projectId);
      if (!child && proc.pid && !(await processMatches(proc.pid, project?.path))) {
        delete proc.pid;
        proc.status = "stopped";
        proc.updatedAt = now();
        await save();
        return json(res, 200, {
          ...proc,
          note: "The stored pid no longer matches this project's dev process; nothing was signalled.",
        });
      }
      stopChild(child ?? proc.pid);
      proc.status = "stopped";
      delete proc.pid;
      proc.updatedAt = now();
      await save();
      return json(res, 200, proc);
    }
    if (req.method === "POST" && parts[0] === "agents" && parts[2] === "login") {
      const agent = state.agents.find((a) => a.id === parts[1]);
      if (!agent?.installed) return json(res, 400, { error: "Install this CLI first." });
      if (agent.id !== "codex")
        return json(res, 400, {
          error:
            agent.id === "opencode"
              ? "OpenCode's provider chooser is interactive and has no stable non-interactive OAuth API. Run `opencode auth login` in a terminal; credentials are kept in OpenCode's user-level store."
              : agent.id === "claude"
                ? "Claude Code's sign-in opens a browser from its own CLI. Run `claude auth login` in a terminal; credentials stay in Claude Code's own store."
                : "Pi's supported sign-in is the interactive /login command inside Pi. Run `pi`, then choose /login. ADE does not collect or store provider credentials.",
        });
      const existing = authChildren.get(agent.id);
      if (existing) return json(res, 200, { output: existing.output, running: true });
      const child = spawn("codex", ["login", "--device-auth"], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
      const job = { output: "", running: true };
      authChildren.set(agent.id, job);
      const collect = (d) => {
        job.output += d.toString();
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.on("close", async (code) => {
        job.running = false;
        job.code = code;
        await agentStatus();
      });
      return json(res, 200, { output: job.output, running: true });
    }
    if (req.method === "GET" && parts[0] === "agents" && parts[2] === "login") {
      const job = authChildren.get(parts[1]);
      return json(res, 200, {
        ...(job ?? { output: "", running: false }),
        agent: state.agents.find((a) => a.id === parts[1]),
      });
    }
    if (req.method === "GET" && parts[0] === "agents" && parts[2] === "models") {
      const agentId = parts[1];
      if (!adapters[agentId])
        return json(res, 404, {
          error: `Unknown agent. Available: ${Object.keys(adapters).join(", ")}.`,
        });
      // Probes the CLI's own quota-free listing. The cache key includes the
      // CLI version reported by the bootstrap status poll so an upgraded
      // binary is never served a stale catalog.
      return json(res, 200, await listAgentModels(agentId));
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "model") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      if (!s) return json(res, 404, { error: "Session not found." });
      const data = await body(req);
      // Same sanitize as session creation. "" or null clears back to the
      // agent's own configured default (an absent field means default).
      const model = String(data.model ?? "").trim();
      if (model && !MODEL_ID.test(model))
        return json(res, 400, {
          error:
            "Model ids must start with a letter or digit and may then contain letters, digits, and . _ / : [ ] - + (max 256 characters), so they can never read as a CLI flag. Nothing was changed.",
        });
      if (s.status === "complete")
        return json(res, 409, { error: "Reopen this session before changing its model." });
      // OpenCode's proven set-override pattern: only rewrite when the value
      // actually differs; applying at the next turn is inherent because
      // runAgent reads session.model when it spawns the CLI.
      const previousModel = s.model ?? null;
      const changed = previousModel !== (model || null);
      if (changed) {
        if (model) s.model = model;
        else delete s.model;
        addMessage(
          s,
          "system",
          model
            ? `Model set to "${model}". It applies from the next CLI turn; a turn already running keeps its current model. The current conversation continues — per-CLI semantics of changing models mid-conversation are not verified; the CLI may treat context differently under the new model.`
            : `Model cleared; the next turn uses ${s.agentId}'s configured default. A turn already running keeps its current model.`,
        );
        s.updatedAt = now();
        await save();
      }
      // Accepted even while a turn runs: it takes effect on the next turn.
      // The response reports both the old and new effective values.
      return json(res, 200, { ...s, model: s.model ?? null, previousModel });
    }
    if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "options") {
      const s = state.sessions.find((x) => x.id === parts[1]);
      if (!s) return json(res, 404, { error: "Session not found." });
      const data = await body(req);
      if (s.status === "complete")
        return json(res, 409, {
          error: "Reopen this session before changing its model or options.",
        });
      const modelProvided = Object.prototype.hasOwnProperty.call(data, "model");
      let nextModel = s.model;
      if (modelProvided) {
        const model = String(data.model ?? "").trim();
        if (model && !MODEL_ID.test(model))
          return json(res, 400, {
            error:
              "Model ids must start with a letter or digit and may then contain letters, digits, and . _ / : [ ] - + (max 256 characters), so they can never read as a CLI flag. Nothing was changed.",
          });
        nextModel = model || undefined;
      }
      const cleared = new Set();
      const optionInput = {};
      for (const key of ["effort", "speed", "permission"]) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
        const raw = data[key];
        if (raw === undefined || raw === null || raw === "") cleared.add(key);
        else optionInput[key] = raw;
      }
      const optionCheck = await resolveSessionOptions(s.agentId, nextModel, optionInput);
      if (!optionCheck.ok) return json(res, 400, { error: optionCheck.error });
      const previousModel = s.model ?? null;
      let changed = false;
      if (modelProvided && previousModel !== (nextModel ?? null)) {
        if (nextModel) s.model = nextModel;
        else delete s.model;
        changed = true;
        addMessage(
          s,
          "system",
          nextModel
            ? `Model set to "${nextModel}". It applies from the next CLI turn; a turn already running keeps its current model. The current conversation continues — per-CLI semantics of changing models mid-conversation are not verified; the CLI may treat context differently under the new model.`
            : `Model cleared; the next turn uses ${s.agentId}'s configured default. A turn already running keeps its current model.`,
        );
      }
      const before = {
        effort: s.effort,
        speed: s.speed,
        permission: s.permission,
      };
      syncOptionFields(s, optionCheck.value, cleared);
      if (
        before.effort !== s.effort ||
        before.speed !== s.speed ||
        before.permission !== s.permission
      ) {
        changed = true;
        const bits = [];
        if (optionCheck.value.effort || cleared.has("effort"))
          bits.push(
            cleared.has("effort") ? "effort cleared" : `effort "${optionCheck.value.effort}"`,
          );
        if (optionCheck.value.speed || cleared.has("speed"))
          bits.push(cleared.has("speed") ? "speed cleared" : `speed "${optionCheck.value.speed}"`);
        if (optionCheck.value.permission || cleared.has("permission"))
          bits.push(
            cleared.has("permission")
              ? "permission cleared"
              : `permission "${optionCheck.value.permission}"`,
          );
        if (bits.length)
          addMessage(
            s,
            "system",
            `Options updated (${bits.join(", ")}). They apply from the next CLI turn; a turn already running keeps its current options.`,
          );
      }
      if (changed) {
        s.updatedAt = now();
        await save();
      }
      return json(res, 200, {
        ...s,
        model: s.model ?? null,
        previousModel,
      });
    }
    if (req.method === "GET" && parts[0] === "agents" && parts[2] === "capabilities") {
      const agentId = parts[1];
      if (!adapters[agentId])
        return json(res, 404, {
          error: `Unknown agent. Available: ${Object.keys(adapters).join(", ")}.`,
        });
      const modelId = url.searchParams.get("model") || undefined;
      const listed = await listAgentModels(agentId);
      const modelRow =
        modelId && listed?.available
          ? (listed.models?.find((m) => m.id === modelId) ?? { id: modelId })
          : undefined;
      return json(res, 200, optionCapabilities(agentId, modelRow));
    }
    if (
      parts[0] === "agents" &&
      parts.length === 3 &&
      (parts[2] === "install" || parts[2] === "update" || parts[2] === "harness")
    ) {
      const agentId = parts[1];
      if (!adapters[agentId] || !HARNESS[agentId])
        return json(res, 404, {
          error: `Unknown agent. Available: ${Object.keys(adapters).join(", ")}.`,
        });
      const agent = state.agents.find((a) => a.id === agentId);
      if (req.method === "GET" && parts[2] === "harness") {
        const job = harnessJobs.get(agentId);
        return json(res, 200, { ...job, agentId, kind: job.kind ?? "install" });
      }
      if (req.method !== "POST" || (parts[2] !== "install" && parts[2] !== "update"))
        return json(res, 404, { error: "Not found." });
      const kind = parts[2];
      if (
        state.sessions.some(
          (s) => s.agentId === agentId && ["working", "verifying"].includes(s.status),
        )
      )
        return json(res, 409, {
          error:
            "This agent still has a running task. Wait until it stops before installing or updating.",
        });
      const method = agent?.installMethod ?? "missing";
      if (kind === "install" && method !== "missing")
        return json(res, 409, {
          error: `${agent?.name ?? agentId} is already installed.`,
        });
      if (kind === "update" && method !== "npm") {
        if (method === "other")
          return json(res, 409, {
            error: `Installed outside npm at ${agent?.installPath ?? "unknown path"}; update it where you installed it.`,
          });
        return json(res, 409, {
          error: `${agent?.name ?? agentId} is not installed yet. Install it first.`,
        });
      }
      try {
        const job = harnessJobs.start(agentId, kind, HARNESS[agentId][kind]);
        return json(res, 200, job);
      } catch (error) {
        if (error?.code === "BUSY") return json(res, 409, { error: error.message });
        throw error;
      }
    }
    if (parts[0] === "workflows") {
      const agentIds = Object.keys(adapters);
      if (req.method === "GET" && parts.length === 1)
        return json(res, 200, { workflows: listWorkflows(state.workflows) });
      if (req.method === "POST" && parts.length === 1) {
        const data = await body(req);
        const result = upsertWorkflow(state.workflows, data, { agentIds });
        if (!result.ok) return json(res, result.status ?? 400, { error: result.error });
        state.workflows = result.stored;
        await save();
        return json(res, 201, { workflow: result.workflow });
      }
      if (req.method === "POST" && parts.length === 2) {
        const data = await body(req);
        const result = upsertWorkflow(state.workflows, data, { id: parts[1], agentIds });
        if (!result.ok) return json(res, result.status ?? 400, { error: result.error });
        state.workflows = result.stored;
        await save();
        return json(res, 200, { workflow: result.workflow });
      }
      if (req.method === "POST" && parts.length === 3 && parts[2] === "delete") {
        const result = removeWorkflow(state.workflows, parts[1]);
        if (!result.ok) return json(res, result.status ?? 400, { error: result.error });
        state.workflows = result.stored;
        await save();
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: "Not found." });
    }
    if (req.method === "GET" && parts[0] === "agents")
      return json(res, 200, { agents: await agentStatus() });
    return json(res, 404, { error: "Not found." });
  } catch (error) {
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
/** Test-only: adjust a session status without going through HTTP. */
export function _setSessionStatusForTest(sessionId, status) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (session) session.status = status;
}
await load();
// API request bodies are tiny JSON; anything larger is refused before it is
// read (an exposed instance must not let an unauthenticated peer stream an
// unbounded body into memory — content-length lies are caught by the reader).
const MAX_PAYLOAD_BYTES = 1024 * 1024;
async function boundedText(request, limit = MAX_PAYLOAD_BYTES) {
  const declared = Number(request.headers?.get?.("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) throw new Error("payload_too_large");
  if (!request.body) return await request.text();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new Error("payload_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function handleLocalApi(request) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return undefined;
  const headers = Object.fromEntries(request.headers.entries());
  let payload = "";
  const attachmentUpload = request.method === "POST" && isAttachmentUploadPath(url.pathname);
  const bodyLimit = attachmentUpload ? 14 * 1024 * 1024 : MAX_PAYLOAD_BYTES;
  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      payload = await boundedText(request, bodyLimit);
    } catch {
      return Response.json({ error: "Request body too large." }, { status: 413 });
    }
  }
  // Resolve the client address the way the runtimes actually present it. The
  // built server (nitro node preset) hands us srvx's NodeRequest: the raw
  // IncomingMessage is private, the address lives on
  // request.runtime.node.req.socket.remoteAddress (mirrored as request.ip)
  // and request.socket does NOT exist. A plain fetch Request has neither, and
  // with no provable address the request must fail closed (403).
  const remoteAddress = request.runtime?.node?.req?.socket?.remoteAddress ?? request.ip;
  const req = {
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers,
    ...(remoteAddress ? { socket: { remoteAddress } } : {}),
    signal: request.signal,
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  };
  const response = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value) {
      this.body = value ?? "";
    },
  };
  await handle(req, response);
  const outBody = response.body;
  return new Response(outBody instanceof Buffer ? outBody : (outBody ?? ""), {
    status: response.statusCode,
    headers: response.headers,
  });
}
function attachComputerUpgrades(httpServer) {
  if (!httpServer || typeof httpServer.on !== "function") return;
  sharedUpgradeAttached = true;
  if (httpServer.__adeUpgradeListener) {
    httpServer.off("upgrade", httpServer.__adeUpgradeListener);
  }
  const onUpgrade = (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/preview-stream") browserStream.handleUpgrade(req, socket, head);
  };
  httpServer.__adeUpgradeListener = onUpgrade;
  httpServer.on("upgrade", onUpgrade);
}

export function adeLocalApi() {
  return {
    name: "ade-loopback-local-api",
    configureServer(server) {
      attachComputerUpgrades(server.httpServer);
      server.middlewares.use("/api", (req, res) => {
        handle(req, res).catch((e) => json(res, 500, { error: e.message }));
      });
    },
    configurePreviewServer(server) {
      attachComputerUpgrades(server.httpServer);
      server.middlewares.use("/api", (req, res) => {
        handle(req, res).catch((e) => json(res, 500, { error: e.message }));
      });
    },
  };
}
