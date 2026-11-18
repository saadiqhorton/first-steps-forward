import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { json } from "./http.mjs";
import { createWorkspaceOrganization } from "./workspace-organization.mjs";
import { workspaceOrganization } from "./routes/workspaceOrganization.mjs";

function request(method, url, data = {}) {
  const req = Readable.from(method === "GET" || method === "DELETE" ? [] : [JSON.stringify(data)]);
  req.method = method;
  req.url = url;
  req.headers = {};
  return req;
}
function response() {
  return {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(raw) {
      this.raw = raw;
      this.writableEnded = true;
    },
    value() {
      return JSON.parse(this.raw);
    },
  };
}
async function call(service, method, url, data = {}) {
  const req = request(method, url, data),
    res = response();
  await workspaceOrganization({
    req,
    res,
    parts: new URL(url, "http://localhost").pathname
      .replace(/^\/api\/?/, "")
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent),
    url: new URL(url, "http://localhost"),
    json,
    organization: service,
  });
  return { status: res.statusCode, value: res.value() };
}

test("HTTP route handlers persist read state and snooze through the workspace inbox API", async () => {
  const state = {
    projects: [{ id: "p", name: "Web" }],
    sessions: [
      { id: "s", projectId: "p", request: "Task", status: "ready", updatedAt: 50, messages: [] },
    ],
  };
  const org = createWorkspaceOrganization({
    state,
    id: () => "x",
    now: () => 100,
    save: async () => {},
    turns: { isBusy: () => false },
  });
  let result = await call(org, "POST", "/api/workspace/sessions/s/read", { readAt: 80 });
  assert.equal(result.status, 200);
  assert.equal(result.value.readAt, 80);
  result = await call(org, "POST", "/api/workspace/sessions/s/snooze", {
    until: 200,
    preset: "1h",
  });
  assert.equal(result.status, 200);
  assert.equal(result.value.snooze.until, 200);
  result = await call(org, "GET", "/api/workspace/inbox?includeSnoozed=true");
  assert.equal(result.status, 200);
  assert.equal(result.value.groups.snoozed[0].sessionId, "s");
  result = await call(org, "DELETE", "/api/workspace/sessions/s/snooze");
  assert.equal(result.status, 200);
  assert.equal(state.workspaceOrganization.snoozes.s, undefined);
});
