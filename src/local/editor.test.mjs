import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(os.tmpdir(), "ade-editor-test-"));
const project = path.join(home, "project");
const outside = path.join(home, "outside.txt");
mkdirSync(path.join(home, ".ade"));
mkdirSync(path.join(project, "src"), { recursive: true });
mkdirSync(path.join(project, ".git"));
writeFileSync(path.join(project, "src", "app.ts"), "const title = 'before';\n");
chmodSync(path.join(project, "src", "app.ts"), 0o640);
writeFileSync(path.join(project, "src", "binary.bin"), Buffer.from([0, 1, 2]));
writeFileSync(outside, "outside\n");
symlinkSync(outside, path.join(project, "outside-link"));
writeFileSync(
  path.join(home, ".ade", "workspace.json"),
  JSON.stringify({
    projects: [
      {
        id: "p1",
        name: "Editor test",
        path: project,
        branch: "not a git repository",
        ahead: 0,
        uncommittedFiles: [],
        defaultAgent: "codex",
        addedAt: 1,
      },
    ],
    sessions: [],
    processes: [],
  }),
);
process.env.HOME = home;
const { handleLocalApi } = await import("./ade-local.mjs");

async function call(pathname, data, remoteAddress = "127.0.0.1") {
  const request = {
    url: `http://127.0.0.1:3000${pathname}`,
    method: data === undefined ? "GET" : "POST",
    headers: {
      entries: () => [
        ["host", "127.0.0.1:3000"],
        ["origin", "http://127.0.0.1:3000"],
      ],
      get: () => null,
    },
    runtime: { node: { req: { socket: { remoteAddress } } } },
    text: async () => JSON.stringify(data ?? {}),
  };
  const response = await handleLocalApi(request);
  return { status: response.status, body: await response.json() };
}

test("editor lists project files, searches, and excludes Git internals", async () => {
  const root = await call("/api/editor/p1/entries");
  assert.equal(root.status, 200);
  assert.deepEqual(
    root.body.entries.map((entry) => entry.path),
    ["src"],
  );
  const src = await call("/api/editor/p1/entries?path=src");
  assert.equal(src.status, 200);
  assert.deepEqual(
    src.body.entries.map((entry) => entry.path),
    ["src/app.ts", "src/binary.bin"],
  );
  const search = await call("/api/editor/p1/search?q=app");
  assert.equal(search.status, 200);
  assert.deepEqual(
    search.body.entries.map((entry) => entry.path),
    ["src/app.ts"],
  );
});

test("editor reads and saves UTF-8 files without overwriting external changes", async () => {
  const opened = await call("/api/editor/p1/file?path=src%2Fapp.ts");
  assert.equal(opened.status, 200);
  assert.equal(opened.body.content, "const title = 'before';\n");
  const saved = await call("/api/editor/p1/file", {
    path: "src/app.ts",
    content: "const title = 'after';\n",
    version: opened.body.version,
  });
  assert.equal(saved.status, 200);
  assert.equal(
    readFileSync(path.join(project, "src", "app.ts"), "utf8"),
    "const title = 'after';\n",
  );
  const conflict = await call("/api/editor/p1/file", {
    path: "src/app.ts",
    content: "stale edit",
    version: opened.body.version,
  });
  assert.equal(conflict.status, 409);
  assert.equal(
    readFileSync(path.join(project, "src", "app.ts"), "utf8"),
    "const title = 'after';\n",
  );
});

test("editor rejects traversal, external symlinks, binary files, and remote peers", async () => {
  assert.equal((await call("/api/editor/p1/file?path=..%2Foutside.txt")).status, 400);
  assert.equal((await call("/api/editor/p1/file?path=outside-link")).status, 403);
  assert.equal((await call("/api/editor/p1/file?path=src%2Fbinary.bin")).status, 415);
  assert.equal((await call("/api/editor/p1/entries", undefined, "203.0.113.5")).status, 403);
});

test.after(() => rmSync(home, { recursive: true, force: true }));
