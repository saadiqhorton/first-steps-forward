import { listWorkflows, upsertWorkflow, deleteWorkflow as removeWorkflow } from "../workflows.mjs";
import { adapters } from "../adapters/index.mjs";
import { body } from "../http.mjs";

/** `/api/workflows`: list, save and delete workflows. */
export async function workflows(ctx) {
  const { req, res, parts, state, save, json } = ctx;
  if (parts[0] === "workflows") {
    const agentIds = Object.keys(adapters);
    if (req.method === "GET" && parts.length === 1)
      return json(res, 200, { workflows: listWorkflows(state.workflows) });
    if (req.method === "POST" && parts.length === 1) {
      const data = await body(req);
      const result = upsertWorkflow(state.workflows, data, { agentIds });
      if (!result.ok) return json(res, result.status ?? 400, { error: result.error });
      state.workflows = result.stored;
      await save();
      return json(res, 201, { workflow: result.workflow });
    }
    if (req.method === "POST" && parts.length === 2) {
      const data = await body(req);
      const result = upsertWorkflow(state.workflows, data, { id: parts[1], agentIds });
      if (!result.ok) return json(res, result.status ?? 400, { error: result.error });
      state.workflows = result.stored;
      await save();
      return json(res, 200, { workflow: result.workflow });
    }
    if (req.method === "POST" && parts.length === 3 && parts[2] === "delete") {
      const result = removeWorkflow(state.workflows, parts[1]);
      if (!result.ok) return json(res, result.status ?? 400, { error: result.error });
      state.workflows = result.stored;
      await save();
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: "Not found." });
  }
  return ctx.handled || res.writableEnded;
}
