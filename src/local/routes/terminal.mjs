import { promises as fs } from "node:fs";
import { body } from "../http.mjs";

/** `/api/terminal/*`: host terminal sessions in a project folder. */
export async function terminal(ctx) {
  const { req, res, url, parts, state, json } = ctx;
  if (parts[0] === "terminal") {
    const { loadTerminal } = await import("../terminal-loader.mjs");
    let terminal;
    try {
      terminal = await loadTerminal();
    } catch (error) {
      return json(res, 503, { error: error.message });
    }
    if (req.method === "POST" && parts.length === 1) {
      const data = await body(req);
      const project = state.projects.find((item) => item.id === data.projectId);
      if (!project) return json(res, 404, { error: "Select an existing project first." });
      const size = terminal.terminalSize(data.cols, data.rows);
      if (!size) return json(res, 400, { error: "Invalid terminal dimensions." });
      let cwd;
      try {
        cwd = await fs.realpath(project.path);
        if (!(await fs.stat(cwd)).isDirectory()) throw new Error("Not a directory");
      } catch {
        return json(res, 400, { error: "The project folder is unavailable." });
      }
      try {
        return json(res, 201, terminal.openTerminal(cwd, size));
      } catch (error) {
        return json(res, 503, { error: error.message });
      }
    }
    if (parts.length === 2 && req.method === "GET") {
      const cursor = Number(url.searchParams.get("cursor") ?? "0");
      if (!Number.isInteger(cursor) || cursor < 0)
        return json(res, 400, { error: "Invalid output cursor." });
      const waitParam = url.searchParams.get("wait");
      const waitMs = waitParam == null || waitParam === "" ? 0 : Number(waitParam);
      if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 10_000)
        return json(res, 400, { error: "Invalid output wait." });
      const output = await terminal.readTerminal(
        parts[1],
        cursor,
        waitMs,
        terminalWaitSignal(req, res),
      );
      return output ? json(res, 200, output) : json(res, 404, { error: "Terminal session ended." });
    }
    if (parts.length === 3 && req.method === "POST") {
      const data = await body(req);
      if (parts[2] === "input") {
        if (typeof data.data !== "string" || !data.data.length || data.data.length > 8192)
          return json(res, 400, { error: "Invalid terminal input." });
        return terminal.writeTerminal(parts[1], data.data)
          ? json(res, 200, { ok: true })
          : json(res, 404, { error: "Terminal session ended." });
      }
      if (parts[2] === "resize") {
        const size = terminal.terminalSize(data.cols, data.rows);
        if (!size) return json(res, 400, { error: "Invalid terminal dimensions." });
        return terminal.resizeTerminal(parts[1], size)
          ? json(res, 200, { ok: true })
          : json(res, 404, { error: "Terminal session ended." });
      }
      if (parts[2] === "close")
        return terminal.closeTerminal(parts[1])
          ? json(res, 200, { ok: true })
          : json(res, 404, { error: "Terminal session ended." });
    }
    return json(res, 404, { error: "Not found." });
  }
  return ctx.handled || res.writableEnded;
}
// A browser disconnect ends the response before it is written. Waiting reads
// listen for that so a closed tab does not hold a PTY poll open.
function terminalWaitSignal(req, res) {
  if (req.signal) return req.signal;
  if (!res || typeof res.on !== "function") return undefined;
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}
