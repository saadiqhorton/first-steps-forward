// The Customize ADE service against a fixture git checkout, with a scripted
// agent and a stubbed `npm ci`. Real git, real `npm run <script>` checks.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tempDir, git, makeStockRepo } from "./fixture.test-helper.mjs";

// Never the real home: git and npm read it.
const home = tempDir("ade-customize-home-");
process.env.HOME = home;
process.env.USERPROFILE = home;

const { createCustomize } = await import("./index.mjs");
const { runCommand } = await import("../spawn.mjs");
const { resolveStock, exportStock } = await import("./source.mjs");

async function waitFor(check, what, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** A ready customize service over a fresh stock repo; `install` stubs `npm ci`. */
async function harness({ scripts, install, ready = true, sourceRoot } = {}) {
  const dataDir = tempDir("ade-customize-data-");
  const root = sourceRoot ?? makeStockRepo({ scripts });
  const installs = [];
  const run = async (bin, args, opts = {}) => {
    if (bin === "npm" && args[0] === "ci") {
      installs.push({ cwd: opts.cwd, env: opts.env });
      if (install) return install(opts);
      mkdirSync(path.join(opts.cwd, "node_modules"), { recursive: true });
      return { code: 0, stdout: "", stderr: "" };
    }
    return runCommand(bin, args, opts);
  };
  const appState = { projects: [], sessions: [] };
  const sessions = new Map();
  const sent = [];
  const stopped = [];
  const started = [];
  const events = [];
  let n = 0;
  const deps = {
    startSession: async (input) => {
      started.push(input);
      const session = {
        id: `s${++n}`,
        projectId: input.projectId,
        agentId: input.agentId,
        status: "working",
        messages: [],
      };
      sessions.set(session.id, session);
      return session;
    },
    sendMessage: async (session, text) => {
      sent.push(text);
      session.status = "working";
    },
    stopSession: async (session) => {
      stopped.push(session.id);
      session.status = "stopped";
      session.busy = false;
    },
    getSession: (id) => sessions.get(id),
    isBusy: (session) => session.status === "working",
  };
  let ids = 0;
  const service = createCustomize({
    dataDir,
    appState,
    saveApp: async () => {},
    emit: (scope) => events.push(scope),
    deps,
    sourceRoot: root,
    run,
    id: () => `c${++ids}`,
    checkTimeout: 60000,
  });
  await service.init();
  if (ready) {
    await service.startSetup();
    await service.idle();
    assert.equal(
      (await service.status()).setup.status,
      "ready",
      JSON.stringify(await service.status()),
    );
  }
  /** The agent finishes its turn after `edit(sourceDir)` changed files. */
  const finishTurn = (session, edit) => {
    edit?.(service.paths.source);
    session.status = "ready";
    service.onTurnEnd(session);
  };
  const change = async (id) => (await service.status()).changes.find((c) => c.id === id);
  const reach = (id, status) =>
    waitFor(async () => (await change(id))?.status === status && (await change(id)), `${status}`);
  return {
    service,
    dataDir,
    root,
    installs,
    appState,
    sessions,
    sent,
    stopped,
    started,
    events,
    finishTurn,
    change,
    reach,
  };
}
const write = (rel, text) => (dir) => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), text);
};
const start = (h, request = "Copy a session's full log") =>
  h.service.createChange({ request, agentId: "codex" });

test("stock source: exports tracked files at HEAD only, with the version", async () => {
  const root = makeStockRepo({ version: "4.5.6" });
  const stock = await resolveStock({ sourceRoot: root, run: runCommand });
  assert.deepEqual([stock.available, stock.kind, stock.version], [true, "checkout", "4.5.6"]);
  const dest = path.join(tempDir("ade-export-"), "out");
  await exportStock(stock, dest, { run: runCommand });
  assert.ok(existsSync(path.join(dest, "src", "feature.txt")));
  assert.ok(!existsSync(path.join(dest, "untracked.txt")));
  assert.ok(!existsSync(path.join(dest, ".git")));
});

