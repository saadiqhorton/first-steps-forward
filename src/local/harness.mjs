/**
 * Harness install/update jobs for ADE agent CLIs. What to install and how to
 * update comes from each agent adapter's `harness` profile.
 *
 * Latest-version checks use `npm view <pkg> version` as a registry convention;
 * vendors do not document a dedicated "latest without install" API. Spawn is
 * always argv-only (no shell); stdin is closed so interactive prompts get EOF.
 */
import path from "node:path";
import { checkBrewUpdate, detectBrewInstall } from "./harness-brew.mjs";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_LINES = 400;
const LATEST_TTL_MS = 15 * 60 * 1000;
const LATEST_FAILURE_TTL_MS = 60 * 1000;
const LATEST_TIMEOUT_MS = 5000;

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

/** Extract the first dotted version, including an optional prerelease. */
function versionParts(raw) {
  const match = String(raw ?? "").match(/v?(\d+(?:\.\d+)+)(?:-([0-9a-z.-]+))?/i);
  if (!match) return null;
  return { numbers: match[1].split(".").map(Number), prerelease: match[2]?.split(".") ?? [] };
}

/** Compare dotted versions using semver prerelease ordering. Unknown versions compare equal. */
export function compareVersions(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  if (!pa || !pb) return 0;
  const len = Math.max(pa.numbers.length, pb.numbers.length);
  for (let i = 0; i < len; i++) {
    const da = pa.numbers[i] ?? 0;
    const db = pb.numbers[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  if (!pa.prerelease.length || !pb.prerelease.length)
    return pa.prerelease.length ? -1 : pb.prerelease.length ? 1 : 0;
  for (let i = 0; i < Math.max(pa.prerelease.length, pb.prerelease.length); i++) {
    const da = pa.prerelease[i];
    const db = pb.prerelease[i];
    if (da === undefined) return -1;
    if (db === undefined) return 1;
    if (da === db) continue;
    const aNumeric = /^\d+$/.test(da);
    const bNumeric = /^\d+$/.test(db);
    if (aNumeric && bNumeric) return Number(da) < Number(db) ? -1 : 1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return da < db ? -1 : 1;
  }
  return 0;
}

/** Detect the manager of the exact binary ADE will launch. */
export async function detectInstallMethod(agent, deps) {
  const bin = agent?.bin;
  if (!bin) return { method: "missing" };
  const whichPath = await deps.which(bin);
  if (!whichPath) return { method: "missing" };
  let resolved;
  try {
    resolved = path.resolve(await deps.realpath(whichPath));
  } catch {
    return { method: "other", path: whichPath };
  }
  const inside = (root) => {
    const dir = path.resolve(root);
    return resolved === dir || resolved.startsWith(dir + path.sep);
  };
  const npmRoot = await deps.npmRoot();
  if (npmRoot && agent.harness?.pkg && inside(path.resolve(npmRoot, agent.harness.pkg)))
    return { method: "npm", path: whichPath };

  // npm on Windows creates .cmd launchers beside node_modules rather than
  // symlinks into the package. Confirm both the global prefix and the shim's
  // package target before allowing an npm-managed update.
  if (
    (deps.platform ?? process.platform) === "win32" &&
    npmRoot &&
    agent.harness?.pkg &&
    deps.readFile
  ) {
    try {
      const normalize = (value) => path.resolve(value).toLowerCase();
      const pkgDir = path.resolve(npmRoot, agent.harness.pkg);
      const samePrefix = normalize(path.dirname(whichPath)) === normalize(path.dirname(npmRoot));
      const sameName = path.basename(whichPath).toLowerCase() === `${bin.toLowerCase()}.cmd`;
      const shim = await deps.readFile(whichPath);
      const escape = (part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pkgPattern = agent.harness.pkg.split("/").map(escape).join("[\\\\/]");
      const targetsPackage = new RegExp(`node_modules[\\\\/]${pkgPattern}[\\\\/]`, "i").test(
        String(shim),
      );
      if (samePrefix && sameName && targetsPackage && (await deps.realpath(pkgDir)))
        return { method: "npm", path: whichPath };
    } catch {
      /* A missing or unrecognized shim is not safe to update. */
    }
  }

  // Homebrew owns the executable only when its installed formula or cask
  // lists the resolved path. The adapter's allowlist keeps this to the
  // package the user installed, never a Homebrew Node keg that happens to
  // contain a global npm package.
  if (deps.run && agent.harness?.brews?.length) {
    const brew = await detectBrewInstall(whichPath, agent.harness.brews, deps);
    if (brew) return brew;
  }

  // Only use mise's global upgrade when the active binary and globally
  // configured installation agree. A tool provided by Node (e.g. a globally
  // installed npm package) must never cause ADE to upgrade Node itself.
  if (deps.run && (await deps.which("mise"))) {
    try {
      const [whichResult, pluginResult] = await Promise.all([
        deps.run("mise", ["which", bin], { timeout: 5000 }),
        deps.run("mise", ["which", "--plugin", bin], { timeout: 5000 }),
      ]);
      const tool = String(pluginResult.stdout ?? "").trim();
      if (
        whichResult.code === 0 &&
        pluginResult.code === 0 &&
        /^[a-zA-Z0-9._-]+$/.test(tool) &&
        (tool === agent.id || tool === bin) &&
        path.resolve(await deps.realpath(String(whichResult.stdout ?? "").trim())) === resolved
      ) {
        const list = await deps.run("mise", ["ls", "--json", "--global", "--current", tool], {
          timeout: 5000,
        });
        const rows = list.code === 0 ? JSON.parse(list.stdout) : [];
        if (Array.isArray(rows)) {
          for (const row of rows) {
            if (!row?.installed || !row?.active || typeof row.install_path !== "string") continue;
            if (inside(await deps.realpath(row.install_path)))
              return { method: "mise", path: whichPath, miseTool: tool };
          }
        }
      }
    } catch {
      /* Unknown managers are never modified by ADE. */
    }
  }
  return { method: "other", path: whichPath };
}

/** Build a manager-specific update only for a validated agent/tool pair. */
export function miseUpdateCommand(agent, tool) {
  if (
    typeof tool !== "string" ||
    !/^[a-zA-Z0-9._-]+$/.test(tool) ||
    (tool !== agent?.id && tool !== agent?.bin)
  )
    return null;
  return ["mise", ["upgrade", "--global", "--no-prune", tool]];
}

/** @type {Map<string, { at: number, version: string|null }>} */
const latestCache = new Map();

/**
 * Registry check via `npm view <pkg> version`. Successful checks are cached for 15 minutes; failures are retried after one minute.
 * Returns null on any failure (non-zero exit, missing agent, thrown run).
 */
export async function latestVersion(
  agent,
  run,
  { now = Date.now(), force = false, miseTool, brewItem, installedVersion } = {},
) {
  const entry = agent?.harness;
  if (!entry) return null;
  const agentId = brewItem
    ? `${agent.id}|brew|${String(brewItem?.kind)}|${String(brewItem?.name)}`
    : miseTool
      ? `${agent.id}|mise|${miseTool}`
      : agent.id;
  const cached = latestCache.get(agentId);
  if (
    !force &&
    cached &&
    now - cached.at < (cached.version ? LATEST_TTL_MS : LATEST_FAILURE_TTL_MS)
  )
    return cached.version;
  try {
    let version;
    if (brewItem) {
      const result = await checkBrewUpdate(brewItem, run);
      if (!result) throw new Error("Homebrew update check failed");
      // A pinned package is outdated by Homebrew's count but `brew upgrade`
      // will refuse it, so ADE must not offer an update it cannot apply.
      version = result.outdated && !result.pinned ? result.latestVersion : installedVersion;
    } else if (miseTool) {
      if (!miseUpdateCommand(agent, miseTool)) return null;
      const result = await run("mise", ["outdated", "--json", "--global", miseTool], {
        timeout: 15000,
      });
      if (result?.code !== 0) throw new Error("mise update check failed");
      const data = JSON.parse(String(result.stdout ?? ""));
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error("invalid mise update result");
      version =
        data[miseTool]?.latest ?? (Object.keys(data).length === 0 ? installedVersion : null);
    } else {
      const result = await run("npm", ["view", entry.pkg, "version", "--prefer-online"], {
        timeout: LATEST_TIMEOUT_MS,
      });
      if (result?.code !== 0) throw new Error("registry check failed");
      version = String(result.stdout ?? "")
        .trim()
        .split(/\r?\n/)[0]
        ?.trim();
    }
    if (
      typeof version !== "string" ||
      !/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
    ) {
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
export function createHarnessJobs({
  spawn,
  onFinished,
  onChange,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
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
      onChange?.(job);
    } catch {}
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
      try {
        onChange?.(job);
      } catch {}

      let child;
      try {
        child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        job.output.push(String(e?.message ?? e));
        finish(job, "failed", 1);
        return publicJob(job);
      }
      job._child = child;

      const onData = (chunk) => {
        appendOutput(job, chunk);
        try {
          onChange?.(job);
        } catch {}
      };
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
