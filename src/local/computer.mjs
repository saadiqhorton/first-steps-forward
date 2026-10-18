// Agent computers: one isolated Linux desktop (Docker container) per project
// that the coding agent drives through ADE's computer tools and the user
// watches over noVNC. Containers are labelled and carry their own VNC
// password and control token as labels, so ADE re-discovers them after a
// restart without writing secrets to workspace.json. Ports are published on
// 127.0.0.1 only.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const SCREEN = { width: 1280, height: 800 };
const IMAGE_FILES = ["Dockerfile", "start.sh", "computer-server.py"];
const BUILD_LOG_LINES = 40;

export function adeRoot() {
  return process.env.ADE_ROOT || process.cwd();
}
export function imageDir(root = adeRoot()) {
  return path.join(root, "docker", "agent-computer");
}
/** Tag derived from the image sources, so editing them triggers a rebuild. */
export async function imageTag(dir = imageDir()) {
  const hash = createHash("sha256");
  for (const file of IMAGE_FILES) hash.update(file).update(await fs.readFile(path.join(dir, file)));
  return `ade-computer:${hash.digest("hex").slice(0, 12)}`;
}
export function containerName(projectId) {
  return `ade-computer-${String(projectId)
    .replace(/[^a-zA-Z0-9_.-]/g, "")
    .slice(0, 40)}`;
}
export function runArgs({ projectId, image, vncPassword, controlToken }) {
  return [
    "run",
    "-d",
    "--name",
    containerName(projectId),
    "--label",
    "ade.computer=1",
    "--label",
    `ade.project=${projectId}`,
    "--label",
    `ade.vnc=${vncPassword}`,
    "--label",
    `ade.token=${controlToken}`,
    "--hostname",
    "ade-computer",
    // Lets the computer's browser reach the host's dev server on Linux
    // engines too (Docker Desktop provides this name already).
    "--add-host",
    "host.docker.internal:host-gateway",
    "--memory",
    "2g",
    "--cpus",
    "2",
    "--shm-size",
    "1g",
    "--pids-limit",
    "1024",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "-e",
    `VNC_PASSWORD=${vncPassword}`,
    "-e",
    `CONTROL_TOKEN=${controlToken}`,
    "-p",
    "127.0.0.1::6080",
    "-p",
    "127.0.0.1::7000",
    "-p",
    "127.0.0.1::9223",
    image,
  ];
}
export function viewerUrl(port, password, viewOnly = true) {
  // This URL carries the loopback host, port, and session credential for
  // ADE's bundled RFB client. ADE renders the remote screen directly.
  const query = new URLSearchParams({ password });
  if (viewOnly) query.set("view_only", "1");
  return `http://127.0.0.1:${port}/?${query}`;
}
/** Summarize `docker inspect` output for one container (or null). */
export function describeContainer(info) {
  if (!info) return null;
  const labels = info.Config?.Labels ?? {};
  const hostPort = (key) => Number(info.NetworkSettings?.Ports?.[key]?.[0]?.HostPort) || 0;
  return {
    running: info.State?.Running === true,
    exitCode: info.State?.ExitCode ?? null,
    startedAt: Date.parse(info.State?.StartedAt ?? "") || null,
    image: info.Config?.Image ?? null,
    vncPort: hostPort("6080/tcp"),
    controlPort: hostPort("7000/tcp"),
    cdpPort: hostPort("9223/tcp"),
    vncPassword: labels["ade.vnc"] ?? "",
    controlToken: labels["ade.token"] ?? "",
  };
}

