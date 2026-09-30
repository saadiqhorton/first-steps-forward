/**
 * Harness install/update jobs for ADE agent CLIs (Codex, OpenCode, Pi).
 *
 * Latest-version checks use `npm view <pkg> version` as a registry convention;
 * vendors do not document a dedicated "latest without install" API. Spawn is
 * always argv-only (no shell); stdin is closed so interactive prompts get EOF.
 */
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_LINES = 400;
const LATEST_TTL_MS = 60 * 60 * 1000;

/** @type {Record<string, { pkg: string, install: [string, string[]], update: [string, string[]] }>} */
export const HARNESS = {
  codex: {
    pkg: "@openai/codex",
    install: ["npm", ["install", "-g", "@openai/codex"]],
    update: ["codex", ["update"]],
  },
  opencode: {
    pkg: "opencode-ai",
    install: ["npm", ["install", "-g", "opencode-ai"]],
    update: ["opencode", ["upgrade", "--method", "npm"]],
  },
  pi: {
    pkg: "@earendil-works/pi-coding-agent",
    install: ["npm", ["install", "-g", "--ignore-scripts", "@earendil-works/pi-coding-agent"]],
    update: ["pi", ["update", "--self"]],
  },
};

const BIN = {
  codex: "codex",
  opencode: "opencode",
  pi: "pi",
};

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function stripAnsi(text) {
  return text.replace(ANSI_RE, "");
}

function quoteArg(arg) {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

/** Display string for a [bin, args] command; args with spaces are double-quoted. */
export function commandLine([bin, args]) {
  return [bin, ...args.map(quoteArg)].join(" ");
}

/** Pull the first dotted numeric version token out of a free-form version string. */
function versionParts(raw) {
  const s = String(raw ?? "").trim();
  const match = s.match(/v?(\d+(?:\.\d+)*)/i);
  if (!match) return [0];
  return match[1].split(".").map((n) => Number.parseInt(n, 10) || 0);
}

/**
 * Numeric dotted compare. Ignores a leading "v" and any non-numeric prefix
 * (e.g. "codex-cli 0.158.0"). Missing trailing segments are treated as 0
 * so "v1.2" equals "1.2.0".
 * @returns {-1|0|1}
 */
export function compareVersions(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

/**
 * Detect whether an agent CLI is missing, installed via npm, or installed
 * some other way. "npm" when the resolved binary path sits under
 * `${npmRoot}/${pkg}`.
 */
export async function detectInstallMethod(agentId, deps) {
  const bin = BIN[agentId];
  if (!bin) return { method: "missing" };
  const whichPath = await deps.which(bin);
  if (!whichPath) return { method: "missing" };
  const npmRoot = await deps.npmRoot();
  if (!npmRoot) return { method: "other", path: whichPath };
  const pkg = HARNESS[agentId]?.pkg;
  if (!pkg) return { method: "other", path: whichPath };
  let resolved;
  try {
    resolved = await deps.realpath(whichPath);
  } catch {
    return { method: "other", path: whichPath };
  }
  const pkgDir = path.resolve(npmRoot, pkg);
  const normalized = path.resolve(resolved);
  const inside =
    normalized === pkgDir ||
    normalized.startsWith(pkgDir + path.sep) ||
    // Also accept forward-slash prefix checks for mixed path styles in tests.
    normalized.replaceAll("\\", "/").startsWith(pkgDir.replaceAll("\\", "/") + "/");
  if (inside) return { method: "npm", path: whichPath };
  return { method: "other", path: whichPath };
}

/** @type {Map<string, { at: number, version: string|null }>} */
const latestCache = new Map();

/**
 * Registry check via `npm view <pkg> version`. 1-hour in-memory cache.
 * Returns null on any failure (non-zero exit, missing agent, thrown run).
 */
export async function latestVersion(agentId, run, { now = Date.now() } = {}) {
  const entry = HARNESS[agentId];
  if (!entry) return null;
  const cached = latestCache.get(agentId);
  if (cached && now - cached.at < LATEST_TTL_MS) return cached.version;
  try {
    const result = await run("npm", ["view", entry.pkg, "version"]);
    if (result?.code !== 0) {
      latestCache.set(agentId, { at: now, version: null });
      return null;
    }
    const version = String(result.stdout ?? "")
      .trim()
      .split(/\r?\n/)[0]
      ?.trim();
    if (!version) {
      latestCache.set(agentId, { at: now, version: null });
      return null;
    }
    latestCache.set(agentId, { at: now, version });
    return version;
  } catch {
    latestCache.set(agentId, { at: now, version: null });
    return null;
  }
}

function idleJob() {
  return { status: "idle", command: "", output: [] };
}

function publicJob(job) {
  return {
    agentId: job.agentId,
    kind: job.kind,
    status: job.status,
    command: job.command,
    output: [...job.output],
    ...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}),
    ...(job.startedAt !== undefined ? { startedAt: job.startedAt } : {}),
    ...(job.finishedAt !== undefined ? { finishedAt: job.finishedAt } : {}),
  };
}

