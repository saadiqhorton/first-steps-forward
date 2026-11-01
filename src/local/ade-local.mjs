import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { processRunsIn as processMatches } from "./spawn.mjs";
import { adapters } from "./adapters/index.mjs";
import { getDiff, projectInfo } from "./project-git.mjs";
import { createSessionTurns, shrinkLogLine, TurnRefused } from "./session-turns.mjs";
import { adeRoot, createComputerManager, SCREEN } from "./computer.mjs";
import { createBrowserHub } from "./browser-page.mjs";
import { createBrowserInstaller } from "./browser-install.mjs";
import { createBrowserContexts, INCOGNITO_PROFILE_ID } from "./browser-contexts.mjs";
import { diagnoseLaunchFailure } from "./browser-host.mjs";
import { TOOLS as COMPUTER_TOOLS } from "./computer-tools-defs.mjs";
import { createBrowserStreamServer } from "./browser-stream-server.mjs";
import { createControlRegistry } from "./browser-control.mjs";
import { saveWorkspace } from "./workspace-persistence.mjs";
import { createEventHub } from "./events.mjs";
import { createSessionLogs } from "./session-logs.mjs";
import { SourceError } from "./project-sources.mjs";
import { body, json, PayloadTooLarge } from "./http.mjs";
import { createDevServers } from "./dev-server.mjs";
import { createAgentStatus } from "./agent-status.mjs";
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

const DATA_DIR = path.join(os.homedir(), ".ade");
const DATA_FILE = path.join(DATA_DIR, "workspace.json");
const sessionLogs = createSessionLogs(path.join(DATA_DIR, "session-logs"));
const eventHub = createEventHub();
const state = { projects: [], sessions: [], processes: [], agents: [], workflows: [] };
const { children, devStartClaims, startDevServer, devServerStatus, refreshDevProcess } =
  createDevServers({ state, save });
export { refreshDevProcess };
const {
  harnessJobs,
  agentStatus,
  bootstrapAgents,
  probeAgentsIfDue,
  listAgentModels,
  resolveSessionOptions,
} = createAgentStatus({ state, dataDir: DATA_DIR, emit: (scope) => eventHub.emit(scope) });
const authChildren = new Map();
// Loopback base URL of the server this module is mounted on, recorded when it
// starts listening (see setListenAddress); null until then.
let listenBaseUrl = null;
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
      probeAgentsIfDue();
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
// In dispatch order: where two modules could match the same path, the earlier one answers.
const routes = [
  terminal,
  editor,
  events,
  sessionReads,
  projects,
  attachments,
  sessionActions,
  browser,
  devServer,
  agents,
  workflows,
];
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
    // Route modules get the shared state and services; anything stateless they import.
    const ctx = {
      req,
      res,
      url,
      parts,
      state,
      save,
      id,
      now,
      DATA_DIR,
      eventHub,
      bootstrapPayload,
      bootstrapAgents,
      refreshBootstrapInBackground,
      sessionLogs,
      turns,
      UNSUPPORTED_RISK,
      resolveSessionOptions,
      authChildren,
      harnessJobs,
      agentStatus,
      listAgentModels,
      browserContexts,
      controls,
      browserHub,
      computers,
      browserStream,
      computerView,
      children,
      devStartClaims,
      startDevServer,
      refreshDevProcess,
      handled: false,
      json: (...args) => {
        json(...args);
        ctx.handled = true;
        return true;
      },
    };
    for (const route of routes) {
      ctx.handled = false;
      if (await route(ctx)) return;
    }
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
