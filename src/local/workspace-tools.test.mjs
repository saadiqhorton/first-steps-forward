import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS, runWorkspaceTool } from "./workspace-tools.mjs";

test("workspace tools list the projects and sessions the assistant can read", async () => {
  const state = {
    projects: [{ id: "web", name: "Web", path: "/tmp/web" }],
    sessions: [
      {
        id: "s1",
        projectId: "web",
        request: "Fix the login form",
        summary: "Ready for review",
        status: "ready",
        updatedAt: 10,
        messages: [{ role: "agent", text: "The form works." }],
      },
    ],
  };
  assert.deepEqual(await runWorkspaceTool("workspace_list_projects", {}, { state }), [
    { id: "web", name: "Web", path: "/tmp/web" },
  ]);
  const found = await runWorkspaceTool("workspace_search_sessions", { query: "login" }, { state });
  assert.equal(found[0].id, "s1");
  const read = await runWorkspaceTool("workspace_read_session", { sessionId: "s1" }, { state });
  assert.equal(read.messages.at(-1).text, "The form works.");
  await assert.rejects(
    runWorkspaceTool("workspace_search_sessions", { query: "" }, { state }),
    /search phrase/,
  );
  await assert.rejects(
    runWorkspaceTool("workspace_read_session", { sessionId: "nope" }, { state }),
    /not found/,
  );
});

test("actions that change work go through the host dispatcher, never a mock", async () => {
  const calls = [];
  const dispatchAction = async (name, args) => {
    calls.push([name, args]);
    return { ok: true };
  };
  const names = [
    "workspace_start_project",
    "workspace_message_session",
    "workspace_stop_session",
    "workspace_complete_session",
    "workspace_list_handoffs",
    "workspace_project_settings",
    "workspace_update_project_settings",
    "workspace_discover_projects",
    "workspace_add_project",
    "workspace_pin_project",
  ];
  for (const name of names) await runWorkspaceTool(name, { projectId: "web" }, { dispatchAction });
  assert.deepEqual(
    calls.map(([name]) => name),
    names,
  );
  await assert.rejects(runWorkspaceTool("workspace_start_project", {}, {}), /unavailable/);
});

test("every declared tool has a name, a description and an object schema", () => {
  const names = new Set();
  for (const tool of TOOLS) {
    assert.match(tool.name, /^workspace_[a-z_]+$/);
    assert.ok(tool.description.length > 10);
    assert.equal(tool.inputSchema.type, "object");
    assert.ok(!names.has(tool.name), `duplicate tool ${tool.name}`);
    names.add(tool.name);
  }
});
