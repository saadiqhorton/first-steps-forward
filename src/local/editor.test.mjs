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
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

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
  const folders = await call("/api/editor/p1/search?q=src&folders=1");
  assert.ok(folders.body.entries.some((entry) => entry.path === "src" && entry.kind === "folder"));
  assert.ok(!folders.body.entries.some((entry) => entry.path.startsWith(".git")));
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

async function callRaw(pathname, headers = {}, remoteAddress = "127.0.0.1") {
  const chunks = [];
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    headers: {},
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
    write(chunk) {
      this.headersSent = true;
      chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
      this.headersSent = this.writableEnded = true;
      this.emit("finish");
      this.emit("close");
    },
  });
  const done = new Promise((resolve) => res.once("close", resolve));
  const url = new URL(`http://127.0.0.1:3000${pathname}`);
  const req = Object.assign(Readable.from([]), {
    method: "GET",
    url: `${url.pathname}${url.search}`,
    headers: { host: url.host, origin: url.origin, ...headers },
    socket: { remoteAddress },
  });
  await handle(req, res);
  await done;
  return { status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) };
}

test("editor previews list text snippets and media kinds for a folder's files", async () => {
  const folder = path.join(project, "media-previews");
  mkdirSync(path.join(folder, "nested"), { recursive: true });
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  lines[1] = "x".repeat(250);
  lines[2] = "\tindented";
  writeFileSync(path.join(folder, "notes.txt"), lines.join("\r\n"));
  writeFileSync(path.join(folder, "empty.txt"), "");
  writeFileSync(path.join(folder, "blob.bin"), Buffer.from([65, 0, 66]));
  writeFileSync(path.join(folder, "pic.png"), Buffer.from([137, 80, 78, 71, 1, 2, 3]));
  const result = await call("/api/editor/p1/previews?path=media-previews");
  assert.equal(result.status, 200);
  const { previews } = result.body;
  assert.deepEqual(Object.keys(previews).sort(), [
    "media-previews/blob.bin",
    "media-previews/empty.txt",
    "media-previews/notes.txt",
    "media-previews/pic.png",
  ]);
  const notes = previews["media-previews/notes.txt"];
  const noteLines = notes.text.split("\n");
  assert.equal(noteLines.length, 16);
  assert.equal(noteLines[0], "line 1");
  assert.equal(noteLines[1], "x".repeat(120));
  assert.equal(noteLines[2], "  indented");
  assert.equal(notes.media, null);
  assert.equal(notes.size, Buffer.byteLength(lines.join("\r\n")));
  assert.equal(typeof notes.modifiedAt, "number");
  assert.equal(previews["media-previews/empty.txt"].text, "");
  assert.equal(previews["media-previews/blob.bin"].text, null);
  assert.equal(previews["media-previews/pic.png"].media, "image");
  assert.equal(previews["media-previews/pic.png"].text, null);
  assert.equal(previews["media-previews/pic.png"].size, 7);
  assert.equal((await call("/api/editor/p1/previews?path=src%2Fapp.ts")).status, 400);
});

test("editor raw streams media with ranges and rejects everything else", async () => {
  const folder = path.join(project, "media-raw");
  mkdirSync(folder, { recursive: true });
  const bytes = Buffer.from([10, 11, 12, 13, 14, 15, 16, 17]);
  writeFileSync(path.join(folder, "pic.png"), bytes);
  writeFileSync(path.join(folder, "code.ts"), "export {};\n");
  const full = await callRaw("/api/editor/p1/raw?path=media-raw%2Fpic.png&v=1");
  assert.equal(full.status, 200);
  assert.equal(full.headers["content-type"], "image/png");
  assert.equal(full.headers["content-length"], 8);
  assert.equal(full.headers["accept-ranges"], "bytes");
  assert.equal(full.headers["x-content-type-options"], "nosniff");
  assert.equal(
    full.headers["content-security-policy"],
    "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  );
  assert.deepEqual(full.bytes, bytes);

  const ranged = await callRaw("/api/editor/p1/raw?path=media-raw%2Fpic.png", {
    range: "bytes=2-5",
  });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers["content-range"], "bytes 2-5/8");
  assert.deepEqual(ranged.bytes, bytes.subarray(2, 6));
  const tail = await callRaw("/api/editor/p1/raw?path=media-raw%2Fpic.png", { range: "bytes=-3" });
  assert.equal(tail.headers["content-range"], "bytes 5-7/8");
  const open = await callRaw("/api/editor/p1/raw?path=media-raw%2Fpic.png", { range: "bytes=6-" });
  assert.deepEqual(open.bytes, bytes.subarray(6));
  const multi = await callRaw("/api/editor/p1/raw?path=media-raw%2Fpic.png", {
    range: "bytes=0-1,3-4",
  });
  assert.equal(multi.status, 200);

  const beyond = await callRaw("/api/editor/p1/raw?path=media-raw%2Fpic.png", {
    range: "bytes=999-",
  });
  assert.equal(beyond.status, 416);
  assert.equal(beyond.headers["content-range"], "bytes */8");
  assert.equal(beyond.bytes.length, 0);

  assert.equal((await callRaw("/api/editor/p1/raw?path=media-raw%2Fcode.ts")).status, 415);
  assert.equal((await callRaw("/api/editor/p1/raw?path=..%2Foutside.txt")).status, 400);
  assert.equal((await callRaw("/api/editor/p1/raw?path=media-raw")).status, 400);
  assert.equal((await callRaw("/api/editor/p1/raw?path=.git%2Fx.png")).status, 400);
  assert.equal(
    (await callRaw("/api/editor/p1/raw?path=media-raw%2Fpic.png", {}, "203.0.113.5")).status,
    403,
  );
});

// On exit, not in test.after(): ADE's last workspace save can land after the tests end.
process.once("exit", () => rmSync(home, { recursive: true, force: true }));
