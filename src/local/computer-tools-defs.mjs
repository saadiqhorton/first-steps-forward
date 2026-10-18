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
const LIVE_NOTE =
  "The user watches this browser live in ADE and may take control; then calls fail with a human_control error. Wait and retry.";
const ref = {
  type: "string",
  description: "Element ref exactly as browser_snapshot prints it, e.g. 1-e12 from [ref=1-e12]",
};
const BROWSER_TOOLS = [
  {
    name: "browser_status",
    description: `Report the computer's Chromium tab: URL, title, loading and history state. ${LIVE_NOTE}`,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_navigate",
    description: `Open a URL in the current tab and wait for it to load. ${LIVE_NOTE}`,
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "http(s) URL" } },
      required: ["url"],
    },
  },
  {
    name: "browser_back",
    description: `Go back in the tab's history. ${LIVE_NOTE}`,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_forward",
    description: `Go forward in the tab's history. ${LIVE_NOTE}`,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_reload",
    description: `Reload the current page. ${LIVE_NOTE}`,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_snapshot",
    description: `Return the page's accessibility tree with element refs (e.g. [ref=1-e12]; pass the ref string as printed, prefix included). Use these refs with browser_click, browser_type, browser_hover, browser_select, browser_scroll and browser_wait_for. Refs go stale after the page changes, so snapshot again. ${LIVE_NOTE}`,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_click",
    description: `Click an element by ref from browser_snapshot. ${LIVE_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        ref,
        button: { type: "string", enum: ["left", "middle", "right"], default: "left" },
        double: { type: "boolean", description: "Double-click", default: false },
      },
      required: ["ref"],
    },
  },
  {
    name: "browser_type",
    description: `Type text into an element by ref. Set submit to press Enter afterwards. ${LIVE_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        ref,
        text: { type: "string" },
        submit: { type: "boolean", default: false },
      },
      required: ["ref", "text"],
    },
  },
  {
    name: "browser_press",
    description: `Press a key in the page, e.g. "Enter", "Escape", "ArrowDown", "Control+a". ${LIVE_NOTE}`,
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  {
    name: "browser_hover",
    description: `Move the mouse over an element by ref. ${LIVE_NOTE}`,
    inputSchema: { type: "object", properties: { ref }, required: ["ref"] },
  },
  {
    name: "browser_select",
    description: `Choose option(s) in a <select> by ref. ${LIVE_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        ref,
        values: { type: "array", items: { type: "string" } },
      },
      required: ["ref", "values"],
    },
  },
  {
    name: "browser_scroll",
    description: `Scroll the page, or the element with ref if given. Deltas are in CSS pixels. ${LIVE_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        ref,
        deltaX: { type: "number", default: 0 },
        deltaY: { type: "number", default: 400 },
      },
    },
  },
  {
    name: "browser_wait_for",
    description: `Wait until text appears, an element ref appears, or a fixed time passes. Give one of text, ref or timeMs. ${LIVE_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        ref,
        timeMs: { type: "integer", description: "Milliseconds to wait" },
      },
    },
  },
  {
    name: "browser_screenshot",
    description: `Capture the browser viewport as an image. ${LIVE_NOTE}`,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_dialog",
    description: `Accept or dismiss the open JavaScript dialog (alert, confirm, prompt). ${LIVE_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        accept: { type: "boolean" },
        promptText: { type: "string", description: "Answer for a prompt() dialog" },
      },
      required: ["accept"],
    },
  },
];
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
  ...BROWSER_TOOLS,
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
// browser_* tools POST {action: <short name>, ...args} to /browser/action.
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
        if (status === 409 && payload.code === "human_control") return text(payload.error, true);
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
      if (BROWSER[name]) {
        const { status, payload } = await call(
          "POST",
          `${base}/browser/action`,
          BROWSER[name](args),
        );
        if (status === 409 && payload.code === "human_control") return text(payload.error, true);
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
