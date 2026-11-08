import { getDiff, projectInfo } from "../project-git.mjs";
import { MODEL_ID } from "../models.mjs";
import { resolveAttachments } from "../attachments.mjs";
import { body } from "../http.mjs";

/** `/api/sessions`: search, read one session, and start a new one. */
export async function sessionReads(ctx) {
  const {
    req,
    res,
    url,
    parts,
    DATA_DIR,
    state,
    turns,
    UNSUPPORTED_RISK,
    resolveSessionOptions,
    json,
  } = ctx;
  if (req.method === "GET" && parts[0] === "sessions" && parts.length === 1) {
    const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const projectId = url.searchParams.get("project");
    if (!query) return json(res, 200, { ids: [] });
    const ids = state.sessions
      .filter((session) => !projectId || session.projectId === projectId)
      .filter((session) =>
        [
          session.request,
          session.summary,
          ...(session.messages ?? []).map((message) => message.text),
        ].some((text) =>
          String(text ?? "")
            .toLowerCase()
            .includes(query),
        ),
      )
      .map((session) => session.id);
    return json(res, 200, { ids });
  }
  if (req.method === "GET" && parts[0] === "sessions" && parts.length === 2) {
    const session = state.sessions.find((item) => item.id === parts[1]);
    if (!session) return json(res, 404, { error: "Session not found." });
    const { logs: _logs, ...detail } = session;
    return json(res, 200, { session: detail });
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
    const attachmentIds = Array.isArray(data.attachmentIds) ? data.attachmentIds : [];
    let files = [];
    try {
      files = attachmentIds.length
        ? await resolveAttachments(DATA_DIR, attachmentIds, { includeBytes: false })
        : [];
    } catch (error) {
      if (error?.status) return json(res, error.status, { error: error.message });
      throw error;
    }
    const text = request + (data.criteria ? `\n\nAcceptance criteria: ${data.criteria}` : "");
    const session = await turns.start({
      project,
      agentId: agent.id,
      request,
      criteria: String(data.criteria ?? ""),
      text,
      files,
      model: model || undefined,
      options: optionCheck.value,
      baseline,
    });
    return json(res, 201, session);
  }
  return ctx.handled || res.writableEnded;
}
