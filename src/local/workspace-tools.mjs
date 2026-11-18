const clip = (value, limit = 1200) => String(value ?? "").slice(0, limit);
export const TOOLS = [
  {
    name: "workspace_list_projects",
    description: "List registered projects with names and paths.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "workspace_search_sessions",
    description: "Search bounded session summaries and messages.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "workspace_read_session",
    description: "Read recent evidence from one session without sending it a message.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
    },
  },
  {
    name: "workspace_start_project",
    description: "Start one normal ADE task in a named registered project.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, request: { type: "string" } },
      required: ["projectId", "request"],
    },
  },
  {
    name: "workspace_message_session",
    description: "Send a follow-up to a named existing ADE session.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" }, text: { type: "string" } },
      required: ["sessionId", "text"],
    },
  },
  {
    name: "workspace_stop_session",
    description: "Stop a running ADE session by ID.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
    },
  },
  {
    name: "workspace_complete_session",
    description:
      "Complete a ready ADE session after checking it has no pending approval or question.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
    },
  },
  {
    name: "workspace_list_handoffs",
    description: "List cross-project handoffs and returned answers for this conversation.",
    inputSchema: { type: "object", properties: { status: { type: "string" } } },
  },
  {
    name: "workspace_project_settings",
    description: "Read one project's ADE-managed instructions, color, icon and revision.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "workspace_update_project_settings",
    description: "Change project instructions, color or icon using the revision you just read.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        expectedRevision: { type: "number" },
        instructions: { type: "string" },
        color: { type: "string" },
        icon: { type: "string" },
      },
      required: ["projectId", "expectedRevision"],
    },
  },
  {
    name: "workspace_discover_projects",
    description: "List folders under a local path that could be added as projects.",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
  },
  {
    name: "workspace_add_project",
    description: "Register one existing local folder as an ADE project.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, name: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "workspace_pin_project",
    description: "Pin or unpin a registered project in the workspace.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, pinned: { type: "boolean" } },
      required: ["projectId"],
    },
  },
];

/** Read-only tools are safe to expose wherever an adapter supports structured tool calling. */
export async function runWorkspaceTool(name, args = {}, context = {}) {
  const { state = { projects: [], sessions: [] } } = context;
  if (name === "workspace_list_projects")
    return state.projects.map(({ id, name, path }) => ({ id, name, path })).slice(0, 100);
  if (name === "workspace_search_sessions") {
    const q = clip(args.query, 160).trim().toLowerCase();
    if (!q) throw new Error("Enter a search phrase.");
    return state.sessions
      .filter((s) =>
        [s.request, s.summary, ...(s.messages ?? []).map((m) => m.text)]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 20)
      .map((s) => ({
        id: s.id,
        projectId: s.projectId,
        request: clip(s.request, 300),
        summary: clip(s.summary, 500),
        status: s.status,
        updatedAt: s.updatedAt,
      }));
  }
  if (name === "workspace_read_session") {
    const session = state.sessions.find((s) => s.id === args.sessionId);
    if (!session) throw new Error("Session not found.");
    return {
      id: session.id,
      projectId: session.projectId,
      status: session.status,
      request: clip(session.request, 700),
      summary: clip(session.summary, 900),
      messages: (session.messages ?? [])
        .slice(-8)
        .map((m) => ({ role: m.role, at: m.at, text: clip(m.text, 700) })),
      pendingPermissions: context.pendingPermissions?.(session.id) ?? [],
    };
  }
  if (
    name === "workspace_start_project" ||
    name === "workspace_message_session" ||
    name === "workspace_stop_session" ||
    name === "workspace_complete_session" ||
    name === "workspace_list_handoffs" ||
    name === "workspace_project_settings" ||
    name === "workspace_update_project_settings" ||
    name === "workspace_discover_projects" ||
    name === "workspace_add_project" ||
    name === "workspace_pin_project"
  ) {
    if (!context.dispatchAction) throw new Error("This workspace action is unavailable.");
    return context.dispatchAction(name, args);
  }
  if (context.dispatchAction) return context.dispatchAction(name, args);
  throw new Error(`Unsupported workspace tool: ${name}`);
}

/** Minimal stdio MCP transport for ACP adapters; every call is authorized by a one-turn host capability. */
if (
  process.argv[1] &&
  decodeURIComponent(import.meta.url) === `file://${process.argv[1]}` &&
  process.env.ADE_WORKSPACE_TOOL_URL
) {
  let buffer = "";
  const reply = (id, result, error) =>
    process.stdout.write(
      JSON.stringify(
        error
          ? { jsonrpc: "2.0", id, error: { code: -32000, message: String(error) } }
          : { jsonrpc: "2.0", id, result },
      ) + "\n",
    );
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (!line.trim()) continue;
      void (async () => {
        let msg;
        try {
          msg = JSON.parse(line);
          if (msg.method === "initialize")
            return reply(msg.id, {
              protocolVersion: msg.params?.protocolVersion ?? "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "ade-workspace", version: "1" },
            });
          if (msg.method === "notifications/initialized") return;
          if (msg.method === "tools/list")
            return reply(msg.id, {
              tools: TOOLS.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
            });
          if (msg.method === "tools/call") {
            const response = await fetch(process.env.ADE_WORKSPACE_TOOL_URL, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${process.env.ADE_WORKSPACE_TOOL_TOKEN}`,
              },
              body: JSON.stringify({
                threadId: process.env.ADE_WORKSPACE_THREAD_ID,
                name: msg.params?.name,
                arguments: msg.params?.arguments ?? {},
              }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error ?? "Workspace action failed.");
            return reply(msg.id, {
              content: [{ type: "text", text: JSON.stringify(data) }],
              structuredContent: data,
            });
          }
          if (msg.id !== undefined) return reply(msg.id, {});
        } catch (error) {
          if (msg?.id !== undefined) reply(msg.id, null, error.message);
        }
      })();
    }
  });
}
