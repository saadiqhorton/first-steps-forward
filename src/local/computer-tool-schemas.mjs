// Tool schemas exposed by the computer MCP server, Pi extension and adapters.
import { DEFAULT_VIEWPORT } from "../shared/browser-contract.mjs";

export const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const xy = {
  x: {
    type: "integer",
    description: `X pixel (0 = left edge of the ${DEFAULT_VIEWPORT.width}×${DEFAULT_VIEWPORT.height} page)`,
  },
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
    description: `Report the agent browser's tab: URL, title, loading and history state. ${LIVE_NOTE}`,
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
    name: "browser_upload",
    description: `Choose files for an upload: pass the file input's ref, or answer the file picker a click opened. Paths must be absolute files on this machine. ${LIVE_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "Absolute file paths" },
        ref,
      },
      required: ["paths"],
    },
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
    description: `Capture the agent browser's page (${DEFAULT_VIEWPORT.width}×${DEFAULT_VIEWPORT.height}). The user watches this browser live in ADE. Call this first to see the current state.`,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "computer_open_url",
    description:
      "Open a URL in the agent browser and return a screenshot. The browser runs on this machine, so localhost URLs reach this project's dev server directly — start it with dev_server_start and open the URL it reports.",
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
      'Press a key or chord in the page (xdotool names), e.g. "Return", "Tab", "Escape", "ctrl+a", "shift+Tab", "BackSpace". Several keys in order: "Tab Tab Return". The browser has no address bar; change pages with computer_open_url. Returns a screenshot.',
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
      "Start this project's dev server through ADE and wait until its port accepts connections. With a package.json dev script, call it with no arguments (ADE re-scans package.json first). Without one, pass command (one program and its arguments, no shell operators) and cwd; ADE asks the user to approve the command once, then reuses it on later starts. Never start a server yourself with nohup/&.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            'Only when there is no package.json dev script: the program and its arguments, e.g. "pyxplain-ui" or "uvicorn app:app --port {port}". {port} becomes the port ADE picks, which is also in PORT (HOST is 127.0.0.1).',
        },
        cwd: {
          type: "string",
          description: 'The folder it runs in, relative to the project root (default ".")',
        },
        port: {
          type: "integer",
          description:
            "Only for an app that always listens on this fixed port and ignores PORT and {port}",
        },
      },
    },
  },
  {
    name: "dev_server_stop",
    description: "Stop this project's dev server.",
    inputSchema: { type: "object", properties: {} },
  },
  ...BROWSER_TOOLS,
];
