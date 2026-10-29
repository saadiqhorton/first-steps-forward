import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(os.tmpdir(), "ade-sources-test-"));
mkdirSync(path.join(home, ".ade"), { mode: 0o700 });
const workspace = path.join(home, "work");
mkdirSync(workspace);

// A local bare repo that stands in for github.com. git rewrites the https
// address to it, so the test goes through the real clone path with no network.
const origin = path.join(home, "origin");
const bare = path.join(home, "remote", "acme", "widgets.git");
mkdirSync(origin);
execFileSync("git", ["init", "-q", "-b", "main", origin]);
writeFileSync(path.join(origin, "README.md"), "# widgets\n");
execFileSync("git", ["-C", origin, "add", "."]);
execFileSync("git", [
  "-C",
  origin,
  "-c",
  "user.name=Test",
  "-c",
  "user.email=test@example.invalid",
  "commit",
  "-qm",
  "init",
]);
mkdirSync(path.dirname(bare), { recursive: true });
execFileSync("git", ["clone", "-q", "--bare", origin, bare]);

process.env.HOME = home;
// os.homedir() reads USERPROFILE on Windows, not HOME; without this the
// tests would write into the real ~/.ade workspace.
process.env.USERPROFILE = home;
process.env.GIT_CONFIG_COUNT = "1";
process.env.GIT_CONFIG_KEY_0 = `url.${path.join(home, "remote")}/.insteadOf`;
process.env.GIT_CONFIG_VALUE_0 = "https://github.com/";
const { handleLocalApi } = await import("./ade-local.mjs");

const call = async (urlPath, body) => {
  const method = body === undefined ? "GET" : "POST";
  const request = {
    url: `http://127.0.0.1:3000${urlPath}`,
    method,
    headers: { entries: () => [["host", "127.0.0.1:3000"]] },
    runtime: { node: { req: { socket: { remoteAddress: "127.0.0.1" } } } },
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  };
  const response = await handleLocalApi(request);
  return { status: response.status, body: await response.json() };
};

test("cloning owner/repo into a chosen folder adds it as a project", async () => {
  const cloned = await call("/api/projects/clone", { url: "acme/widgets", parent: workspace });
  assert.equal(cloned.status, 201, JSON.stringify(cloned.body));
  const expected = path.join(workspace, "widgets");
  assert.ok(existsSync(path.join(expected, "README.md")));
  assert.ok(existsSync(path.join(expected, ".git")));
  assert.equal(cloned.body.project.name, "widgets");
  assert.equal(cloned.body.project.path, expected);
  assert.equal(cloned.body.project.branch, "main");
  const bootstrap = await call("/api/bootstrap");
  assert.ok(bootstrap.body.projects.some((project) => project.path === expected));
});

test("cloning honors a custom folder name and ~ in the destination", async () => {
  const cloned = await call("/api/projects/clone", {
    url: "https://github.com/acme/widgets",
    parent: "~/work",
    name: "widgets-two",
  });
  assert.equal(cloned.status, 201, JSON.stringify(cloned.body));
  assert.equal(cloned.body.project.path, path.join(workspace, "widgets-two"));
});

test("cloning refuses to overwrite an existing folder", async () => {
  const again = await call("/api/projects/clone", { url: "acme/widgets", parent: workspace });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /already exists/);
});

test("a failed clone reports git's reason and leaves nothing behind", async () => {
  const missing = await call("/api/projects/clone", { url: "acme/missing", parent: workspace });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /Could not clone the repository: .*does not appear to be a git/);
  assert.doesNotMatch(missing.body.error, /fatal:|\.\./, "reads as a sentence, not raw stderr");
  assert.equal(existsSync(path.join(workspace, "missing")), false);
});

test("clone rejects addresses that are not remote repositories, without running git", async () => {
  for (const url of [
    "/etc",
    "ext::sh -c touch /tmp/pwned",
    "--upload-pack=x",
    "https://u:p@h/r.git",
  ]) {
    const result = await call("/api/projects/clone", { url, parent: workspace });
    assert.equal(result.status, 400, url);
  }
  const noParent = await call("/api/projects/clone", { url: "acme/widgets", parent: "" });
  assert.equal(noParent.status, 400);
  const badParent = await call("/api/projects/clone", {
    url: "acme/widgets",
    parent: path.join(home, "nope"),
  });
  assert.equal(badParent.status, 400);
  const escape = await call("/api/projects/clone", {
    url: "acme/widgets",
    parent: workspace,
    name: "../escape",
  });
  assert.equal(escape.status, 400);
  assert.equal(existsSync(path.join(home, "escape")), false);
});

test("creating a new project makes the folder, initializes git, and adds it", async () => {
  const created = await call("/api/projects/create", { parent: workspace, name: "fresh" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const expected = path.join(workspace, "fresh");
  assert.equal(created.body.project.path, expected);
  assert.ok(existsSync(path.join(expected, ".git")));

  const plain = await call("/api/projects/create", {
    parent: workspace,
    name: "plain",
    git: false,
  });
  assert.equal(plain.status, 201);
  assert.equal(existsSync(path.join(workspace, "plain", ".git")), false);
});

test("creating a project refuses duplicates and unsafe names", async () => {
  const duplicate = await call("/api/projects/create", { parent: workspace, name: "fresh" });
  assert.equal(duplicate.status, 409);
  for (const name of ["", "..", "a/b", "../x"]) {
    const result = await call("/api/projects/create", { parent: workspace, name });
    assert.equal(result.status, 400, JSON.stringify(name));
  }
  assert.equal(existsSync(path.join(home, "x")), false);
});

test("POST /api/mkdir creates one folder for the picker", async () => {
  const made = await call("/api/mkdir", { parent: workspace, name: "dest" });
  assert.equal(made.status, 201);
  assert.equal(made.body.path, path.join(workspace, "dest"));
  assert.ok(existsSync(made.body.path));
  const clash = await call("/api/mkdir", { parent: workspace, name: "dest" });
  assert.equal(clash.status, 409);
  const nested = await call("/api/mkdir", { parent: workspace, name: "a/b" });
  assert.equal(nested.status, 400);
});

// On exit, not in test.after(): ADE's last workspace save can land after the tests end.
process.once("exit", () => rmSync(home, { recursive: true, force: true }));