test("stock source: a packaged self-source folder wins; no source is unavailable", async () => {
  const packaged = tempDir("ade-pkg-");
  writeFileSync(path.join(packaged, "package.json"), JSON.stringify({ version: "9.9.9" }));
  mkdirSync(path.join(packaged, "self-source"));
  writeFileSync(path.join(packaged, "self-source", "a.txt"), "x");
  const stock = await resolveStock({ sourceRoot: packaged, run: runCommand });
  assert.equal(stock.kind, "packaged");
  const dest = path.join(tempDir("ade-export-"), "out");
  await exportStock(stock, dest, { run: runCommand });
  assert.ok(existsSync(path.join(dest, "a.txt")));

  const bare = tempDir("ade-bare-");
  const none = await resolveStock({ sourceRoot: bare, run: runCommand });
  assert.equal(none.available, false);
  assert.match(none.reason, /does not include its source/);
  const h = await harness({ ready: false, sourceRoot: bare });
  const status = await h.service.status();
  assert.equal(status.available, false);
  assert.ok(status.unavailableReason);
  await assert.rejects(h.service.startSetup(), { status: 409 });
});

test("setup copies, installs with a throwaway HOME, saves stock and mine, hides the project", async () => {
  const h = await harness();
  const status = await h.service.status();
  assert.equal(status.version, "1.2.3");
  const source = h.service.paths.source;
  assert.equal(git(source, "rev-parse", "--abbrev-ref", "HEAD"), "mine");
  assert.match(git(source, "branch", "--list"), /stock/);
  assert.equal(git(source, "log", "-1", "--format=%s", "stock"), "ADE 1.2.3");
  assert.ok(!existsSync(path.join(source, "untracked.txt")));
  assert.equal(git(source, "status", "--porcelain"), "", "node_modules is not part of the repo");
  assert.ok(!existsSync(h.service.paths.partial));
  assert.equal(h.installs.length, 1);
  assert.notEqual(h.installs[0].env.HOME, home);
  assert.ok(h.installs[0].env.HOME.startsWith(h.service.paths.homes));
  const project = h.appState.projects.find((p) => p.id === "ade-self");
  assert.deepEqual([project.hidden, project.kind, project.path], [true, "ade-self", source]);
  if (process.platform !== "win32")
    assert.equal(statSync(h.service.paths.state).mode & 0o777, 0o600);
  assert.deepEqual(status.current, { stock: true, sha: null });
  assert.deepEqual(status.switch, { status: "idle", launcher: false });
});

test("a failed install leaves no partial copy and keeps the real error", async () => {
  const h = await harness({
    ready: false,
    install: async () => ({ code: 1, stdout: "", stderr: "npm error ETIMEDOUT registry" }),
  });
  await h.service.startSetup();
  await h.service.idle();
  const { setup } = await h.service.status();
  assert.equal(setup.status, "failed");
  assert.match(setup.error, /ETIMEDOUT/);
  assert.ok(!existsSync(h.service.paths.source));
  assert.ok(!existsSync(h.service.paths.partial));
  assert.equal(h.appState.projects.length, 0);
  // Retry works once the install does.
  const retry = await harness({ ready: true });
  assert.equal((await retry.service.status()).setup.status, "ready");
});

test("creating a change starts a build-mode session in the hidden project and branches", async () => {
  const h = await harness();
  assert.deepEqual(
    await h.service.createChange({ request: "x", agentId: "codex" }).catch((e) => e.status),
    400,
  );
  const change = await start(h, "Copy a session's full log\nso I can paste it");
  assert.equal(change.status, "working");
  assert.equal(change.title, "Copy a session's full log");
  const input = h.started[0];
  assert.equal(input.projectId, "ade-self");
  assert.equal(input.permission, "build");
  assert.match(input.request, /Work only inside this folder/);
  assert.match(input.request, /src\/tokens\.css/);
  assert.ok(input.request.endsWith("so I can paste it"));
  assert.equal(input.presentation.text, change.request);
  assert.equal(
    git(h.service.paths.source, "rev-parse", "--abbrev-ref", "HEAD"),
    `change/${change.id}`,
  );
  assert.ok(h.events.includes("customize"));
  await assert.rejects(start(h), { status: 409 });
});

test("setup is required before a change", async () => {
  const h = await harness({ ready: false });
  await assert.rejects(start(h), { status: 409, message: /Set up customization/ });
});

test("a turn with no file changes needs you", async () => {
  const h = await harness();
  const change = await start(h);
  h.finishTurn(h.sessions.get(change.sessionId));
  const done = await h.reach(change.id, "needs-you");
  assert.equal(done.reason, "The agent finished without changing anything.");
  assert.deepEqual(done.files, []);
});

