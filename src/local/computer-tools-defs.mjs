// Tool definitions and call logic ADE's agent computer exposes to coding
// agents (Codex, OpenCode via MCP; Pi via its extension). Kept in this
// shebang-free module so Vite's SSR transform can import it — the executable
// stdio entry lives in computer-mcp.mjs. ADE injects ADE_API (the serving
// ADE instance's loopback base URL) and ADE_PROJECT_ID alongside it. MCP
// servers run outside Codex's workspace-write sandbox, so these calls work
// where shell curls to the loopback API could be blocked. Plain Node, no
// dependencies.
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const xy = {
  x: { type: "integer", description: "X pixel (0 = left edge of the 1280×800 screen)" },
  y: { type: "integer", description: "Y pixel (0 = top edge)" },
};
export const TOOLS = [
  {
    name: "computer_screenshot",
    description:
      "Capture the agent computer's screen (1280×800). The user watches this computer live in ADE. Call this first to see the current state.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "computer_open_url",
    description:
      "Open a URL in the computer's Chromium browser (new tab) and return a screenshot. localhost URLs reach this project's dev server on the host automatically — start it with dev_server_start and open the URL it reports.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "http(s) URL, e.g. http://localhost:5173" },
      },
      required: ["url"],
    },
  },
  {
    name: "computer_click",
    description: "Move the mouse to (x, y) and click. Returns a screenshot of the result.",
    inputSchema: {
      type: "object",
      properties: {
        ...xy,
        button: { type: "string", enum: ["left", "middle", "right"], default: "left" },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "computer_double_click",
    description: "Double-click at (x, y). Returns a screenshot.",
    inputSchema: { type: "object", properties: xy, required: ["x", "y"] },
  },
  {
    name: "computer_move",
    description: "Move the mouse to (x, y) without clicking (hover). Returns a screenshot.",
    inputSchema: { type: "object", properties: xy, required: ["x", "y"] },
  },
  {
    name: "computer_drag",
    description: "Press at (x, y), drag to (to_x, to_y), release. Returns a screenshot.",
    inputSchema: {
      type: "object",
      properties: {
        ...xy,
        to_x: { type: "integer" },
        to_y: { type: "integer" },
      },
      required: ["x", "y", "to_x", "to_y"],
    },
  },
  {
    name: "computer_type",
    description:
      "Type text with the keyboard into the focused element. Click a field first. Returns a screenshot.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "computer_key",
    description:
      'Press a key or chord (xdotool names), e.g. "Return", "Tab", "Escape", "ctrl+l", "ctrl+shift+r", "BackSpace". Several keys in order: "Tab Tab Return". Returns a screenshot.',
    inputSchema: {
      type: "object",
      properties: { keys: { type: "string" } },
      required: ["keys"],
    },
  },
  {
    name: "computer_scroll",
    description: "Scroll at (x, y) (or wherever the mouse is). Returns a screenshot.",
    inputSchema: {
      type: "object",
      properties: {
        ...xy,
        direction: { type: "string", enum: ["up", "down", "left", "right"], default: "down" },
        amount: { type: "integer", description: "Wheel clicks, 1–20", default: 3 },
      },
    },
  },
  {
    name: "computer_wait",
    description: "Wait up to 10 seconds (for loading/animations), then return a screenshot.",
    inputSchema: {
      type: "object",
      properties: { seconds: { type: "number", default: 1 } },
    },
  },
  {
    name: "dev_server_status",
    description: "Report this project's dev server: status (starting/running/stopped) and port.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "dev_server_start",
    description:
      "Start this project's dev server through ADE (re-scans package.json first) and wait until its port accepts connections. Never start a server yourself with nohup/&.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "dev_server_stop",
    description: "Stop this project's dev server.",
    inputSchema: { type: "object", properties: {} },
  },
];

const ACTIONS = {
  computer_screenshot: (a) => ({ action: "screenshot", ...a }),
  computer_open_url: (a) => ({ action: "open_url", url: a.url }),
  computer_click: (a) => ({ action: "click", x: a.x, y: a.y, button: a.button ?? "left" }),
  computer_double_click: (a) => ({ action: "double_click", x: a.x, y: a.y }),
  computer_move: (a) => ({ action: "move", x: a.x, y: a.y }),
  computer_drag: (a) => ({ action: "drag", x: a.x, y: a.y, to_x: a.to_x, to_y: a.to_y }),
  computer_type: (a) => ({ action: "type", text: a.text }),
  computer_key: (a) => ({ action: "key", keys: a.keys }),
  computer_scroll: (a) => ({ action: "scroll", ...a }),
  computer_wait: (a) => ({ action: "wait", seconds: a.seconds ?? 1 }),
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

export function createToolCaller({ api, projectId, fetchImpl = fetch }) {
  const base = `${api}/api/projects/${encodeURIComponent(projectId)}`;
  async function call(method, url, body) {
    const response = await fetchImpl(url, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
      // First use may build the computer image (minutes) and boot it.
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
          `${base}/computer/action`,
          ACTIONS[name](args),
        );
        if (status !== 200 || !payload.screenshot)
          return text(`Computer action failed: ${payload.error ?? `HTTP ${status}`}`, true);
        const where = payload.cursor ? ` Mouse at (${payload.cursor.x}, ${payload.cursor.y}).` : "";
        return {
          content: [
            {
              type: "text",
              text: `${name.replace("computer_", "")} done. Screen ${payload.width}×${payload.height}.${where}`,
            },
            { type: "image", data: payload.screenshot, mimeType: payload.mimeType ?? "image/png" },
          ],
        };
      }
      if (DEV[name]) {
        const [method, suffix] = DEV[name];
        const { status, payload } = await call(method, `${base}/dev${suffix}`);
        const port = payload.port > 0 ? payload.port : null;
        const summary = port
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
        "You have your own computer (a Linux desktop with Chromium) that the user watches live in ADE. Use it to view and manually test the project like a human QA tester.",
    });
  }
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: TOOLS });
  if (method === "tools/call") return reply(await callTool(params?.name, params?.arguments ?? {}));
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}