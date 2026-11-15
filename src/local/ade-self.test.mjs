// ADE's own row: only the checkout the server runs from, plus other ADE instances
// that share that project. Kept separate from the process tests so the rules are
// readable without an HTTP server.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { findUnmanagedAdeInstances, isAdeProjectPath, samePath } from "./ade-self.mjs";

const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "ade-self-")));
process.once("exit", () => rmSync(home, { recursive: true, force: true }));
const project = path.join(home, "project");
const other = path.join(home, "other");
mkdirSync(project);
mkdirSync(other);

test("the app project is the folder the server runs from, symlinks included", () => {
  assert.equal(isAdeProjectPath(project, project), true);
  assert.equal(isAdeProjectPath(project, other), false);
  assert.equal(samePath(project, project), true);
  assert.equal(samePath(project, path.join(project, "missing")), false);
  assert.equal(isAdeProjectPath("", project), false);
});

test("an unmanaged ADE is an ADE page whose workspace has this project", async () => {
  const scan = async (exclude) => {
    assert.deepEqual(exclude, [3100]);
    return [
      { url: "http://127.0.0.1:3101/", port: 3101, title: "ADE — Project home" },
      { url: "http://127.0.0.1:3102/", port: 3102, title: "Some other site" },
    ];
  };
  const fetchImpl = async (url) => {
    assert.equal(url, "http://127.0.0.1:3101/api/bootstrap");
    return {
      ok: true,
      json: async () => ({
        projects: [{ id: "p", path: project }],
        agents: [],
      }),
    };
  };
  const rows = await findUnmanagedAdeInstances({
    scan,
    excludePorts: [3100],
    projectPath: project,
    fetchImpl,
  });
  assert.deepEqual(rows, [{ address: "http://127.0.0.1:3101/", port: 3101 }]);
});

test("an ADE with another workspace is not claimed for this project", async () => {
  const scan = async () => [
    { url: "http://127.0.0.1:3101/", port: 3101, title: "ADE — Project home" },
  ];
  const rows = await findUnmanagedAdeInstances({
    scan,
    projectPath: project,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ projects: [{ path: other }], agents: [] }),
    }),
  });
  assert.deepEqual(rows, []);
});

test("a failed scan or a non-ADE API response yields no rows", async () => {
  const failed = await findUnmanagedAdeInstances({
    scan: async () => {
      throw new Error("ss missing");
    },
    projectPath: project,
  });
  assert.deepEqual(failed, []);

  const notAde = await findUnmanagedAdeInstances({
    scan: async () => [{ url: "http://127.0.0.1:3200/", port: 3200, title: "ADE-like" }],
    projectPath: project,
    fetchImpl: async () => ({ ok: true, json: async () => ({ hello: "world" }) }),
  });
  assert.deepEqual(notAde, []);
});
