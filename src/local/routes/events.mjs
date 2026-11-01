/** `/api/events` (the update stream) and `/api/bootstrap`. */
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
    json,
  } = ctx;
  if (req.method === "GET" && parts[0] === "events" && parts.length === 1) {
    eventHub.connect(req, res, url.searchParams.get("project") ?? "");
    return true;
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
