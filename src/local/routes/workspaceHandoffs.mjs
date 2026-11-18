import { body } from "../http.mjs";

/** Cross-project handoffs: send a request, decide a draft, retry, and read results. */
export async function workspaceHandoffs(ctx) {
  const { req, res, parts, url, json, handoffs } = ctx;
  if (!handoffs || parts[0] !== "workspace" || parts[1] !== "handoffs") return false;
  try {
    if (req.method === "GET" && parts.length === 2)
      return json(
        res,
        200,
        await handoffs.list({
          sourceThreadId: url.searchParams.get("sourceThreadId") ?? "",
          sourceSessionId: url.searchParams.get("sourceSessionId") ?? "",
          status: url.searchParams.get("status") ?? "",
          limit: url.searchParams.get("limit") ?? undefined,
        }),
      );
    if (req.method === "POST" && parts.length === 2)
      return json(res, 202, await handoffs.dispatch({ ...(await body(req)), confirmed: true }));
    if (req.method === "POST" && parts[3] === "decision" && parts[2])
      return json(res, 200, await handoffs.decide(parts[2], await body(req)));
    if (req.method === "POST" && parts[3] === "retry" && parts[2])
      return json(res, 202, await handoffs.retry(parts[2]));
  } catch (error) {
    return json(res, error.status ?? 400, { error: error.message ?? "Handoff request failed." });
  }
  return false;
}
