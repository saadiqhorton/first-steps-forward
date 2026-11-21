// Exercise the real service against the same disposable seed used by Try it.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedPreview } from "./preview.mjs";
import { callApi } from "../api-request.test-helper.mjs";

const home = mkdtempSync(path.join(os.tmpdir(), "ade-preview-service-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
// Do not discover or execute any installed agent CLIs in this test.
const bin = path.join(home, "bin");
mkdirSync(bin);
process.env.PATH = bin;
for (const key of Object.keys(process.env)) {
  if (key.startsWith("XDG_") || key === "CODEX_HOME" || key === "CLAUDE_CONFIG_DIR")
    delete process.env[key];
}
await seedPreview(home);
const { handle, start } = await import("../ade-local.mjs");
await start();
test.after(() => rmSync(home, { recursive: true, force: true }));

test("the real service loads the sample and serves its README", async () => {
  const call = (route) => callApi(handle, { url: `http://127.0.0.1:3000${route}` });
  const bootstrap = await call("/api/bootstrap");
  assert.equal(bootstrap.status, 200);
  const workspace = await bootstrap.json();
  assert.equal(workspace.projects.length, 1);
  assert.equal(workspace.projects[0].name, "Sample project");
  assert.equal(workspace.projects[0].path, path.join(home, "sample-project"));
  assert.deepEqual(workspace.sessions, []);
  const file = await call(`/api/editor/${workspace.projects[0].id}/file?path=README.md`);
  assert.equal(file.status, 200);
  assert.match((await file.json()).content, /disposable project/i);
});
