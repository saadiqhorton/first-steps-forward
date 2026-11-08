// Tool invocation and MCP protocol handling for ADE's agent computer.
import { SUPPORTED_PROTOCOLS, TOOLS } from "./computer-tool-schemas.mjs";

export { TOOLS } from "./computer-tool-schemas.mjs";

const ACTIONS = {
  computer_screenshot: (a) => ({ ...a, action: "screenshot" }),
  computer_open_url: (a) => ({ action: "open_url", url: a.url }),
  computer_click: (a) => ({ action: "click", x: a.x, y: a.y, button: a.button ?? "left" }),
  computer_double_click: (a) => ({ action: "double_click", x: a.x, y: a.y }),
  computer_move: (a) => ({ action: "move", x: a.x, y: a.y }),
  computer_drag: (a) => ({ action: "drag", x: a.x, y: a.y, to_x: a.to_x, to_y: a.to_y }),
  computer_type: (a) => ({ action: "type", text: a.text }),
  computer_key: (a) => ({ action: "key", keys: a.keys }),
  computer_scroll: (a) => ({ ...a, action: "scroll" }),
  computer_wait: (a) => ({ action: "wait", seconds: a.seconds ?? 1 }),
};
const BROWSER = {
  browser_status: () => ({ action: "status" }),
  browser_navigate: (a) => ({ action: "navigate", url: a.url }),
  browser_back: () => ({ action: "back" }),
  browser_forward: () => ({ action: "forward" }),
  browser_reload: () => ({ action: "reload" }),
  browser_snapshot: () => ({ action: "snapshot" }),
  browser_click: (a) => ({
    action: "click",
    ref: a.ref,
    button: a.button,
    double: a.double,
  }),
  browser_type: (a) => ({ action: "type", ref: a.ref, text: a.text, submit: a.submit }),
  browser_press: (a) => ({ action: "press", key: a.key }),
  browser_hover: (a) => ({ action: "hover", ref: a.ref }),
  browser_select: (a) => ({ action: "select", ref: a.ref, values: a.values }),
  browser_scroll: (a) => {
    // The schema default (deltaY 400) applies when no delta is given at all.
    const none = a.deltaX === undefined && a.deltaY === undefined;
    return { action: "scroll", ref: a.ref, deltaX: a.deltaX, deltaY: none ? 400 : a.deltaY };
  },
  browser_wait_for: (a) => ({ action: "wait_for", text: a.text, ref: a.ref, timeMs: a.timeMs }),
  browser_screenshot: () => ({ action: "screenshot" }),
  browser_upload: (a) => ({ action: "upload", paths: a.paths, ref: a.ref }),
  browser_dialog: (a) => ({ action: "dialog", accept: a.accept, promptText: a.promptText }),
};
const DEV = {
  dev_server_status: ["GET", ""],
  dev_server_start: ["POST", "/start"],
  dev_server_stop: ["POST", "/stop"],
};

const text = (value, isError = false) => ({
  content: [{ type: "text", text: value }],
  ...(isError ? { isError: true } : {}),
});

/**
 * @param {{ api: string, projectId: string, sessionId?: string, fetchImpl?: typeof fetch }} options
 *   sessionId: the ADE session whose turn runs these tools, so a dev command proposal waits for
 *   the user's answer in that session
 */
export function createToolCaller({ api, projectId, sessionId = "", fetchImpl = fetch }) {
  const base = `${api}/api/projects/${encodeURIComponent(projectId)}`;
  const scope = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
  async function call(method, url, body) {
    const response = await fetchImpl(url, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
      // First use may download the browser (a minute or two) and launch it.
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, payload };
  }
  return async function callTool(name, args = {}) {
    if (!api || !projectId)
      return text(
        "ADE's agent computer is not connected to this turn (unknown ADE URL or project). Tell the user to open ADE in the browser and retry.",
        true,
      );
    try {
      if (ACTIONS[name]) {
        const { status, payload } = await call(
          "POST",
          `${base}/computer/action${scope}`,
          ACTIONS[name](args),
        );
        if (status === 409 && payload.code === "human_control") return text(payload.error, true);
        if (payload.code === "browser_closed")
          return text(
            "The agent browser closed while this action was running. Start it again, then retry.",
            true,
          );
        if (status !== 200)
          return text(`Computer action failed: ${payload.error ?? `HTTP ${status}`}`, true);
        const where = payload.cursor ? ` Mouse at (${payload.cursor.x}, ${payload.cursor.y}).` : "";
        const done = `${name.replace("computer_", "")} done. Screen ${payload.width}×${payload.height}.${where}${payload.note ? `\n${payload.note}` : ""}`;
        // A JavaScript dialog blocks the page, so there is no screenshot until it is answered.
        if (!payload.screenshot) return text(done);
        return {
          content: [
            { type: "text", text: done },
            { type: "image", data: payload.screenshot, mimeType: payload.mimeType ?? "image/png" },
          ],
        };
      }
      if (BROWSER[name]) {
        const { status, payload } = await call(
          "POST",
          `${base}/browser/action${scope}`,
          BROWSER[name](args),
        );
        if (status === 409 && payload.code === "human_control") return text(payload.error, true);
        if (payload.code === "browser_closed")
          return text(
            "The agent browser closed while this action was running. Start it again, then retry.",
            true,
          );
        if (status !== 200)
          return text(`Browser action failed: ${payload.error ?? `HTTP ${status}`}`, true);
        if (payload.image)
          return {
            content: [
              { type: "text", text: payload.text ?? "Browser screenshot." },
              { type: "image", data: payload.image, mimeType: payload.mimeType ?? "image/png" },
            ],
          };
        return text(payload.text ?? `${name.replace("browser_", "")} done.`);
      }
      if (DEV[name]) {
        const [method, suffix] = DEV[name];
        // Start may long-poll while the user decides on a proposed command (up to 5 minutes).
        const proposal =
          name === "dev_server_start"
            ? {
                command: args.command,
                cwd: args.cwd,
                port: args.port,
                ...(sessionId ? { sessionId } : {}),
              }
            : undefined;
        const { status, payload } = await call(method, `${base}/dev${suffix}`, proposal);
        const port = payload.port > 0 ? payload.port : null;
        const summary =
          payload.status === "awaiting_approval"
            ? "Waiting for the user to approve this dev command in ADE."
            : port
              ? `Dev server ${payload.status} — open http://localhost:${port} with computer_open_url.`
              : `Dev server ${payload.status ?? "unknown"}.`;
        return text(`${summary}\n${JSON.stringify(payload)}`, status >= 400 && status !== 409);
      }
      return text(`Unknown tool: ${name}`, true);
    } catch (error) {
      return text(`Could not reach ADE at ${api}: ${error.message}`, true);
    }
  };
}

/** Handle one JSON-RPC message; returns the response object or null. */
export async function handleMessage(message, callTool) {
  const { id, method, params } = message ?? {};
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  if (id === undefined || id === null) return null; // notification
  if (method === "initialize") {
    const requested = params?.protocolVersion;
    return reply({
      protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
      capabilities: { tools: {} },
      serverInfo: { name: "ade-computer", version: "1.0.0" },
      instructions:
        "You have your own browser (headless Chrome on the user's machine) that the user watches live in ADE. Use it to view and manually test the project like a human QA tester.",
    });
  }
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: TOOLS });
  if (method === "tools/call") return reply(await callTool(params?.name, params?.arguments ?? {}));
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}
