import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDevCommandApprovals,
  devCommandEnv,
  normalizeCwd,
  sameDevCommand,
  splitCommand,
  withPort,
} from "./dev-command.mjs";

test("commands split into argv like a shell splits words, without a shell", () => {
  assert.deepEqual(splitCommand("pyxplain-ui"), ["pyxplain-ui"]);
  assert.deepEqual(splitCommand("  uvicorn   app:app --port {port} "), [
    "uvicorn",
    "app:app",
    "--port",
    "{port}",
  ]);
  assert.deepEqual(splitCommand(`serve "two words" 'it''s' a\\ b ""`), [
    "serve",
    "two words",
    "its",
    "a b",
    "",
  ]);
  // Inside quotes, operators are plain text; double quotes only unescape \" and \\.
  assert.deepEqual(splitCommand(`python -c "print('a && b; c | d')"`), [
    "python",
    "-c",
    "print('a && b; c | d')",
  ]);
  assert.deepEqual(splitCommand(`echo "say \\"hi\\"" '$HOME'`), ["echo", 'say "hi"', "$HOME"]);
  // A backslash before anything else stays, so Windows paths survive unquoted.
  assert.deepEqual(splitCommand("C:\\tools\\serve.exe --dir .\\ui"), [
    "C:\\tools\\serve.exe",
    "--dir",
    ".\\ui",
  ]);
  assert.deepEqual(splitCommand("serve --cost $5"), ["serve", "--cost", "$5"]);
});

test("shell syntax is refused, quoted or not, wherever a shell would act on it", () => {
  for (const command of [
    "a && b",
    "a || b",
    "a | b",
    "a; b",
    "a & b",
    "a > out",
    "a < in",
    "a `b`",
    "a $(b)",
    "a $HOME",
    "a ${HOME}",
    'a "$(b)"',
    'a "`b`"',
    'a "$HOME"',
  ])
    assert.throws(() => splitCommand(command), /without a shell/, command);
  assert.throws(() => splitCommand("a 'b"), /unclosed ' quote/);
});

test("{port} is replaced in every argument", () => {
  assert.deepEqual(withPort(["serve", "--port={port}", "{port}"], 4173), [
    "serve",
    "--port=4173",
    "4173",
  ]);
});

test("cwd normalizes to a relative folder and refuses absolute paths and escapes", () => {
  assert.equal(normalizeCwd(undefined), ".");
  assert.equal(normalizeCwd(""), ".");
  assert.equal(normalizeCwd("./"), ".");
  assert.equal(normalizeCwd("ui/"), "ui");
  assert.equal(normalizeCwd("./apps\\web"), "apps/web");
  assert.equal(normalizeCwd("ui/../api"), "api");
  for (const cwd of ["/etc", "C:\\Windows", "C:temp", "\\\\server\\share"])
    assert.throws(() => normalizeCwd(cwd), /not an absolute path/, cwd);
  for (const cwd of ["..", "../x", "ui/../../x"])
    assert.throws(() => normalizeCwd(cwd), /stay inside the project/, cwd);
  assert.throws(() => normalizeCwd(42), /relative to the project root/);
});

test("the same program, arguments, folder and port count as the same command", () => {
  const approved = { command: 'serve --port {port} "a b"', cwd: "ui" };
  assert.ok(sameDevCommand(approved, { command: "serve  --port {port} 'a b'", cwd: "ui" }));
  assert.ok(!sameDevCommand(approved, { command: "serve --port {port} a b", cwd: "ui" }));
  assert.ok(!sameDevCommand(approved, { ...approved, cwd: "." }));
  assert.ok(!sameDevCommand(approved, { ...approved, port: 8000 }));
  assert.ok(!sameDevCommand(undefined, approved));
});

test("the launch env sets PORT and HOST and puts virtualenv scripts first on PATH", async () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "ade-devenv-")));
  try {
    const ui = path.join(root, "ui");
    mkdirSync(ui);
    assert.deepEqual(await devCommandEnv({ dir: ui, root, port: 8123 }), {
      PORT: "8123",
      HOST: "127.0.0.1",
    });
    const scripts = process.platform === "win32" ? ["Scripts"] : ["bin"];
    mkdirSync(path.join(ui, ".venv", ...scripts), { recursive: true });
    mkdirSync(path.join(root, ".venv", ...scripts), { recursive: true });
    const env = await devCommandEnv({ dir: ui, root, port: 8123 });
    const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH");
    const entries = env[key].split(path.delimiter);
    assert.equal(entries[0], path.join(ui, ".venv", ...scripts));
    assert.equal(entries[1], path.join(root, ".venv", ...scripts));
    assert.equal(entries.length > 2, !!process.env[key]);
    // The project root's own venv is listed once when the command runs there.
    const atRoot = await devCommandEnv({ dir: root, root, port: 8123 });
    assert.equal(atRoot[key].split(path.delimiter)[1], process.env[key]?.split(path.delimiter)[0]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("approval wait cancels through AbortSignal without closing the shared request", async () => {
  const project = { id: "p1" };
  const state = { projects: [project], sessions: [] };
  const approvals = createDevCommandApprovals({ state, save: async () => {} });
  const request = approvals.ask(project, { command: "npm run dev", cwd: "." });
  const controller = new AbortController();
  const waiting = approvals.wait(project.id, request.id, controller.signal);
  controller.abort();
  assert.equal(await waiting, "gone");
  assert.equal(approvals.pendingFor(project.id).id, request.id);
  await approvals.answer(project, request.id, false);
  assert.equal(approvals.pendingFor(project.id), undefined);
});
