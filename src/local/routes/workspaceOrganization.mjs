import { body } from "../http.mjs";

const fail = (res, json, error) =>
  json(res, error.status || 400, { error: error.message || "Request failed." });
export async function workspaceOrganization(ctx) {
  const { req, res, parts, url, json, organization } = ctx;
  if (!organization) return false;
  try {
    if (req.method === "GET" && parts[0] === "workspace" && parts[1] === "inbox")
      return json(res, 200, await organization.inbox(Object.fromEntries(url.searchParams)));
    if (
      req.method === "POST" &&
      parts[0] === "workspace" &&
      parts[1] === "inbox" &&
      parts[2] === "bulk"
    )
      return json(res, 200, await organization.bulk((await body(req)).actions || []));
    if (
      req.method === "POST" &&
      parts[0] === "workspace" &&
      parts[1] === "sessions" &&
      parts[3] === "read"
    ) {
      const b = await body(req);
      return json(res, 200, await organization.markRead(parts[2], b.readAt));
    }
    if (parts[0] === "workspace" && parts[1] === "sessions" && parts[3] === "snooze") {
      if (req.method === "DELETE") return json(res, 200, await organization.unsnooze(parts[2]));
      if (req.method === "POST") {
        const b = await body(req);
        return json(res, 200, await organization.snooze(parts[2], b.until, b.preset));
      }
    }
    if (req.method === "GET" && parts.join("/") === "workspace/workflows/frequent")
      return json(res, 200, { items: organization.frequent() });
    if (
      req.method === "POST" &&
      parts[0] === "workspace" &&
      parts[1] === "workflows" &&
      parts[3] === "launch"
    )
      return json(
        res,
        201,
        await organization.launchWorkflow(parts[2], { ...(await body(req)), req }),
      );
    if (
      req.method === "GET" &&
      parts[0] === "workspace" &&
      parts[1] === "projects" &&
      parts[2] === "discover"
    )
      return json(res, 200, await organization.discoverProjects(url.searchParams.get("path")));
    if (
      req.method === "POST" &&
      parts[0] === "workspace" &&
      parts[1] === "projects" &&
      parts[3] === "pin"
    ) {
      const b = await body(req);
      return json(res, 200, await organization.pinProject(parts[2], !!b.pinned, b.position));
    }
    if (parts[0] === "workspace" && parts[1] === "projects" && parts[3] === "settings") {
      if (req.method === "GET") return json(res, 200, organization.projectSettings(parts[2]));
      if (req.method === "PATCH")
        return json(res, 200, await organization.updateProjectSettings(parts[2], await body(req)));
    }
  } catch (error) {
    return fail(res, json, error);
  }
  return false;
}
