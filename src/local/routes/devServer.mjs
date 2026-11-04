import { processRunsIn as processMatches, stopProcess as stopChild } from "../spawn.mjs";
import { resolveDevCommand, sameDevCommand } from "../dev-command.mjs";
import { body } from "../http.mjs";

const NEVER_YOURSELF =
  "Never start a server yourself (no nohup, &, disown, or a foreground dev command) to work around this.";

/**
 * `/api/projects/:id/dev/*` and `/api/processes/:id/*`: start, stop and read the dev server, and
 * answer or forget the project's agent-proposed dev command (docs/adr/0005).
 */
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
    devServerStatus,
    devApprovals,
    json,
  } = ctx;
  if (req.method === "GET" && parts[0] === "projects" && parts[2] === "dev") {
    const project = state.projects.find((x) => x.id === parts[1]);
    if (!project) return json(res, 404, { error: "Project not found." });
    const proc = state.processes.find((x) => x.projectId === project.id);
    const note = project.devScriptNote ? { devScriptNote: project.devScriptNote } : {};
    const asked = devApprovals.pendingFor(project.id);
    const extra = {
      ...note,
      summary: devServerStatus(project),
      ...(asked ? { awaitingApproval: { command: asked.command, cwd: asked.cwd } } : {}),
    };
    if (!proc)
      return json(res, 200, {
        found: false,
        ...extra,
        hint: project.devCommand
          ? "POST this path + /start to run the approved dev command."
          : "No dev-server record yet: POST this path + /start to re-scan package.json and start its dev script. Without one, propose a command with dev_server_start({ command, cwd }); the user approves it once in ADE.",
      });
    return json(res, 200, {
      found: true,
      ...devView(proc),
      ...extra,
      outputTail: (proc.output ?? []).slice(-5),
    });
  }
  if (
    req.method === "POST" &&
    parts[0] === "projects" &&
    parts[2] === "dev" &&
    parts[3] === "command"
  ) {
    const project = state.projects.find((x) => x.id === parts[1]);
    if (!project) return json(res, 404, { error: "Project not found." });
    // The right pane answers a request no session holds; session cards use the session's
    // permission route. Both go to the same answer.
    if (parts[4] === "answer") {
      const data = await body(req);
      if (!["allow", "deny"].includes(data.decision))
        return json(res, 400, { error: 'decision must be "allow" or "deny".' });
      await devApprovals.answer(project, data.requestId, data.decision === "allow");
      return json(res, 200, { devCommand: project.devCommand ?? null });
    }
    // Forget the approved command: a running server keeps running, the next start asks again.
    if (parts[4] === "forget") {
      if (project.devCommand) {
        delete project.devCommand;
        await refreshDevProcess(project);
        await save();
      }
      return json(res, 200, { devCommand: null });
    }
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
    // Claimed before the first await, as the legacy start route does.
    devStartClaims.add(project.id);
    let claimed = true;
    try {
      let data;
      try {
        data = await body(req);
      } catch (error) {
        if (error?.status) throw error;
        return json(res, 400, { error: "The request body must be JSON." });
      }
      // An empty string is no proposal: some tool callers fill optional arguments with "".
      const proposing = data.command !== undefined && data.command !== null && data.command !== "";
      // Inline re-scan FIRST: a scripts.dev scaffolded earlier this same
      // turn must be detected without waiting for the next bootstrap poll.
      const { proc, changed } = await refreshDevProcess(project);
      if (changed) save().catch(() => {});
      const script = proc && proc.source !== "approved";
      const ignored =
        script && proposing
          ? {
              note: "This project has a package.json dev script, so ADE ran that and ignored the command you passed.",
            }
          : {};
      if (proc && (proc.status === "running" || proc.status === "starting"))
        return json(res, 409, {
          error: "The dev server is already running for this project.",
          ...devView(proc),
          ...ignored,
          ...(proposing && !script
            ? {
                hint: "To run a different command, stop this one with dev_server_stop first.",
              }
            : {}),
        });
      if (script) {
        await startDevServer(proc, project);
        return json(res, 200, { ...startView(proc), ...ignored });
      }
      if (!proposing) {
        if (proc && project.devCommand) {
          await startDevServer(proc, project);
          return json(res, 200, startView(proc));
        }
        const asked = devApprovals.pendingFor(project.id);
        return json(res, 404, {
          error: project.devScriptNote
            ? "No dev script for this project: package.json could not be read."
            : "No dev script for this project, even after re-scanning package.json, and no approved dev command.",
          ...(project.devScriptNote ? { devScriptNote: project.devScriptNote } : {}),
          guidance: asked
            ? `The user has not answered whether ADE may run \`${asked.command}\` yet. Call dev_server_start again with that same command and cwd to keep waiting, or tell the user. ${NEVER_YOURSELF}`
            : `Find the command that starts this project's app and call dev_server_start with \`command\` (one program and its arguments; {port} becomes the port ADE picks, which is also in PORT) and \`cwd\` (its folder relative to the project root). ADE asks the user to approve it once. If you cannot tell how the app starts, tell the user. ${NEVER_YOURSELF}`,
        });
      }
      if (project.devScriptNote)
        return json(res, 404, {
          error:
            "package.json could not be read, so ADE cannot tell whether it has a dev script; fix it before proposing a dev command.",
          devScriptNote: project.devScriptNote,
        });
      const proposal = await resolveDevCommand(data, project.path);
      if (proc && sameDevCommand(project.devCommand, proposal)) {
        await startDevServer(proc, project);
        return json(res, 200, startView(proc));
      }
      // A new command: ask the user. The claim is released while waiting, so an identical call
      // can join the question and a status call still answers.
      devStartClaims.delete(project.id);
      claimed = false;
      const request = devApprovals.ask(project, proposal, data.sessionId);
      const outcome = await devApprovals.wait(project.id, request.id, res);
      const pending = {
        command: request.command,
        cwd: request.cwd,
        ...(request.port ? { port: request.port } : {}),
      };
      if (outcome === "deny")
        return json(res, 403, {
          error: `The user declined to run \`${request.command}\`. Don't start it another way; tell the user.`,
          ...pending,
        });
      if (outcome === "timeout" || outcome === "gone")
        return json(res, 202, {
          status: "awaiting_approval",
          port: 0,
          ...pending,
          message: `Still waiting for the user to approve \`${request.command}\` in ADE. Call dev_server_start again with the same command and cwd to keep waiting, or tell the user. ${NEVER_YOURSELF}`,
        });
      if (outcome !== "allow")
        return json(res, 409, {
          error:
            outcome === "superseded"
              ? "A different dev command was proposed before the user answered, so this request was replaced."
              : "The request was cancelled before the user answered.",
          ...pending,
        });
      // Approved: project.devCommand now holds it. Start it like any approved command.
      if (devStartClaims.has(project.id)) {
        const current = state.processes.find((x) => x.projectId === project.id);
        return json(res, 409, {
          error: "The dev server is already starting for this project.",
          ...(current ? devView(current) : { port: 0 }),
          status: "starting",
        });
      }
      devStartClaims.add(project.id);
      claimed = true;
      const approved = (await refreshDevProcess(project)).proc;
      if (!approved || approved.source !== "approved")
        return json(res, 409, {
          error:
            "The project changed while waiting for approval (a package.json dev script appeared); call dev_server_start again.",
        });
      if (approved.status === "running" || approved.status === "starting")
        return json(res, 409, {
          error: "The dev server is already running for this project.",
          ...devView(approved),
        });
      await startDevServer(approved, project);
      return json(res, 200, { ...startView(approved), approved: true });
    } finally {
      if (claimed) devStartClaims.delete(project.id);
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
    if (!child && proc.pid && !(await processMatches(proc.pid, proc.dir ?? project.path)))
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
    if (!child && proc.pid && !(await processMatches(proc.pid, proc.dir ?? project?.path))) {
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
  ...(proc.source === "approved"
    ? { source: "approved_command", cwd: proc.cwd }
    : { source: "package_script" }),
});
/** After a start: a server that did not come up says why (its last output lines). */
const startView = (proc) => ({
  ...devView(proc),
  ...(proc.status === "running" ? {} : { outputTail: (proc.output ?? []).slice(-5) }),
});
