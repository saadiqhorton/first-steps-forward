import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(os.tmpdir(), "ade-enjoy-"));
mkdirSync(path.join(home, ".ade"), { mode: 0o700 });
const workspaceFile = path.join(home, ".ade", "workspace.json");
const projectDir = path.join(home, "proj");
mkdirSync(projectDir);
writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "proj" }));

const seedAgents = [
  {
    id: "codex",
    name: "OpenAI Codex",
    short: "Codex",
    tools: "tools",
    authMethod: "x",
    authNote: "x",
    installHint: "x",
    installed: true,
    version: "1.0.0",
    signedIn: true,
    carriesConversation: true,
    installMethod: "other",
    installPath: "/opt/codex/bin/codex",
    harness: {
      install: "npm install -g @openai/codex",
      update: "codex update",
    },
  },
  {
    id: "opencode",
    name: "OpenCode",
    short: "OpenCode",
    tools: "tools",
    authMethod: "x",
    authNote: "x",
    installHint: "x",
    installed: false,
    signedIn: false,
    carriesConversation: true,
    installMethod: "missing",
    harness: {
      install: "npm install -g opencode-ai",
      update: "opencode upgrade --method npm",
    },
  },
  {
    id: "pi",
    name: "Pi",
    short: "Pi",
    tools: "tools",
    authMethod: "x",
    authNote: "x",
    installHint: "x",
    installed: true,
    version: "0.1.0",
    signedIn: true,
    carriesConversation: true,
    installMethod: "npm",
    installPath: "/usr/lib/node_modules/@earendil-works/pi-coding-agent/bin/pi",
    harness: {
      install: "npm install -g --ignore-scripts @earendil-works/pi-coding-agent",
      update: "pi update --self",
    },
  },
];

writeFileSync(
  path.join(home, ".ade", "agents-status.json"),
  JSON.stringify({ fetchedAt: Date.now(), agents: seedAgents }),
);
writeFileSync(
  path.join(home, ".ade", "models-cache-codex.json"),
  JSON.stringify({
    version: 3,
    fingerprint: "codex|1.0.0",
    fetchedAt: Date.now(),
    models: [
      {
        id: "gpt-5.5",
        efforts: ["low", "medium", "high"],
        defaultEffort: "medium",
        speeds: ["fast"],
      },
    ],
    source: "live",
    command: "codex debug models",
  }),
);

const seedSession = (id, status, agentId = "codex") => ({
  id,
  projectId: "p1",
  agentId,
  createdBy: agentId,
  request: "task",
  criteria: "",
  status,
  messages: [],
  changes: [],
  checks: [],
  logs: [],
  createdAt: 1,
  updatedAt: 1,
});

writeFileSync(
  workspaceFile,
  JSON.stringify({
    projects: [
      {
        id: "p1",
        name: "proj",
        path: projectDir,
        branch: "not a git repository",
        ahead: 0,
        uncommittedFiles: [],
        defaultAgent: "codex",
        addedAt: 1,
      },
    ],
    sessions: [
      seedSession("s-ready", "ready"),
      seedSession("s-done", "complete"),
      seedSession("s-working", "working"),
      seedSession("s-oc-working", "working", "opencode"),
    ],
    processes: [],
    workflows: [],
  }),
);
process.env.HOME = home;

const { handleLocalApi, agentCommand, _setAgentsForTest, _setSessionStatusForTest } =
  await import("./ade-local.mjs");

const apiRequest = (urlPath, body, remoteAddress = "::ffff:127.0.0.1") => ({
  url: `http://127.0.0.1:3000${urlPath}`,
  method: body === undefined ? "GET" : "POST",
  headers: { entries: () => [["host", "127.0.0.1:3000"]] },
  runtime: { node: { req: { socket: { remoteAddress } } } },
  text: async () => JSON.stringify(body ?? {}),
});
const call = async (urlPath, body, remoteAddress) => {
  const res = await handleLocalApi(apiRequest(urlPath, body, remoteAddress));
  return { status: res.status, json: await res.json() };
};

// Pin seeded agents so background CLI probes cannot race the route assertions.
// load() marks interrupted working sessions as stopped — restore the ones the
// harness busy test needs.
_setAgentsForTest(seedAgents);
_setSessionStatusForTest("s-working", "working");
_setSessionStatusForTest("s-oc-working", "working");

