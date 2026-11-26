import { body } from "../http.mjs";

/** `/api/events` (the update stream), interest watches, and `/api/bootstrap`. */
export async function events(ctx) {
  const {
    req,
    res,
    url,
    parts,
    eventHub,
    state,
    now,
    bootstrapPayload,
    bootstrapAgents,
    refreshBootstrapInBackground,
    refreshProjectDiff,
    json,
  } = ctx;
  if (req.method === "GET" && parts[0] === "events" && parts.length === 1) {
    eventHub.connect(req, res, url.searchParams.get("project") ?? "");
    return true;
  }
  if (
    req.method === "POST" &&
    parts[0] === "events" &&
    parts[1] === "interest" &&
    parts.length === 2
  ) {
    const data = await body(req);
    const projectId = String(data.projectId ?? "").trim();
    if (!projectId) return json(res, 400, { error: "projectId is required." });
    if (data.diff === true) {
      eventHub.watchDiff(projectId);
      await refreshProjectDiff?.(projectId);
    } else if (data.diff === false) {
      eventHub.unwatchDiff(projectId);
    } else {
      return json(res, 400, { error: "diff must be true or false." });
    }
    return json(res, 200, { ok: true, watching: eventHub.diffProjects() });
  }
  if (req.method === "GET" && parts[0] === "bootstrap") {
    const agents = await bootstrapAgents();
    state.agents = agents;
    json(res, 200, { ...bootstrapPayload(), now: now() });
    if (!eventHub.clientCount()) refreshBootstrapInBackground();
    return true;
  }
  return ctx.handled || res.writableEnded;
}
