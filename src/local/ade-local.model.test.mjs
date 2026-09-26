import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the service at a throwaway HOME *before* importing it, so load()/save()
// touch only the temp workspace and no CLI is ever spawned by these tests.
const home = mkdtempSync(path.join(os.tmpdir(), "ade-home-"));
mkdirSync(path.join(home, ".ade"), { mode: 0o700 });
const workspaceFile = path.join(home, ".ade", "workspace.json");
const seedSession = (id, status) => ({
  id,
  projectId: "p1",
  agentId: "codex",
  createdBy: "codex",
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
    projects: [],
    sessions: [seedSession("s-ready", "ready"), seedSession("s-done", "complete")],
    processes: [],
  }),
);
process.env.HOME = home;
const { handleLocalApi } = await import("./ade-local.mjs");

const apiRequest = (urlPath, body) => ({
  url: `http://127.0.0.1:3000${urlPath}`,
  method: "POST",
  headers: { entries: () => [["host", "127.0.0.1:3000"]] },
  text: async () => JSON.stringify(body ?? {}),
});
const call = async (urlPath, body) => {
  const res = await handleLocalApi(apiRequest(urlPath, body));
  return { status: res.status, json: await res.json() };
};

test("session creation rejects a flag-like model id with 400 before any spawn", async () => {
  const res = await call("/api/sessions", {
    projectId: "p1",
    agentId: "codex",
    request: "do something",
    model: "--evil",
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /start with a letter or digit/);
});

test("set-model sanitizes, applies, clears, and respects completed sessions", async () => {
  const bad = await call("/api/sessions/s-ready/model", { model: "no spaces allowed" });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /start with a letter or digit/);

  const set = await call("/api/sessions/s-ready/model", { model: "opencode-go/gpt-5.6-luna" });
  assert.equal(set.status, 200);
  // Response carries both old and new effective values.
  assert.equal(set.json.previousModel, null);
  assert.equal(set.json.model, "opencode-go/gpt-5.6-luna");
  assert.equal(set.json.messages.at(-1).role, "system");
  assert.match(set.json.messages.at(-1).text, /applies from the next CLI turn/);
  const persisted = JSON.parse(readFileSync(workspaceFile, "utf8"));
  assert.equal(
    persisted.sessions.find((s) => s.id === "s-ready").model,
    "opencode-go/gpt-5.6-luna",
  );

  // Same value again: no duplicate system message.
  const again = await call("/api/sessions/s-ready/model", { model: "opencode-go/gpt-5.6-luna" });
  assert.equal(again.status, 200);
  assert.equal(again.json.messages.length, 1);

  // null clears back to the agent default (absent field means default).
  const cleared = await call("/api/sessions/s-ready/model", { model: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.model, null);
  assert.equal(cleared.json.previousModel, "opencode-go/gpt-5.6-luna");
  assert.equal(cleared.json.messages.length, 2);

  const done = await call("/api/sessions/s-done/model", { model: "gpt-5.5" });
  assert.equal(done.status, 409);
  assert.match(done.json.error, /Reopen this session before changing its model/);

  const missing = await call("/api/sessions/nope/model", { model: "gpt-5.5" });
  assert.equal(missing.status, 404);
});

test("unknown agents have no model listing", async () => {
  const res = await handleLocalApi({
    url: "http://127.0.0.1:3000/api/agents/claudette/models",
    method: "GET",
    headers: { entries: () => [["host", "127.0.0.1:3000"]] },
    text: async () => "",
  });
  assert.equal(res.status, 404);
});

test("loopback guard still rejects non-local hosts", async () => {
  const res = await handleLocalApi({
    url: "http://example.com/api/sessions/s-ready/model",
    method: "POST",
    headers: { entries: () => [["host", "example.com"]] },
    text: async () => "{}",
  });
  assert.equal(res.status, 403);
});