test("session created with options stores them and maps flags onto the CLI argv", async () => {
  _setAgentsForTest(seedAgents);
  // Clear project-busy working sessions so creation is allowed.
  _setSessionStatusForTest("s-working", "ready");
  _setSessionStatusForTest("s-oc-working", "ready");
  const created = await call("/api/sessions", {
    projectId: "p1",
    agentId: "codex",
    request: "build a quiet landing page",
    criteria: "",
    model: "gpt-5.5",
    effort: "high",
    speed: "fast",
    permission: "plan",
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.effort, "high");
  assert.equal(created.json.speed, "fast");
  assert.equal(created.json.permission, "plan");
  assert.equal(created.json.model, "gpt-5.5");

  const project = { path: projectDir };
  const [, args] = agentCommand(created.json, project, "prompt text", false);
  assert.ok(args.includes("-m"));
  assert.ok(args.includes("gpt-5.5"));
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.ok(args.includes('service_tier="fast"'));
  assert.ok(args.includes("read-only"));
  // Stop the spawned turn so later tests aren't blocked.
  await call(`/api/sessions/${created.json.id}/stop`, {});
  _setSessionStatusForTest("s-working", "working");
  _setSessionStatusForTest("s-oc-working", "working");
});

test("session creation rejects an invalid effort with 400", async () => {
  _setAgentsForTest(seedAgents);
  _setSessionStatusForTest("s-working", "ready");
  _setSessionStatusForTest("s-oc-working", "ready");
  const res = await call("/api/sessions", {
    projectId: "p1",
    agentId: "codex",
    request: "build something nice",
    model: "gpt-5.5",
    effort: "ultra",
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /effort/i);
  _setSessionStatusForTest("s-working", "working");
  _setSessionStatusForTest("s-oc-working", "working");
});

test("options endpoint refuses completed sessions with 409", async () => {
  const res = await call("/api/sessions/s-done/options", {
    effort: "high",
    model: "gpt-5.5",
  });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /Reopen this session before changing/i);
});

test("options endpoint updates next-turn fields on a ready session", async () => {
  const res = await call("/api/sessions/s-ready/options", {
    model: "gpt-5.5",
    effort: "low",
    permission: "plan",
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.effort, "low");
  assert.equal(res.json.permission, "plan");
  assert.equal(res.json.model, "gpt-5.5");
  const persisted = JSON.parse(readFileSync(workspaceFile, "utf8"));
  const session = persisted.sessions.find((s) => s.id === "s-ready");
  assert.equal(session.effort, "low");
  assert.equal(session.permission, "plan");
});

test("agent capabilities endpoint returns optionCapabilities for a model", async () => {
  const res = await call("/api/agents/codex/capabilities?model=gpt-5.5");
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.efforts, ["low", "medium", "high"]);
  assert.deepEqual(res.json.speeds, ["fast"]);
  assert.deepEqual(res.json.permissions, ["build", "plan"]);
  assert.ok(res.json.permissionNotes.build);
  assert.ok(res.json.permissionNotes.plan);
});

test("harness update is 409 when the agent was installed outside npm", async () => {
  _setAgentsForTest(seedAgents);
  _setSessionStatusForTest("s-working", "ready");
  const res = await call("/api/agents/codex/update", {});
  assert.equal(res.status, 409);
  assert.match(res.json.error, /Installed outside npm at \/opt\/codex\/bin\/codex/);
  _setSessionStatusForTest("s-working", "working");
});

test("harness routes refuse non-loopback peers with 403", async () => {
  for (const pathSuffix of ["install", "update", "harness"]) {
    const res = await handleLocalApi({
      url: `http://127.0.0.1:3000/api/agents/opencode/${pathSuffix}`,
      method: pathSuffix === "harness" ? "GET" : "POST",
      headers: { entries: () => [["host", "127.0.0.1:3000"]] },
      runtime: { node: { req: { socket: { remoteAddress: "203.0.113.8" } } } },
      text: async () => "{}",
    });
    assert.equal(res.status, 403, `${pathSuffix} should be loopback-only`);
  }
});

test("harness install is 409 while that agent has a working/verifying session", async () => {
  _setAgentsForTest(seedAgents);
  _setSessionStatusForTest("s-oc-working", "working");
  const res = await call("/api/agents/opencode/install", {});
  assert.equal(res.status, 409);
  assert.match(res.json.error, /running|working|verifying|task/i);
});

test("workflows CRUD round-trip persists to the workspace file", async () => {
  const listed = await call("/api/workflows");
  assert.equal(listed.status, 200);
  assert.ok(Array.isArray(listed.json.workflows));
  assert.ok(listed.json.workflows.some((w) => w.id === "builtin-design-workshop"));

  const created = await call("/api/workflows", {
    name: "Ship notes",
    description: "Draft release notes",
    prompt: "Write release notes for the latest changes.",
    permission: "plan",
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.workflow.name, "Ship notes");
  assert.equal(created.json.workflow.builtIn, false);
  assert.match(created.json.workflow.id, /^wf-/);

  const updated = await call(`/api/workflows/${created.json.workflow.id}`, {
    name: "Ship notes v2",
    description: "Draft release notes",
    prompt: "Write tighter release notes.",
    permission: "plan",
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.workflow.name, "Ship notes v2");

  const persisted = JSON.parse(readFileSync(workspaceFile, "utf8"));
  assert.ok(Array.isArray(persisted.workflows));
  assert.equal(persisted.workflows.length, 1);
  assert.equal(persisted.workflows[0].name, "Ship notes v2");

  const deleted = await call(`/api/workflows/${created.json.workflow.id}/delete`, {});
  assert.equal(deleted.status, 200);
  const after = JSON.parse(readFileSync(workspaceFile, "utf8"));
  assert.equal(after.workflows.length, 0);
});

test("documents endpoint lists fixture Markdown files", async () => {
  mkdirSync(path.join(projectDir, "docs"), { recursive: true });
  const readme = path.join(projectDir, "README.md");
  const guide = path.join(projectDir, "docs", "guide.md");
  writeFileSync(readme, "# readme\n");
  writeFileSync(guide, "# guide\n");
  const tReadme = new Date("2024-01-01T00:00:00Z");
  const tGuide = new Date("2024-06-01T00:00:00Z");
  utimesSync(readme, tReadme, tReadme);
  utimesSync(guide, tGuide, tGuide);

  const res = await call("/api/editor/p1/documents");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json.documents));
  assert.deepEqual(
    res.json.documents.map((d) => d.path),
    ["docs/guide.md", "README.md"],
  );
  assert.equal(res.json.documents[0].name, "guide.md");
});

test.after(() => rmSync(home, { recursive: true, force: true }));
