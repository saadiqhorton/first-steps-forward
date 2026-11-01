import { processRunsIn as processMatches, stopProcess as stopChild } from "../spawn.mjs";

/** `/api/projects/:id/dev/*` and `/api/processes/:id/*`: start, stop and read the dev server. */
export async function devServer(ctx) {
  const {
    req,
    res,
    parts,
    state,
    children,
    devStartClaims,
    now,
    save,
    startDevServer,
    refreshDevProcess,
    json,
  } = ctx;
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
  return ctx.handled || res.writableEnded;
}
/** Compact agent-facing view of a dev record: port only while running. */
const devView = (proc) => ({
  status: proc.status,
  port: proc.status === "running" ? proc.port : 0,
  command: proc.command,
});
