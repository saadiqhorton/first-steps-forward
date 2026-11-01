import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
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
// os.homedir() reads USERPROFILE on Windows, not HOME; without this the
// tests would write into the real ~/.ade workspace.
process.env.USERPROFILE = home;
const { handle, start } = await import("./ade-local.mjs");
const { callApi } = await import("./api-request.test-helper.mjs");
await start();
const { listDocuments } = await import("./editor.mjs");

async function call(pathname, data, remoteAddress = "127.0.0.1") {
  const response = await callApi(handle, {
    url: `http://127.0.0.1:3000${pathname}`,
    headers: { origin: "http://127.0.0.1:3000" },
    body: data,
    remoteAddress,
  });
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

test("listDocuments returns recent Markdown files and skips ignored paths", async () => {
  const docsRoot = mkdtempSync(path.join(os.tmpdir(), "ade-docs-"));
  const outsideMd = path.join(os.tmpdir(), `ade-outside-${Date.now()}.md`);
  try {
    mkdirSync(path.join(docsRoot, "docs", "nested"), { recursive: true });
    mkdirSync(path.join(docsRoot, "node_modules", "pkg"), { recursive: true });
    mkdirSync(path.join(docsRoot, ".hidden"), { recursive: true });
    mkdirSync(path.join(docsRoot, "dist"), { recursive: true });
    mkdirSync(path.join(docsRoot, "build"), { recursive: true });
    mkdirSync(path.join(docsRoot, ".tanstack"), { recursive: true });

    const older = path.join(docsRoot, "README.md");
    const newer = path.join(docsRoot, "docs", "guide.md");
    const nested = path.join(docsRoot, "docs", "nested", "deep.mdx");
    writeFileSync(older, "# older\n");
    writeFileSync(newer, "# newer\n");
    writeFileSync(nested, "# nested\n");
    writeFileSync(path.join(docsRoot, "notes.txt"), "skip me\n");
    writeFileSync(path.join(docsRoot, "node_modules", "pkg", "README.md"), "# dep\n");
    writeFileSync(path.join(docsRoot, ".hidden", "secret.md"), "# secret\n");
    writeFileSync(path.join(docsRoot, "dist", "out.md"), "# dist\n");
    writeFileSync(path.join(docsRoot, "build", "out.md"), "# build\n");
    writeFileSync(path.join(docsRoot, ".tanstack", "route.md"), "# tanstack\n");

    writeFileSync(outsideMd, "# outside\n");
    symlinkSync(outsideMd, path.join(docsRoot, "outside.md"));

    const tOlder = new Date("2024-01-01T00:00:00Z");
    const tNewer = new Date("2024-06-01T00:00:00Z");
    const tNested = new Date("2024-03-01T00:00:00Z");
    utimesSync(older, tOlder, tOlder);
    utimesSync(newer, tNewer, tNewer);
    utimesSync(nested, tNested, tNested);

    const docs = await listDocuments(docsRoot);
    assert.deepEqual(
      docs.map((doc) => doc.path),
      ["docs/guide.md", "docs/nested/deep.mdx", "README.md"],
    );
    assert.equal(docs[0].name, "guide.md");
    assert.equal(docs[0].modifiedAt, tNewer.getTime());
    assert.equal(docs[0].size, Buffer.byteLength("# newer\n"));
    assert.ok(!docs.some((doc) => doc.path.includes("node_modules")));
    assert.ok(!docs.some((doc) => doc.path.startsWith(".")));
    assert.ok(!docs.some((doc) => doc.path === "outside.md"));

    const limited = await listDocuments(docsRoot, { limit: 2 });
    assert.equal(limited.length, 2);
    assert.deepEqual(
      limited.map((doc) => doc.path),
      ["docs/guide.md", "docs/nested/deep.mdx"],
    );
  } finally {
    rmSync(docsRoot, { recursive: true, force: true });
    rmSync(outsideMd, { force: true });
  }
});

test("editor creates and deletes files inside the project", async () => {
  const created = await call("/api/editor/p1/create", { path: "src/created.txt" });
  assert.equal(created.status, 201);
  assert.equal(created.body.path, "src/created.txt");
  assert.equal(readFileSync(path.join(project, "src", "created.txt"), "utf8"), "");
  const listed = await call("/api/editor/p1/entries?path=src");
  assert.ok(listed.body.entries.some((entry) => entry.path === "src/created.txt"));
  const opened = await call("/api/editor/p1/file?path=src%2Fcreated.txt");
  assert.equal(opened.status, 200);
  assert.equal(opened.body.content, "");
  assert.equal(opened.body.version, created.body.version);

  const duplicate = await call("/api/editor/p1/create", { path: "src/created.txt" });
  assert.equal(duplicate.status, 409);
  const missingFolder = await call("/api/editor/p1/create", { path: "missing/created.txt" });
  assert.equal(missingFolder.status, 404);
  const traversal = await call("/api/editor/p1/create", { path: "../created.txt" });
  assert.equal(traversal.status, 400);
  assert.equal(readFileSync(outside, "utf8"), "outside\n");
  const gitCreate = await call("/api/editor/p1/create", { path: ".git/config" });
  assert.equal(gitCreate.status, 400);

  const removed = await call("/api/editor/p1/delete", { path: "src/created.txt" });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.ok, true);
  assert.throws(() => readFileSync(path.join(project, "src", "created.txt"), "utf8"));
  const folder = await call("/api/editor/p1/delete", { path: "src" });
  assert.equal(folder.status, 400);
  assert.equal(readFileSync(path.join(project, "src", "app.ts"), "utf8").includes("title"), true);
  const link = await call("/api/editor/p1/delete", { path: "outside-link" });
  assert.equal(link.status, 403);
  assert.equal(readFileSync(outside, "utf8"), "outside\n");
  const gitDelete = await call("/api/editor/p1/delete", { path: ".git" });
  assert.equal(gitDelete.status, 400);
  const escaped = await call("/api/editor/p1/delete", { path: "../outside.txt" });
  assert.equal(escaped.status, 400);
  assert.equal(readFileSync(outside, "utf8"), "outside\n");
});

// On exit, not in test.after(): ADE's last workspace save can land after the tests end.
process.once("exit", () => rmSync(home, { recursive: true, force: true }));