function defaultRun(bin, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    const timer = opts.timeout ? setTimeout(() => child.kill("SIGTERM"), opts.timeout) : null;
    const onLine = (chunk) => opts.onOutput?.(chunk.toString());
    child.stdout.on("data", (d) => ((stdout += d), onLine(d)));
    child.stderr.on("data", (d) => ((stderr += d), onLine(d)));
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}${e.message}` });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

const firstLine = (text) =>
  String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean) ?? "";

export function createComputerManager({ run = defaultRun, root, fetchImpl = fetch } = {}) {
  // Transient phases ADE itself drives (building/starting/error); "running"
  // and "stopped" are always read back from Docker.
  const phases = new Map();
  const pending = new Map();

  async function docker() {
    const result = await run("docker", ["version", "--format", "{{.Server.Version}}"], {
      timeout: 10000,
    });
    if (result.code === 0) return { ok: true };
    const reason = firstLine(result.stderr) || firstLine(result.stdout);
    return {
      ok: false,
      detail:
        result.code === 127
          ? "Docker is not installed. Install Docker Desktop (or Docker Engine) to give agents a computer."
          : `Docker is not running: ${reason || "the daemon did not answer"}. Start Docker Desktop and try again.`,
    };
  }
  async function inspect(projectId) {
    const result = await run("docker", ["inspect", containerName(projectId)], { timeout: 10000 });
    if (result.code !== 0) return null;
    try {
      return describeContainer(JSON.parse(result.stdout)[0]);
    } catch {
      return null;
    }
  }

  async function status(projectId) {
    const phase = phases.get(projectId);
    if (phase && phase.status !== "error") return { projectId, screen: SCREEN, ...phase };
    const daemon = await docker();
    if (!daemon.ok)
      return { projectId, screen: SCREEN, status: "unavailable", detail: daemon.detail };
    const info = await inspect(projectId);
    if (info?.running) {
      // A container started from an older image has no CDP bridge; the UI asks for a restart.
      const tag = await imageTag(imageDir(root));
      return {
        projectId,
        screen: SCREEN,
        status: "running",
        startedAt: info.startedAt,
        viewerUrl: viewerUrl(info.vncPort, info.vncPassword, true),
        controlViewerUrl: viewerUrl(info.vncPort, info.vncPassword, false),
        cdpPort: info.cdpPort || null,
        outdated: info.image !== tag,
      };
    }
    if (phase) return { projectId, screen: SCREEN, ...phase };
    return {
      projectId,
      screen: SCREEN,
      status: "stopped",
      ...(info ? { detail: `The computer exited (code ${info.exitCode}).` } : {}),
    };
  }

  async function build(projectId, tag, dir) {
    const log = [];
    phases.set(projectId, {
      status: "building",
      detail: "Setting up the computer image. The first time takes a few minutes.",
      log,
    });
    const result = await run("docker", ["build", "-t", tag, dir], {
      timeout: 30 * 60 * 1000,
      onOutput: (text) => {
        for (const line of text.split(/\r?\n/).filter((l) => l.trim())) log.push(line);
        log.splice(0, Math.max(0, log.length - BUILD_LOG_LINES));
      },
    });
    if (result.code !== 0)
      throw Object.assign(new Error("Building the computer image failed."), { log });
  }

  async function waitHealthy(info, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetchImpl(`http://127.0.0.1:${info.controlPort}/health`, {
          headers: { "x-ade-token": info.controlToken },
          signal: AbortSignal.timeout(2000),
        });
        if (response.ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error("The computer did not become ready within 30 seconds.");
  }

  async function doStart(projectId) {
    const daemon = await docker();
    if (!daemon.ok) throw Object.assign(new Error(daemon.detail), { unavailable: true });
    const existing = await inspect(projectId);
    if (existing?.running) return;
    if (existing) await run("docker", ["rm", "-f", containerName(projectId)], { timeout: 20000 });
    const dir = imageDir(root);
    const tag = await imageTag(dir);
    const image = await run("docker", ["image", "inspect", tag], { timeout: 10000 });
    if (image.code !== 0) await build(projectId, tag, dir);
    phases.set(projectId, { status: "starting", detail: "Booting the computer." });
    const vncPassword = randomBytes(4).toString("hex"); // VNC uses at most 8 chars
    const controlToken = randomBytes(24).toString("hex");
    const started = await run(
      "docker",
      runArgs({ projectId, image: tag, vncPassword, controlToken }),
      { timeout: 60000 },
    );
    if (started.code !== 0)
      throw new Error(`docker run failed: ${firstLine(started.stderr) || started.code}`);
    const info = await inspect(projectId);
    if (!info?.running || !info.controlPort)
      throw new Error("The computer exited right after starting.");
    await waitHealthy(info);
  }

  function start(projectId) {
    if (pending.has(projectId)) return pending.get(projectId);
    const promise = doStart(projectId)
      .then(() => phases.delete(projectId))
      .catch((error) => {
        phases.set(projectId, {
          status: error.unavailable ? "unavailable" : "error",
          detail: error.message,
          ...(error.log ? { log: error.log } : {}),
        });
        throw error;
      })
      .finally(() => pending.delete(projectId));
    pending.set(projectId, promise);
    return promise;
  }

  async function stop(projectId) {
    phases.delete(projectId);
    const result = await run("docker", ["rm", "-f", containerName(projectId)], { timeout: 30000 });
    return { removed: result.code === 0 };
  }

  /** Run one computer-use action, starting the computer first if needed. */
  async function action(projectId, body) {
    let info = await inspect(projectId);
    if (!info?.running) {
      await start(projectId);
      info = await inspect(projectId);
    }
    if (!info?.running) throw new Error("The computer is not running.");
    const response = await fetchImpl(`http://127.0.0.1:${info.controlPort}/action`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ade-token": info.controlToken },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(60000),
    });
    const payload = await response.json().catch(() => ({ error: "invalid response" }));
    return { status: response.status, payload };
  }

  return { status, start, stop, action };
}
