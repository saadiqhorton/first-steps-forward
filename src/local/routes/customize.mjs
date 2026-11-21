import { body } from "../http.mjs";
import { CustomizeError } from "../customize/index.mjs";

/**
 * `/api/customize/*`: set up a private copy of ADE and change it with an agent.
 * Open to remote clients behind the token gate (same trust as starting a build agent).
 */
export async function customize(ctx) {
  const { req, res, parts, json, customize: service } = ctx;
  if (parts[0] !== "customize") return ctx.handled || res.writableEnded;
  const method = req.method;
  try {
    if (parts.length === 1 && method === "GET") return json(res, 200, await service.status());
    if (parts.length === 2 && parts[1] === "setup" && method === "POST") {
      const setup = await service.startSetup();
      return json(res, 202, { setup });
    }
    if (parts.length === 2 && parts[1] === "restart" && method === "POST")
      return json(res, 202, { switch: await service.restart() });
    if (parts[1] === "changes") {
      if (parts.length === 2 && method === "POST") {
        const data = await body(req);
        if (typeof data.request !== "string" || !data.agentId)
          return json(res, 400, { error: "Describe the change and choose an agent." });
        return json(res, 201, { change: await service.createChange(data) });
      }
      const changeId = parts[2];
      const action = parts[3];
      if (changeId && parts.length === 4 && method === "POST") {
        if (action === "checks")
          return json(res, 202, { change: await service.rerunChecks(changeId) });
        if (action === "keep") return json(res, 200, { change: await service.keep(changeId) });
        if (action === "undo") return json(res, 200, await service.undo(changeId));
        if (action === "remove") return json(res, 200, { change: await service.remove(changeId) });
        if (action === "preview") {
          const { action: op } = await body(req);
          if (op === "start")
            return json(res, 202, { change: await service.startPreview(changeId) });
          if (op === "stop") return json(res, 200, { change: await service.stopPreview(changeId) });
          return json(res, 400, { error: 'Send { action: "start" } or { action: "stop" }.' });
        }
      }
    }
    return json(res, 404, { error: "Not found." });
  } catch (error) {
    if (error instanceof CustomizeError || error?.status)
      return json(res, error.status ?? 500, { error: error.message });
    throw error;
  }
}