function appendOutput(job, chunk) {
  const text = stripAnsi(String(chunk));
  if (!text) return;
  const data = (job._partial ?? "") + text;
  const parts = data.split(/\r?\n/);
  // Everything after the last newline is an incomplete line (empty when the
  // chunk ended on a newline).
  job._partial = parts.pop() ?? "";
  for (const line of parts) job.output.push(line);
  while (job.output.length > MAX_OUTPUT_LINES) job.output.shift();
}

function flushPartial(job) {
  if (job._partial) {
    job.output.push(job._partial);
    while (job.output.length > MAX_OUTPUT_LINES) job.output.shift();
  }
  job._partial = null;
}

/**
 * Job runner for install/update. `spawn` is injected (production:
 * `node:child_process.spawn`). Jobs use stdio `["ignore","pipe","pipe"]`
 * so stdin is closed. Default timeout is 10 minutes.
 */
export function createHarnessJobs({ spawn, onFinished, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  /** @type {Map<string, object>} */
  const jobs = new Map();

  function finish(job, status, exitCode) {
    if (job.status !== "running") return;
    if (job._timer) {
      clearTimeout(job._timer);
      job._timer = null;
    }
    flushPartial(job);
    job.status = status;
    if (exitCode !== undefined) job.exitCode = exitCode;
    job.finishedAt = Date.now();
    delete job._partial;
    delete job._child;
    delete job._timer;
    try {
      onFinished?.(job);
    } catch {
      // Caller errors must not leave the job stuck.
    }
  }

  return {
    start(agentId, kind, command) {
      const existing = jobs.get(agentId);
      if (existing?.status === "running") {
        const err = new Error(`A ${existing.kind} job is already running for ${agentId}`);
        err.code = "BUSY";
        throw err;
      }
      const [bin, args] = command;
      const job = {
        agentId,
        kind,
        status: "running",
        command: commandLine(command),
        output: [],
        startedAt: Date.now(),
        _partial: null,
      };
      jobs.set(agentId, job);

      let child;
      try {
        child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        job.output.push(String(e?.message ?? e));
        finish(job, "failed", 1);
        return publicJob(job);
      }
      job._child = child;

      const onData = (chunk) => appendOutput(job, chunk);
      child.stdout?.on?.("data", onData);
      child.stderr?.on?.("data", onData);

      child.on?.("error", (err) => {
        appendOutput(job, String(err?.message ?? err));
        finish(job, "failed", 1);
      });

      child.on?.("close", (code) => {
        const exitCode = code ?? 1;
        finish(job, exitCode === 0 ? "succeeded" : "failed", exitCode);
      });

      job._timer = setTimeout(() => {
        try {
          child.kill?.();
        } catch {
          // Process may already be gone.
        }
        appendOutput(job, "Timed out after 10 minutes.");
        // Ensure the timeout line is a complete line even without a trailing newline.
        flushPartial(job);
        finish(job, "failed");
      }, timeoutMs);
      job._timer.unref?.();

      return publicJob(job);
    },

    get(agentId) {
      const job = jobs.get(agentId);
      if (!job) return idleJob();
      return publicJob(job);
    },
  };
}
