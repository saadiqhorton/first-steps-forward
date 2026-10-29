import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(os.tmpdir(), "ade-att-api-"));
mkdirSync(path.join(home, ".ade"), { mode: 0o700 });
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
    harness: { install: "npm install -g @openai/codex", update: "codex update" },
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
    models: [{ id: "gpt-5.5", efforts: ["low"], defaultEffort: "low", speeds: ["fast"] }],
    source: "live",
    command: "codex debug models",
  }),
);
writeFileSync(
  path.join(home, ".ade", "workspace.json"),
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
    sessions: [],
    processes: [],
    workflows: [],
  }),
);

process.env.HOME = home;
// os.homedir() reads USERPROFILE on Windows, not HOME; without this the
// tests would write into the real ~/.ade workspace.
process.env.USERPROFILE = home;

const { handleLocalApi, _setAgentsForTest } = await import("./ade-local.mjs");
_setAgentsForTest(seedAgents);

const callJson = async (urlPath, body) => {
  const method = body === undefined ? "GET" : "POST";
  const req = {
    url: `http://127.0.0.1:3000${urlPath}`,
    method,
    headers: { entries: () => [["host", "127.0.0.1:3000"]] },
    runtime: { node: { req: { socket: { remoteAddress: "::ffff:127.0.0.1" } } } },
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  };
  const res = await handleLocalApi(req);
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return { status: res.status, json: await res.json(), bytes: null };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, json: null, bytes: buf, contentType: ct };
};

test("POST /api/attachments uploads and GET returns bytes", async () => {
  const payload = Buffer.from("attachment bytes");
  const created = await callJson("/api/attachments", {
    name: "note.txt",
    mime: "text/plain",
    contentBase64: payload.toString("base64"),
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.name, "note.txt");
  assert.equal(created.json.kind, "file");
  assert.ok(created.json.id);

  const got = await callJson(`/api/attachments/${created.json.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.bytes.toString(), "attachment bytes");
  assert.match(got.contentType, /text\/plain/);
});

test("POST /api/attachments rejects empty and oversize uploads", async () => {
  const empty = await callJson("/api/attachments", {
    name: "empty.txt",
    mime: "text/plain",
    contentBase64: Buffer.alloc(0).toString("base64"),
  });
  assert.equal(empty.status, 400);

  const big = await callJson("/api/attachments", {
    name: "big.bin",
    mime: "application/octet-stream",
    contentBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64"),
  });
  assert.equal(big.status, 400);
});

test("session create stores attachment metadata without paths in message text", async () => {
  const file = await callJson("/api/attachments", {
    name: "pic.png",
    mime: "image/png",
    contentBase64: Buffer.from("png").toString("base64"),
  });
  assert.equal(file.status, 201);

  const created = await callJson("/api/sessions", {
    projectId: "p1",
    agentId: "codex",
    request: "review this screenshot",
    criteria: "",
    attachmentIds: [file.json.id],
  });
  assert.equal(created.status, 201);
  const msg = created.json.messages[0];
  assert.equal(msg.text, "review this screenshot");
  assert.equal(msg.attachments?.length, 1);
  assert.equal(msg.attachments[0].name, "pic.png");
  assert.ok(!msg.text.includes(".ade/attachments"));

  await callJson(`/api/sessions/${created.json.id}/stop`, {});
});

test("follow-up message attaches metadata", async () => {
  const created = await callJson("/api/sessions", {
    projectId: "p1",
    agentId: "codex",
    request: "first task here",
    criteria: "",
  });
  assert.equal(created.status, 201);
  await callJson(`/api/sessions/${created.json.id}/stop`, {});

  const file = await callJson("/api/attachments", {
    name: "log.txt",
    mime: "text/plain",
    contentBase64: Buffer.from("log").toString("base64"),
  });
  const follow = await callJson(`/api/sessions/${created.json.id}/messages`, {
    text: "also read this log",
    attachmentIds: [file.json.id],
  });
  assert.equal(follow.status, 200);
  const userMsgs = follow.json.messages.filter((m) => m.role === "user");
  const last = userMsgs.at(-1);
  assert.equal(last.text, "also read this log");
  assert.equal(last.attachments?.[0]?.name, "log.txt");

  await callJson(`/api/sessions/${created.json.id}/stop`, {});
});

// On exit, not in test.after(): ADE's last workspace save can land after the tests end.
process.once("exit", () => rmSync(home, { recursive: true, force: true }));