test("a stopped or failed agent turn needs you with the reason", async () => {
  const h = await harness();
  const change = await start(h);
  const session = h.sessions.get(change.sessionId);
  session.status = "blocked";
  session.messages.push({ role: "system", text: "Rate limit reached." });
  h.service.onTurnEnd(session);
  const done = await h.reach(change.id, "needs-you");
  assert.equal(done.reason, "Rate limit reached.");
});

test("changes go checking then ready when every check passes", async () => {
  const h = await harness();
  const change = await start(h);
  const session = h.sessions.get(change.sessionId);
  h.finishTurn(session, write("src/feature.txt", "one\ntwo\nthree\nfour\n"));
  const ready = await h.reach(change.id, "ready");
  assert.deepEqual(ready.files, [{ path: "src/feature.txt", added: 1, removed: 0 }]);
  assert.deepEqual(
    ready.checks.map((c) => [c.id, c.status]),
    [
      ["typecheck", "passed"],
      ["lint", "passed"],
      ["build", "passed"],
      ["test", "passed"],
      ["token-audit", "passed"],
      ["design-lock", "passed"],
    ],
  );
  assert.equal(ready.checks.find((c) => c.id === "test").summary, "7 passed");
  assert.equal(typeof ready.checks[0].durationMs, "number");
  assert.equal(ready.fixAttempts, 0);
  assert.equal(git(h.service.paths.source, "log", "-1", "--format=%s"), change.title);
  // Check commands ran with a throwaway HOME, not the real one.
  const printed = /^HOME=(.*)$/m.exec(ready.checks.find((c) => c.id === "test").output)[1];
  assert.ok(printed.startsWith(h.service.paths.homes));
  assert.notEqual(printed, home);
  assert.equal(h.sent.length, 0);
});

test("a missing npm script is skipped with the reason", async () => {
  const h = await harness({ scripts: { lint: undefined } });
  const change = await start(h);
  h.finishTurn(h.sessions.get(change.sessionId), write("a.txt", "a"));
  const ready = await h.reach(change.id, "ready");
  const lint = ready.checks.find((c) => c.id === "lint");
  assert.equal(lint.status, "skipped");
  assert.match(lint.summary, /no "lint" script/);
});

test("a failing check sends the agent two automatic follow-ups, then fails", async () => {
  const h = await harness({
    scripts: { test: `node -e "console.log('boom: expected 1 got 2'); process.exit(1)"` },
  });
  const change = await start(h);
  const session = h.sessions.get(change.sessionId);
  h.finishTurn(session, write("a.txt", "a"));
  await waitFor(() => h.sent.length === 1, "first follow-up");
  const fixing = await h.reach(change.id, "fixing");
  assert.equal(fixing.fixAttempts, 1);
  assert.match(h.sent[0], /Check "Tests" failed/);
  assert.match(h.sent[0], /boom: expected 1 got 2/);
  h.finishTurn(session, write("b.txt", "b"));
  await waitFor(() => h.sent.length === 2, "second follow-up");
  h.finishTurn(session, write("c.txt", "c"));
  const failed = await h.reach(change.id, "failed");
  assert.equal(failed.fixAttempts, 2);
  assert.equal(h.sent.length, 2);
  assert.match(failed.reason, /Tests/);
  const test_ = failed.checks.find((c) => c.id === "test");
  assert.equal(test_.status, "failed");
  assert.match(test_.output, /boom/);
  assert.equal(failed.checks.find((c) => c.id === "lint").status, "passed", "all checks run");
});

test("design-lock rejects edits to protected design files", async () => {
  const h = await harness();
  const change = await start(h);
  const session = h.sessions.get(change.sessionId);
  h.finishTurn(session, write("src/tokens.css", ":root { --a: 2; }\n"));
  await waitFor(() => h.sent.length === 1, "follow-up about the locked file");
  assert.match(h.sent[0], /Design files untouched/);
  assert.match(h.sent[0], /src\/tokens\.css/);
  h.finishTurn(session, write("src/components/ui/button.tsx", "x"));
  await waitFor(() => h.sent.length === 2, "second follow-up");
  h.finishTurn(session);
  const failed = await h.reach(change.id, "failed");
  const lock = failed.checks.find((c) => c.id === "design-lock");
  assert.equal(lock.status, "failed");
  assert.match(lock.output, /src\/tokens\.css/);
  await assert.rejects(h.service.keep(change.id), { status: 409 });
});

