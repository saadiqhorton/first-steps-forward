/**
 * `/api/projects/:id/processes` and `/api/processes/:id/*`: the Processes list, one
 * process's details and output, marking a process as good, and stopping all of a
 * project's processes. Starting and stopping one process stays in devServer.mjs,
 * which owns the child processes.
 */
import { localServerDiscovery } from "../browser-local-servers.mjs";
import { findUnmanagedAdeInstances, isAdeProjectPath } from "../ade-self.mjs";

export async function processes(ctx) {
  const { req, res, url, parts, state, save, devServers, json } = ctx;

  if (parts[0] === "projects" && parts[2] === "processes") {
    const project = state.projects.find((item) => item.id === parts[1]);
    if (!project) return json(res, 404, { error: "Project not found." });
    if (req.method === "GET" && parts.length === 3) {
      return json(res, 200, {
        processes: state.processes
          .filter((proc) => proc.projectId === project.id)
          .map((proc) => view(proc)),
        ade: await adeSummary(ctx),
      });
    }
    if (req.method === "POST" && parts[3] === "stop-all") {
      const records = state.processes.filter((proc) => proc.projectId === project.id);
      const stopped = [];
      const failed = [];
      for (const proc of records) {
        try {
          const result = await devServers.stopDevServer(proc, project);
          if (result.stalePid) {
            failed.push({
              id: proc.id,
              name: proc.name,
              error: "The stored process id no longer matches this project's process.",
            });
          } else stopped.push(proc.id);
        } catch (error) {
          failed.push({ id: proc.id, name: proc.name, error: error?.message ?? String(error) });
        }
      }
      await save();
      return json(res, 200, { stopped, failed });
    }
    return json(res, 405, { error: "Method not allowed." });
  }

  if (parts[0] !== "processes" || !parts[1]) return ctx.handled || res.writableEnded;
  const proc = state.processes.find((item) => item.id === parts[1]);
  if (!proc) return json(res, 404, { error: "Process not found." });

  if (req.method === "GET" && parts.length === 2) {
    return json(res, 200, {
      process: view(proc),
      output: outputPage(proc, 0),
    });
  }

  if (req.method === "GET" && parts[2] === "output") {
    const after = Number(url.searchParams.get("after") ?? 0);
    return json(res, 200, outputPage(proc, Number.isFinite(after) && after > 0 ? after : 0));
  }

  if (req.method === "POST" && parts[2] === "ack") {
    const changed = devServers.markGood(proc);
    if (changed) await save();
    return json(res, 200, { process: view(proc) });
  }

  if (req.method === "POST" && parts[2] === "read") {
    // The agent asked to read the process's output: acknowledge the request without
    // changing the record. Kept separate from `ack` (mark as good).
    return json(res, 200, { process: view(proc), output: outputPage(proc, 0) });
  }

  return ctx.handled || res.writableEnded;
}

let adeScan = { at: 0, key: "", rows: [] };

/**
 * ADE itself in every project: `app` is this window. `unmanaged` adds other ADE
 * servers on loopback that share the ADE checkout, when that checkout is added,
 * such as a dev server started in a terminal. Read-only rows.
 */
async function adeSummary(ctx) {
  const appProject = ctx.state.projects.find(
    (item) => !item.missing && isAdeProjectPath(item.path, ctx.appRoot),
  );
  const managedPorts = ctx.state.processes.map((proc) => proc.port).filter(Boolean);
  const currentPort = ctx.appPort ?? ctx.req.socket?.localPort;
  const exclude = [...new Set([currentPort, ...managedPorts].filter(Boolean))].sort(
    (a, b) => a - b,
  );
  const key = `${appProject?.id ?? ""}:${exclude.join(",")}`;
  if (adeScan.key !== key || Date.now() - adeScan.at >= 5_000) {
    const rows = appProject
      ? await findUnmanagedAdeInstances({
          scan: localServerDiscovery.scan,
          excludePorts: exclude,
          projectPath: appProject.path,
        })
      : [];
    adeScan = { at: Date.now(), key, rows };
  }
  return {
    app: ctx.appPort ? { address: ctx.appAddress, port: ctx.appPort } : null,
    unmanaged: adeScan.rows,
  };
}

/** One process as the Processes UI reads it: no raw output array, just the facts. */
function view(proc) {
  const address = proc.status !== "stopped" && proc.port ? `http://127.0.0.1:${proc.port}/` : null;
  return {
    id: proc.id,
    projectId: proc.projectId,
    name: proc.name,
    command: proc.command,
    status: proc.status,
    port: proc.port,
    address,
    addresses: address ? [address] : [],
    source: proc.source === "approved" ? "approved_command" : "package_script",
    cwd: proc.cwd ?? ".",
    sessionId: proc.sessionId ?? null,
    startedAt: proc.startedAt ?? null,
    updatedAt: proc.updatedAt ?? null,
    stoppedAt: proc.stoppedAt ?? null,
    verifiedAt: proc.verifiedAt ?? null,
    stopError: proc.stopError ?? null,
    lineCount: (proc.output ?? []).length,
  };
}

/** A page of output lines; `after` is a line count, so the reader can ask for what is new. */
function outputPage(proc, after) {
  const output = proc.output ?? [];
  const total = output.length;
  const reset = after > total;
  const start = reset ? 0 : after;
  const lines = output.slice(start).map((text, index) => ({ n: start + index + 1, text }));
  return {
    lines,
    next: total,
    total,
    reset,
    source: "log",
  };
}
