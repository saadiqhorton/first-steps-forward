import { body } from "../http.mjs";
import {
  ConnectorError,
  PRESETS,
  connectorStore,
  publicConnector,
  publicPreset,
  testConnector,
} from "../connectors.mjs";

/** `/api/connectors`: list, add, change, remove and test the user's MCP connectors. */
export async function connectors(ctx) {
  const { req, res, parts, state, json } = ctx;
  if (parts[0] !== "connectors") return false;
  const store = ctx.connectors ?? connectorStore(ctx.DATA_DIR);
  const projectIds = (state?.projects ?? []).map((project) => project.id);
  const id = parts[1];
  try {
    if (!id && req.method === "GET")
      return json(res, 200, {
        connectors: (await store.list()).map(publicConnector),
        presets: PRESETS.map(publicPreset),
      });
    if (!id && req.method === "POST") {
      const connector = await store.create(await body(req), { projectIds });
      return json(res, 201, { connector: publicConnector(connector) });
    }
    if (id && parts.length === 2 && req.method === "PATCH") {
      const connector = await store.update(id, await body(req), { projectIds });
      return json(res, 200, { connector: publicConnector(connector) });
    }
    if (id && parts.length === 2 && req.method === "DELETE") {
      await store.remove(id);
      return json(res, 200, { ok: true });
    }
    if (id && parts[2] === "test" && parts.length === 3 && req.method === "POST") {
      const connector = await store.get(id);
      if (!connector) return json(res, 404, { error: "That connector does not exist." });
      if (connector.transport !== "http")
        return json(res, 400, { error: "Testing runs only for remote connectors." });
      return json(res, 200, await testConnector(connector, { fetchImpl: ctx.fetchImpl }));
    }
  } catch (error) {
    if (error instanceof ConnectorError) return json(res, error.status, { error: error.message });
    if (error?.status === 413 || error instanceof SyntaxError)
      return json(res, error.status ?? 400, {
        error: error.status === 413 ? error.message : "The request was not valid JSON.",
      });
    return json(res, 500, { error: error?.message ?? "Connectors could not be read." });
  }
  return false;
}