test("keep squashes into mine and marks the switch pending", async () => {
  const h = await harness();
  const change = await start(h, "Add a thing");
  const session = h.sessions.get(change.sessionId);
  h.finishTurn(session, write("src/feature.txt", "one\ntwo\nthree\nfour\n"));
  await h.reach(change.id, "ready");
  const kept = await h.service.keep(change.id);
  const source = h.service.paths.source;
  assert.equal(kept.status, "kept");
  assert.equal(kept.commit, git(source, "rev-parse", "mine"));
  assert.ok(kept.keptAt);
  assert.equal(git(source, "log", "-1", "--format=%s", "mine"), "Add a thing");
  assert.equal(git(source, "rev-list", "--count", "stock..mine"), "1");
  assert.equal(git(source, "branch", "--list", `change/${change.id}`), "");
  assert.equal(
    readFileSync(path.join(source, "src", "feature.txt"), "utf8"),
    "one\ntwo\nthree\nfour\n",
  );
  const status = await h.service.status();
  assert.equal(status.switch.status, "pending");
  assert.equal(status.switch.launcher, false);
  // The next change can start from the new mine.
  await start(h, "Another thing");
});

test("undo deletes the branch and hides the change, stopping a running agent", async () => {
  const h = await harness();
  const change = await start(h);
  const session = h.sessions.get(change.sessionId);
  h.finishTurn(session, write("a.txt", "a"));
  await h.reach(change.id, "ready");
  await h.service.undo(change.id);
  const source = h.service.paths.source;
  assert.equal(git(source, "branch", "--list", `change/${change.id}`), "");
  assert.equal(git(source, "rev-parse", "--abbrev-ref", "HEAD"), "mine");
  assert.ok(!existsSync(path.join(source, "a.txt")));
  assert.equal((await h.service.status()).changes.length, 0);

  const running = await start(h, "Something else");
  await h.service.undo(running.id);
  assert.deepEqual(h.stopped, [running.sessionId]);
  assert.equal(git(source, "branch", "--list", "change/*"), "");
  await assert.rejects(h.service.undo("nope"), { status: 404 });
});

test("remove reverts a kept change on mine and marks the switch pending", async () => {
  const h = await harness();
  const change = await start(h, "Add a line");
  h.finishTurn(
    h.sessions.get(change.sessionId),
    write("src/feature.txt", "one\ntwo\nthree\nfour\n"),
  );
  await h.reach(change.id, "ready");
  await h.service.keep(change.id);
  const removed = await h.service.remove(change.id);
  const source = h.service.paths.source;
  assert.equal(removed.status, "removed");
  assert.equal(readFileSync(path.join(source, "src", "feature.txt"), "utf8"), "one\ntwo\nthree\n");
  assert.equal(git(source, "status", "--porcelain"), "");
  await assert.rejects(h.service.remove(change.id), { status: 409 });
});

test("removing a change that conflicts with a later one needs you and leaves mine intact", async () => {
  const h = await harness();
  const first = await start(h, "First edit");
  h.finishTurn(h.sessions.get(first.sessionId), write("src/feature.txt", "ONE\ntwo\nthree\n"));
  await h.reach(first.id, "ready");
  await h.service.keep(first.id);
  const second = await start(h, "Second edit");
  h.finishTurn(h.sessions.get(second.sessionId), write("src/feature.txt", "ONE!\ntwo\nthree\n"));
  await h.reach(second.id, "ready");
  await h.service.keep(second.id);
  const before = git(h.service.paths.source, "rev-parse", "mine");
  const result = await h.service.remove(first.id);
  assert.equal(result.status, "needs-you");
  assert.match(result.reason, /conflicts/);
  assert.equal(git(h.service.paths.source, "rev-parse", "mine"), before);
  assert.equal(git(h.service.paths.source, "status", "--porcelain"), "");
  await assert.rejects(h.service.undo(first.id), { status: 409 });
});

test("state survives a restart; interrupted work becomes needs-you", async () => {
  const h = await harness();
  const change = await start(h);
  await h.service.idle();
  const again = createCustomize({
    dataDir: h.dataDir,
    appState: { projects: [], sessions: [] },
    saveApp: async () => {},
    deps: { getSession: () => undefined, isBusy: () => false },
    sourceRoot: h.root,
  });
  await again.init();
  const status = await again.status();
  assert.equal(status.setup.status, "ready");
  assert.equal(status.changes[0].id, change.id);
  assert.equal(status.changes[0].status, "needs-you");
  assert.match(status.changes[0].reason, /restarted/);
});
