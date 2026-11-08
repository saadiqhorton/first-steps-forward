import test from "node:test";
import assert from "node:assert/strict";
import { projects } from "./routes/projects.mjs";
import { browserScope } from "./browser-scope.mjs";
import { browserProfileStorageKey } from "./browser-profiles.mjs";

test("removing a project closes conversation previews and clears their browser metadata", async () => {
  const profile = "a4dfc73c-cc74-48b3-9319-3f0e8cfd2a80";
  const state = {
    projects: [{ id: "p", browserProfiles: [{ id: profile, name: "Work" }] }, { id: "other" }],
    sessions: [
      { id: "s1", projectId: "p" },
      { id: "s2", projectId: "p" },
      { id: "s3", projectId: "other" },
    ],
    processes: [],
  };
  const stopped = [],
    controls = [],
    snapshots = [],
    profiles = [],
    logs = [];
  let saved = false;
  let payload;
  await projects({
    req: { method: "POST" },
    res: {},
    parts: ["projects", "p", "remove"],
    state,
    turns: { isBusy: () => false },
    devServers: { hasRunning: () => false },
    computers: { stop: async (key) => stopped.push(key) },
    controls: { delete: async (key) => controls.push(key) },
    browserSessionStore: { remove: async (key) => snapshots.push(key) },
    browserContexts: { clearProfile: async (key) => profiles.push(key) },
    sessionLogs: { remove: async (id) => logs.push(id) },
    devApprovals: { cancelForProject: () => {} },
    save: async () => {
      saved = true;
    },
    json: (_res, code, value) => {
      assert.equal(code, 200);
      payload = value;
      return true;
    },
  });
  const scopes = ["p", browserScope("p", "s1"), browserScope("p", "s2")];
  assert.deepEqual(new Set(stopped), new Set(scopes));
  assert.deepEqual(new Set(controls), new Set(scopes));
  assert.deepEqual(new Set(snapshots), new Set(scopes));
  assert.deepEqual(new Set(profiles), new Set(["p", browserProfileStorageKey("p", profile)]));
  assert.deepEqual(new Set(logs), new Set(["s1", "s2"]));
  assert.deepEqual(
    state.projects.map((item) => item.id),
    ["other"],
  );
  assert.deepEqual(
    state.sessions.map((item) => item.id),
    ["s3"],
  );
  assert.equal(saved, true);
  assert.equal(payload.removed, "p");
});
