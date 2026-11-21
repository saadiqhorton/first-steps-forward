// The Customize ADE service against a fixture git checkout, with a scripted
// agent and a stubbed `npm ci`. Real git, real `npm run <script>` checks.
import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
async function harness({
  scripts,
  install,
  ready = true,
  sourceRoot,
  launcher,
  dataDir: given,
} = {}) {
  const dataDir = given ?? tempDir("ade-customize-data-");
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
  const presented = [];
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
    sendMessage: async (session, text, presentation) => {
      sent.push(text);
      presented.push(presentation);
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
    ...(launcher ? { launcher, switching: { poll: 20 } } : {}),
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
    presented,
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
  assert.deepEqual(status.switch, { status: "idle", launcher: false, command: "ade" });
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
  assert.equal(setup.step, "install", "the failed step stays visible");
  assert.match(setup.error, /ETIMEDOUT/);
  assert.ok(!existsSync(h.service.paths.source));
  assert.ok(!existsSync(h.service.paths.partial));
  assert.equal(h.appState.projects.length, 0);
  // Retry works once the install does.
  const retry = await harness({ ready: true });
  assert.equal((await retry.service.status()).setup.status, "ready");
});

test("install progress counts lockfile packages as they land", async () => {
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": { name: "stock" },
      "node_modules/a": {},
      "node_modules/@s/b": {},
      "node_modules/a/node_modules/c": {},
      "node_modules/linked": { link: true },
    },
  };
  const root = makeStockRepo();
  writeFileSync(path.join(root, "package-lock.json"), JSON.stringify(lock));
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "lock");
  let seen = null;
  const h = await harness({
    sourceRoot: root,
    ready: false,
    install: async (opts) => {
      seen = (await h.service.status()).setup;
      write("node_modules/a/package.json", "{}")(opts.cwd);
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  await h.service.startSetup();
  await h.service.idle();
  assert.deepEqual(seen.progress, { done: 0, total: 2, label: "0 of 2 packages" });
  const { lockedPackages, installedCount } = await import("./setup.mjs");
  const dir = tempDir("ade-lock-");
  writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify(lock));
  const packages = await lockedPackages(dir);
  assert.deepEqual(packages, ["node_modules/a", "node_modules/@s/b"]);
  write("node_modules/@s/b/package.json", "{}")(dir);
  assert.equal(await installedCount(dir, packages), 1);
  assert.equal(await lockedPackages(tempDir("ade-nolock-")), null);
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
  // The conversation shows one line from ADE, not the 80-line prompt.
  assert.deepEqual(h.presented[0], {
    kind: "ade",
    text: "ADE sent the failing Tests output to the agent (attempt 1 of 2)",
    references: [],
  });
  assert.match(h.sent[0], /What failed:\n- boom: expected 1 got 2/);
  h.finishTurn(session, write("b.txt", "b"));
  await waitFor(() => h.sent.length === 2, "second follow-up");
  h.finishTurn(session, write("c.txt", "c"));
  const failed = await h.reach(change.id, "failed");
  assert.equal(failed.fixAttempts, 2);
  assert.equal(h.sent.length, 2);
  assert.equal(
    h.presented[1].text,
    "ADE sent the failing Tests output to the agent (attempt 2 of 2)",
  );
  assert.match(failed.reason, /Tests/);
  const test_ = failed.checks.find((c) => c.id === "test");
  assert.equal(test_.status, "failed");
  assert.match(test_.output, /boom/);
  assert.deepEqual(test_.failures, ["boom: expected 1 got 2"]);
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
  // The kept version is prepared from the checks' build of this exact tree, then pending.
  assert.equal((await h.service.status()).switch.status, "preparing");
  const checkBuild = readFileSync(path.join(source, ".output", "public", "_shell.html"), "utf8");
  await h.service.idle();
  const status = await h.service.status();
  assert.equal(status.switch.status, "pending");
  assert.equal(status.switch.target, kept.commit);
  assert.equal(status.switch.launcher, false);
  assert.equal(status.switch.command, "ade");
  const build = path.join(h.service.paths.builds, kept.commit);
  assert.equal(
    readFileSync(path.join(build, ".output", "public", "_shell.html"), "utf8"),
    checkBuild,
  );
  assert.equal(
    readFileSync(path.join(build, "src", "feature.txt"), "utf8"),
    "one\ntwo\nthree\nfour\n",
  );
  assert.ok(existsSync(path.join(build, "bin", "ade.mjs")));
  assert.ok(existsSync(path.join(build, "node_modules")), "dependencies are linked from the copy");
  const current = JSON.parse(readFileSync(path.join(h.service.paths.root, "current.json"), "utf8"));
  assert.deepEqual(current, { sha: kept.commit, version: "1.2.3", previous: { sha: null } });
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
  // Back to stock's exact files: no build needed, current.json says stock, kept builds pruned to one.
  await h.service.idle();
  const current = JSON.parse(readFileSync(path.join(h.service.paths.root, "current.json"), "utf8"));
  assert.equal(current.sha, null);
  assert.ok(current.previous.sha);
  assert.equal((await h.service.status()).switch.status, "idle");
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

/** A kept change, prepared as the next version; returns the harness and its commit. */
async function keptHarness(options) {
  const h = await harness(options);
  const change = await start(h, "Add a line");
  h.finishTurn(
    h.sessions.get(change.sessionId),
    write("src/feature.txt", "one\ntwo\nthree\nfour\n"),
  );
  await h.reach(change.id, "ready");
  const kept = await h.service.keep(change.id);
  return { h, commit: kept.commit };
}

test("Restart ADE waits for every working agent, backs up the workspace, then restarts", async () => {
  const restarts = [];
  const { h, commit } = await keptHarness({
    launcher: () => ({ running: null, restart: () => restarts.push(Date.now()) }),
  });
  writeFileSync(path.join(h.dataDir, "workspace.json"), '{"projects":[]}');
  // An agent in some other project of the workspace is still working.
  const other = { id: "elsewhere", projectId: "p1", status: "working" };
  h.appState.sessions.push(other);
  const waiting = await h.service.restart();
  assert.equal(waiting.status, "waiting");
  assert.equal(waiting.waitingFor, 1);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(restarts.length, 0, "no restart while an agent works");
  assert.equal((await h.service.status()).switch.waitingFor, 1);
  other.status = "verifying";
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(restarts.length, 0, "verifying counts as working");
  other.status = "ready";
  await waitFor(() => restarts.length === 1, "the restart");
  const status = await h.service.status();
  assert.equal(status.switch.status, "restarting");
  assert.equal(status.switch.target, commit);
  assert.equal(status.switch.launcher, true);
  const backups = readdirSync(h.service.paths.backups);
  assert.equal(backups.length, 1);
  assert.equal(
    readFileSync(path.join(h.service.paths.backups, backups[0]), "utf8"),
    '{"projects":[]}',
  );
  // Saved before the launcher stops this server, so the next one knows what happened.
  const saved = JSON.parse(readFileSync(h.service.paths.state, "utf8"));
  assert.equal(saved.switch.status, "restarting");
});

test("a restart with nothing new, or without a launcher, is refused plainly", async () => {
  const h = await harness({ launcher: () => ({ running: null, restart: () => {} }) });
  await assert.rejects(h.service.restart(), { status: 409, message: /nothing new/ });
  const { h: plain } = await keptHarness();
  await plain.service.idle();
  await assert.rejects(plain.service.restart(), {
    status: 409,
    message: "Restart ADE to use your changes: stop it and run `ade`.",
  });
});

test("the next ADE reconciles the switch: restarted on the target, or --stock", async () => {
  const { h, commit } = await keptHarness();
  await h.service.idle();
  const saved = JSON.parse(readFileSync(h.service.paths.state, "utf8"));
  saved.switch = { status: "restarting", target: commit };
  writeFileSync(h.service.paths.state, JSON.stringify(saved));
  const next = await harness({
    ready: false,
    dataDir: h.dataDir,
    sourceRoot: h.root,
    launcher: () => ({ running: commit, restart: () => {} }),
  });
  const status = await next.service.status();
  assert.deepEqual(status.current, { stock: false, sha: commit });
  assert.equal(status.switch.status, "idle");
  assert.ok(status.switch.restartedAt);

  const stock = await harness({
    ready: false,
    dataDir: h.dataDir,
    sourceRoot: h.root,
    launcher: () => ({ running: null, restart: null, stockFlag: true, command: "ade" }),
  });
  const without = await stock.service.status();
  assert.deepEqual(without.current, { stock: true, sha: null, withoutChanges: true });
  assert.equal(without.switch.status, "idle", "--stock is not a pending switch");
});

test("a kept version that fails to build is reported, and Restart ADE retries the build", async () => {
  const flag = path.join(tempDir("ade-build-flag-"), "fail");
  writeFileSync(flag, "");
  const builder = path.join(tempDir("ade-build-script-"), "build.cjs");
  writeFileSync(
    builder,
    `const fs = require("fs");
if (process.cwd().includes("builds") && fs.existsSync(${JSON.stringify(flag)})) {
  console.error("vite: cannot resolve x");
  process.exit(1);
}
fs.mkdirSync(".output/public", { recursive: true });
fs.writeFileSync(".output/public/_shell.html", "ok");`,
  );
  const h = await harness({
    launcher: () => ({ running: null, restart: () => {} }),
    scripts: { build: `node ${JSON.stringify(builder)}` },
  });
  const change = await start(h, "Add a line");
  h.finishTurn(h.sessions.get(change.sessionId), write("src/feature.txt", "x\n"));
  await h.reach(change.id, "ready");
  // Without the checks' output to reuse, the kept version is built on its own.
  rmSync(path.join(h.service.paths.source, ".output"), { recursive: true, force: true });
  await h.service.keep(change.id);
  await h.service.idle();
  let sw = (await h.service.status()).switch;
  assert.equal(sw.status, "failed");
  assert.equal(sw.step, "build");
  assert.equal(sw.error, "Building your version failed.");
  assert.match(sw.output, /cannot resolve x/);
  assert.ok(!existsSync(path.join(h.service.paths.builds, sw.target)), "nothing half-made");
  rmSync(flag);
  await h.service.restart();
  await waitFor(async () => (await h.service.status()).switch.status === "restarting", "restart");
  sw = (await h.service.status()).switch;
  assert.equal(sw.error, undefined);
  assert.ok(existsSync(path.join(h.service.paths.builds, sw.target, ".output", "public")));
});

test("backups keep the newest five", async () => {
  const { backupWorkspace } = await import("./switch.mjs");
  const { selfPaths } = await import("./paths.mjs");
  const dataDir = tempDir("ade-backups-");
  const paths = selfPaths(dataDir);
  assert.equal(await backupWorkspace(paths, 0), null, "no workspace yet");
  writeFileSync(paths.workspace, "{}");
  for (let i = 0; i < 7; i++) await backupWorkspace(paths, Date.UTC(2026, 0, 1, 0, 0, i));
  const kept = readdirSync(paths.backups).sort();
  assert.equal(kept.length, 5);
  assert.equal(kept[0], "2026-01-01T00-00-02-000Z.json");
  if (process.platform !== "win32")
    assert.equal(statSync(path.join(paths.backups, kept[0])).mode & 0o777, 0o600);
});

test("failures: node --test, tsc and eslint output put what failed first", async () => {
  const { extractFailures, summarize } = await import("./checks.mjs");
  const spec = [
    "✖ copies the whole log (1.6ms)",
    "▶ suite",
    "  ✖ nested breaks (0.2ms)",
    "✖ suite (0.5ms)",
    "ℹ tests 3",
    "ℹ pass 1",
    "ℹ fail 2",
    "",
    "✖ failing tests:",
    "",
    "test at a.test.mjs:3:1",
    "✖ copies the whole log (1.6ms)",
    "  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
    "",
    "test at a.test.mjs:5:32",
    "✖ nested breaks (0.2ms)",
    "  Error: boom",
  ].join("\n");
  assert.deepEqual(extractFailures("test", spec), [
    "copies the whole log: AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:",
    "nested breaks: Error: boom",
  ]);
  assert.equal(summarize("test", spec, false), "2 failed");
  const tap =
    "TAP version 13\nnot ok 1 - copies the whole log\n  ---\nok 2 - passes\n# pass 1\n# fail 1\n";
  assert.deepEqual(extractFailures("test", tap), ["copies the whole log"]);
  const tsc =
    "src/a.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.\nsrc/b.ts(3,1): error TS2304: Cannot find name 'x'.\n";
  assert.deepEqual(extractFailures("typecheck", tsc), [
    "src/a.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    "src/b.ts(3,1): error TS2304: Cannot find name 'x'.",
  ]);
  assert.equal(summarize("typecheck", tsc, false), "2 errors");
  const eslint = [
    "",
    "/home/u/ade/src/lib/copyLog.ts",
    "  1:36  error  Unexpected 'debugger' statement                 no-debugger",
    "  2:1   error  Unexpected var, use let or const instead        no-var",
    "  4:1   warning  Unused thing                                  no-unused-vars",
    "",
    "✖ 3 problems (2 errors, 1 warning)",
  ].join("\n");
  assert.deepEqual(extractFailures("lint", eslint), [
    "copyLog.ts:1 Unexpected 'debugger' statement (no-debugger)",
    "copyLog.ts:2 Unexpected var, use let or const instead (no-var)",
  ]);
  assert.deepEqual(
    extractFailures("build", "\x1b[31merror\x1b[0m during build:\nnpm error code 1\n"),
    ["error during build:"],
  );
});
