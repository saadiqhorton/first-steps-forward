// Updates: a newer stock ADE is imported, kept changes are re-applied one by one
// (the agent resolves conflicts and failing checks), and the old build keeps
// running until the user restarts. Real git and checks, scripted agent, stubbed
// `npm ci`, no network. A folder named by ADE_SELF_STOCK_SOURCE stands in for the new release.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tempDir, git, makeStockRepo } from "./fixture.test-helper.mjs";

const home = tempDir("ade-update-home-");
process.env.HOME = home;
process.env.USERPROFILE = home;

const { createCustomize } = await import("./index.mjs");
const { runCommand } = await import("../spawn.mjs");
const { compareVersions } = await import("./update.mjs");

async function waitFor(check, what, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const write = (rel, text) => (dir) => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), text);
};

/** A fresh release of the stock fixture: its files at HEAD, a new version, then `edit`. */
function release(root, version, edit) {
  const dir = tempDir("ade-release-");
  execFileSync("sh", ["-c", 'git -C "$1" archive HEAD | tar -x -C "$2"', "sh", root, dir]);
  const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ ...manifest, version }));
  edit?.(dir);
  return dir;
}

/** A ready service with one kept change (a fourth line in src/feature.txt). */
async function keptHarness({ scripts, launcher, keepLine = "four", dataDir } = {}) {
  dataDir ??= tempDir("ade-update-data-");
  const root = makeStockRepo({ scripts });
  const env = {};
  const installs = [];
  const run = async (bin, args, opts = {}) => {
    if (bin === "npm" && args[0] === "ci") {
      installs.push(opts.cwd);
      mkdirSync(path.join(opts.cwd, "node_modules"), { recursive: true });
      return { code: 0, stdout: "", stderr: "" };
    }
    return runCommand(bin, args, opts);
  };
  const sessions = new Map();
  const started = [];
  const sent = [];
  const stopped = [];
  let n = 0;
  const deps = {
    startSession: async (input) => {
      started.push(input);
      const session = {
        id: `u${++n}`,
        projectId: input.projectId,
        agentId: input.agentId,
        status: "working",
        messages: [],
      };
      sessions.set(session.id, session);
      return session;
    },
    sendMessage: async (session, text, presentation) => {
      sent.push({ id: session.id, text, presentation });
      session.status = "working";
    },
    stopSession: async (session) => {
      stopped.push(session.id);
      session.status = "stopped";
    },
    getSession: (id) => sessions.get(id),
    isBusy: (session) => session.status === "working",
  };
  let ids = 0;
  const appState = { projects: [], sessions: [] };
  const make = (extra = {}) =>
    createCustomize({
      dataDir,
      appState,
      saveApp: async () => {},
      deps,
      sourceRoot: root,
      env,
      run,
      id: () => `c${++ids}`,
      checkTimeout: 60000,
      ...extra,
    });
  const service = make(launcher ? { launcher, switching: { poll: 20 } } : {});
  await service.init();
  await service.startSetup();
  await service.idle();
  const source = service.paths.source;
  const created = await service.createChange({ request: "Add a fourth line", agentId: "codex" });
  const session = sessions.get(created.sessionId);
  write("src/feature.txt", `one\ntwo\nthree\n${keepLine}\n`)(source);
  session.status = "ready";
  service.onTurnEnd(session);
  await waitFor(async () => (await service.status()).changes[0].status === "ready", "ready");
  const kept = await service.keep(created.id);
  await service.idle();
  /** The agent for a re-apply session finishes its turn after `edit(dir)`. */
  const finishUpdateTurn = async (edit, index = 0) => {
    const live = await waitFor(
      () => [...sessions.values()].filter((s) => s.projectId === "ade-self-update")[index],
      "an update session",
    );
    edit?.(service.paths.updateWork);
    live.status = "ready";
    service.onTurnEnd(live);
    return live;
  };
  const update = async () => (await service.status()).update;
  const reach = (status) =>
    waitFor(
      async () => (await update())?.status === status && (await update()),
      `update ${status}`,
    );
  return {
    service,
    dataDir,
    root,
    env,
    installs,
    sessions,
    started,
    sent,
    stopped,
    kept,
    appState,
    finishUpdateTurn,
    update,
    reach,
    make,
    source,
    /** Agent sessions the update started (not the kept change's own). */
    upStarted: () => started.filter((input) => input.projectId === "ade-self-update"),
  };
}

test("versions compare numerically", () => {
  assert.equal(compareVersions("0.1.16", "0.1.15"), 1);
  assert.equal(compareVersions("0.1.9", "0.1.10"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), 0);
});

test("the same version is not an update, and stock source overrides are honoured", async () => {
  const h = await keptHarness();
  h.env.ADE_SELF_STOCK_SOURCE = release(h.root, "1.2.3");
  assert.deepEqual(await h.service.checkForUpdate(), { started: false, reason: "up to date" });
  assert.equal((await h.service.status()).update, null);
  h.env.ADE_SELF_STOCK_SOURCE = path.join(home, "nowhere");
  assert.equal((await h.service.checkForUpdate()).started, false);
});

test("a clean update applies kept changes onto the new stock, checks, and waits for a restart", async () => {
  const h = await keptHarness({ launcher: () => ({ running: null, restart: () => {} }) });
  const oldBuild = JSON.parse(
    readFileSync(path.join(h.service.paths.root, "current.json"), "utf8"),
  );
  h.env.ADE_SELF_STOCK_SOURCE = release(h.root, "1.3.0", write("src/other.txt", "new in 1.3.0\n"));
  const first = await h.service.checkForUpdate();
  assert.equal(first.started, true);
  assert.deepEqual(await h.service.checkForUpdate().then((r) => r.started), false, "no second run");
  const done = await h.reach("done");
  assert.deepEqual(
    { from: done.from, to: done.to, changes: done.changes.map((c) => [c.title, c.status]) },
    { from: "1.2.3", to: "1.3.0", changes: [["Add a fourth line", "applied"]] },
  );
  assert.ok(done.checks.every((c) => ["passed", "skipped"].includes(c.status)));
  await h.service.idle();
  const source = h.service.paths.source;
  assert.equal(git(source, "log", "-1", "--format=%s", "stock"), "ADE 1.3.0");
  assert.equal(git(source, "rev-list", "--count", "stock..mine"), "1");
  assert.equal(
    readFileSync(path.join(source, "src", "feature.txt"), "utf8"),
    "one\ntwo\nthree\nfour\n",
  );
  assert.equal(readFileSync(path.join(source, "src", "other.txt"), "utf8"), "new in 1.3.0\n");
  // The running version is untouched; the new one is built and pending.
  const status = await h.service.status();
  assert.equal(status.switch.status, "pending");
  assert.notEqual(status.switch.target, oldBuild.sha);
  assert.ok(
    existsSync(path.join(h.service.paths.builds, status.switch.target, ".output", "public")),
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(h.service.paths.root, "current.json"), "utf8")).sha,
    status.switch.target,
  );
  assert.equal(
    h.started.filter((s) => s.projectId === "ade-self-update").length,
    0,
    "no agent needed",
  );

  // After the restart lands, the update is over.
  const next = h.make({ launcher: () => ({ running: status.switch.target, restart: () => {} }) });
  await next.init();
  assert.equal((await next.status()).update, null);
  assert.ok(!existsSync(h.service.paths.updateWork), "the working folder is gone");
  assert.equal((await next.checkForUpdate()).reason, "up to date");
});

test("a conflict goes to the agent with the change's request; its resolution is kept", async () => {
  const h = await keptHarness();
  h.env.ADE_SELF_STOCK_SOURCE = release(
    h.root,
    "1.3.0",
    write("src/feature.txt", "one\ntwo\nthree\nfour but different\n"),
  );
  await h.service.checkForUpdate();
  await h.finishUpdateTurn(write("src/feature.txt", "one\ntwo\nthree\nfour but different\nfour\n"));
  const done = await h.reach("done");
  assert.deepEqual(
    done.changes.map((c) => c.status),
    ["applied"],
  );
  const [input] = h.upStarted();
  assert.equal(input.projectId, "ade-self-update");
  assert.equal(input.permission, "build");
  assert.match(
    input.request,
    /Re-apply this change to ADE 1\.3\.0: Add a fourth line\. Original request: Add a fourth line/,
  );
  assert.match(input.request, /src\/feature\.txt/);
  assert.equal(h.appState.projects.find((p) => p.id === "ade-self-update").hidden, true);
  await h.service.idle();
  assert.equal(
    readFileSync(path.join(h.service.paths.source, "src", "feature.txt"), "utf8"),
    "one\ntwo\nthree\nfour but different\nfour\n",
  );
});

test("two failed attempts need you; Retry starts the agent again, Update without it drops the change", async () => {
  const h = await keptHarness();
  h.env.ADE_SELF_STOCK_SOURCE = release(
    h.root,
    "1.3.0",
    write("src/feature.txt", "one\ntwo\nthree\nfour but different\n"),
  );
  await h.service.checkForUpdate();
  // Attempt 1 leaves the conflict markers in place; attempt 2 too.
  await h.finishUpdateTurn();
  await waitFor(() => h.sent.length === 1, "the second attempt");
  assert.match(h.sent[0].text, /still has conflict markers/);
  assert.equal(h.sent[0].presentation.kind, "ade");
  const live = [...h.sessions.values()].find((s) => s.projectId === "ade-self-update");
  live.status = "ready";
  h.service.onTurnEnd(live);
  const stuck = await h.reach("needs-you");
  assert.equal(stuck.changes[0].status, "needs-you");
  assert.match(stuck.changes[0].reason, /conflicts with ADE 1\.3\.0 in src\/feature\.txt/);
  assert.equal(h.upStarted().length, 1);
  assert.equal(
    git(h.service.paths.source, "log", "-1", "--format=%s", "stock"),
    "ADE 1.2.3",
    "stock not moved yet",
  );

  // Retry: a fresh session; this time the agent resolves it.
  const changeId = stuck.changes[0].id;
  await h.service.retryUpdate(changeId);
  const second = await waitFor(
    () => h.upStarted().length === 2 && h.upStarted()[1],
    "a new session",
  );
  assert.match(second.request, /Re-apply this change/);
  // It leaves the markers again (two turns), so the change needs you again; give up on it: skip.
  const live2 = [...h.sessions.values()].filter((s) => s.projectId === "ade-self-update").at(-1);
  for (const turns of [1, 2]) {
    if (turns === 2) await waitFor(() => h.sent.length === 2, "the second attempt");
    live2.status = "ready";
    h.service.onTurnEnd(live2);
  }
  await waitFor(async () => (await h.update())?.status === "needs-you", "needs you again");
  await h.service.skipUpdate(changeId);
  const done = await h.reach("done");
  assert.deepEqual(
    done.changes.map((c) => c.status),
    ["dropped"],
  );
  await h.service.idle();
  const changes = (await h.service.status()).changes;
  assert.equal(changes[0].status, "removed");
  assert.match(changes[0].reason, /Left out of the update to ADE 1\.3\.0/);
  assert.equal(git(h.service.paths.source, "log", "-1", "--format=%s", "stock"), "ADE 1.3.0");
  assert.equal(
    readFileSync(path.join(h.service.paths.source, "src", "feature.txt"), "utf8"),
    "one\ntwo\nthree\nfour but different\n",
  );
});

test("a check that fails after a clean apply goes to the agent for the change it names", async () => {
  const h = await keptHarness();
  // 1.3.0 refuses a feature file with a fourth line; the kept change applies cleanly but breaks it.
  const script = `node -e "const t=require('fs').readFileSync('src/feature.txt','utf8');if(t.includes('four')){console.error('src/feature.txt has four lines');process.exit(1)}"`;
  h.env.ADE_SELF_STOCK_SOURCE = release(h.root, "1.3.0", (dir) => {
    const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    manifest.scripts.test = script;
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
  });
  await h.service.checkForUpdate();
  await h.finishUpdateTurn(write("src/feature.txt", "one\ntwo\nthree\n4\n"));
  const done = await h.reach("done");
  assert.equal(done.changes[0].status, "applied");
  assert.match(h.upStarted()[0].request, /Check "Tests" failed/);
  assert.match(h.upStarted()[0].request, /src\/feature\.txt has four lines/);
  await h.service.idle();
  assert.equal(
    readFileSync(path.join(h.service.paths.source, "src", "feature.txt"), "utf8"),
    "one\ntwo\nthree\n4\n",
  );
});

test("changes survive successive updates and can then be removed", async () => {
  const h = await keptHarness({ launcher: () => ({ running: null, restart: () => {} }) });
  h.env.ADE_SELF_STOCK_SOURCE = release(h.root, "1.3.0");
  await h.service.checkForUpdate();
  await h.reach("done");
  await h.service.idle();
  const target = (await h.service.status()).switch.target;
  const next = h.make({ launcher: () => ({ running: target, restart: () => {} }) });
  await next.init();
  h.env.ADE_SELF_STOCK_SOURCE = release(h.root, "1.4.0");
  await next.checkForUpdate();
  await waitFor(async () => (await next.status()).update?.status === "done", "second update");
  await next.idle();
  assert.match(readFileSync(path.join(h.source, "src/feature.txt"), "utf8"), /four/);
  assert.equal((await next.remove(h.kept.id)).status, "removed");
  await next.idle();
  assert.doesNotMatch(readFileSync(path.join(h.source, "src/feature.txt"), "utf8"), /four/);
});

test("a conflict during a multi-commit removal restores every reverted commit", async () => {
  const h = await keptHarness();
  h.env.ADE_SELF_STOCK_SOURCE = release(h.root, "1.3.0", (dir) => {
    const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    manifest.scripts.test = `node -e "const f=require('fs');if(f.readFileSync('src/feature.txt','utf8').includes('four')&&!f.existsSync('fixed.txt'))process.exit(1)"`;
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
  });
  await h.service.checkForUpdate();
  await h.finishUpdateTurn(write("fixed.txt", "fixed\n"));
  await h.reach("done");
  await h.service.idle();
  const target = (await h.service.status()).switch.target;
  const next = h.make({ launcher: () => ({ running: target, restart: () => {} }) });
  await next.init();
  const second = await next.createChange({ request: "Edit the fourth line", agentId: "codex" });
  write("src/feature.txt", "one\ntwo\nthree\nFOUR changed\n")(h.source);
  const session = h.sessions.get(second.sessionId);
  session.status = "ready";
  next.onTurnEnd(session);
  await waitFor(
    async () => (await next.status()).changes.find((c) => c.id === second.id).status === "ready",
    "second change",
  );
  await next.keep(second.id);
  await next.idle();
  const before = git(h.source, "rev-parse", "mine");
  assert.equal((await next.remove(h.kept.id)).status, "needs-you");
  assert.equal(git(h.source, "rev-parse", "mine"), before);
  assert.equal(git(h.source, "status", "--porcelain"), "");
  assert.equal(readFileSync(path.join(h.source, "fixed.txt"), "utf8"), "fixed\n");
});

test("skipping one change then staying preserves its kept status", async () => {
  const h = await keptHarness();
  const second = await h.service.createChange({ request: "Change another file", agentId: "codex" });
  write("src/other.txt", "custom\n")(h.source);
  const session = h.sessions.get(second.sessionId);
  session.status = "ready";
  h.service.onTurnEnd(session);
  await waitFor(
    async () =>
      (await h.service.status()).changes.find((c) => c.id === second.id).status === "ready",
    "second change",
  );
  await h.service.keep(second.id);
  await h.service.idle();
  h.env.ADE_SELF_STOCK_SOURCE = release(h.root, "1.3.0", (dir) => {
    write("src/feature.txt", "conflict\n")(dir);
    write("src/other.txt", "stock\n")(dir);
  });
  await h.service.checkForUpdate();
  const live = await h.finishUpdateTurn();
  await waitFor(() => h.sent.length === 1, "retry");
  live.status = "ready";
  h.service.onTurnEnd(live);
  await h.reach("needs-you");
  await h.service.skipUpdate(h.kept.id);
  await waitFor(() => h.upStarted().length === 2, "second conflict");
  await h.service.stayOnCurrent();
  const changes = (await h.service.status()).changes;
  assert.equal(changes.find((c) => c.id === h.kept.id).status, "kept");
  assert.match(readFileSync(path.join(h.source, "src/feature.txt"), "utf8"), /four/);
});

test("checks that still fail after two attempts need you", async () => {
  const h = await keptHarness();
  h.env.ADE_SELF_STOCK_SOURCE = release(h.root, "1.3.0", (dir) => {
    const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    manifest.scripts.lint = `node -e "console.error('src/feature.txt: always wrong');process.exit(1)"`;
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
  });
  await h.service.checkForUpdate();
  const live = await h.finishUpdateTurn(write("src/feature.txt", "one\ntwo\nthree\nfour\nfive\n"));
  await waitFor(() => h.sent.length === 1, "the second attempt");
  live.status = "ready";
  h.service.onTurnEnd(live);
  const stuck = await h.reach("needs-you");
  assert.match(stuck.changes[0].reason, /Lint did not pass on ADE 1\.3\.0/);
  assert.equal(h.upStarted().length, 1, "attempt two reused the session");
});

test("Stay on the current version abandons the attempt and does not nag again", async () => {
  const h = await keptHarness();
  const before = git(h.service.paths.source, "rev-parse", "mine");
  h.env.ADE_SELF_STOCK_SOURCE = release(h.root, "1.3.0", write("src/feature.txt", "other\n"));
  await h.service.checkForUpdate();
  await waitFor(() => h.upStarted().length === 1, "the agent");
  await h.service.stayOnCurrent();
  assert.equal((await h.service.status()).update, null);
  assert.equal(h.stopped.length, 1);
  assert.equal(git(h.service.paths.source, "rev-parse", "mine"), before);
  assert.equal(git(h.service.paths.source, "log", "-1", "--format=%s", "stock"), "ADE 1.2.3");
  assert.ok(!existsSync(h.service.paths.updateWork));
  assert.equal((await h.service.checkForUpdate()).reason, "staying");
  // The next version is offered again.
  h.env.ADE_SELF_STOCK_SOURCE = release(h.root, "1.4.0", write("src/other.txt", "x\n"));
  assert.equal((await h.service.checkForUpdate()).started, true);
  await h.service.idle();
});

test("an update waits while a change is in progress, and blocks new changes while it runs", async () => {
  const h = await keptHarness();
  h.env.ADE_SELF_STOCK_SOURCE = release(h.root, "1.3.0", write("src/feature.txt", "other\n"));
  await h.service.checkForUpdate();
  await assert.rejects(
    h.service.createChange({ request: "Something else", agentId: "codex" }),
    /updating your changes/,
  );
  await h.service.stayOnCurrent();
  const open = await h.service.createChange({ request: "Something else", agentId: "codex" });
  h.env.ADE_SELF_STOCK_SOURCE = release(h.root, "1.5.0");
  assert.match((await h.service.checkForUpdate()).reason, /change in progress/);
  await h.service.undo(open.id);
});

test("with no kept changes an update moves quietly to the new stock", async () => {
  const dataDir = tempDir("ade-update-quiet-");
  const root = makeStockRepo();
  const env = {};
  const run = async (bin, args, opts = {}) => {
    if (bin === "npm" && args[0] === "ci") {
      mkdirSync(path.join(opts.cwd, "node_modules"), { recursive: true });
      return { code: 0, stdout: "", stderr: "" };
    }
    return runCommand(bin, args, opts);
  };
  const service = createCustomize({
    dataDir,
    appState: { projects: [], sessions: [] },
    saveApp: async () => {},
    sourceRoot: root,
    env,
    run,
    deps: { getSession: () => null, isBusy: () => false },
  });
  await service.init();
  await service.startSetup();
  await service.idle();
  env.ADE_SELF_STOCK_SOURCE = release(root, "1.3.0", write("src/other.txt", "x\n"));
  assert.equal((await service.checkForUpdate()).started, true);
  await service.idle();
  assert.equal((await service.status()).update, null);
  assert.equal(
    git(service.paths.source, "rev-parse", "mine"),
    git(service.paths.source, "rev-parse", "stock"),
  );
  assert.equal(readFileSync(path.join(service.paths.source, "src", "other.txt"), "utf8"), "x\n");
  assert.equal((await service.checkForUpdate()).reason, "up to date");
});

test("a new version with different dependencies gets its own install, then the copy follows", async () => {
  const h = await keptHarness({ launcher: () => ({ running: null, restart: () => {} }) });
  const installsBefore = h.installs.length;
  h.env.ADE_SELF_STOCK_SOURCE = release(h.root, "1.3.0", (dir) => {
    const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ ...manifest, dependencies: { left: "1.0.0" } }),
    );
  });
  await h.service.checkForUpdate();
  await h.reach("done");
  await h.service.idle();
  const installed = h.installs.slice(installsBefore);
  assert.equal(installed.length, 2, "the working folder and the new build each install");
  assert.ok(installed[0].endsWith(path.join("update", "work")));
  assert.ok(installed[1].includes(`${path.sep}builds${path.sep}`));
  const target = (await h.service.status()).switch.target;
  assert.ok(!lstatSync(path.join(h.service.paths.builds, target, "node_modules")).isSymbolicLink());
});

test("a build links the copy's dependencies unless its change touched them", async () => {
  const h = await keptHarness();
  const build = path.join(h.service.paths.builds, h.kept.commit);
  assert.ok(lstatSync(path.join(build, "node_modules")).isSymbolicLink());
  assert.equal(h.installs.length, 1, "only setup installed");

  // A kept change that adds a dependency: its build installs on its own.
  const created = await h.service.createChange({ request: "Use a library", agentId: "codex" });
  const live = h.sessions.get(created.sessionId);
  const manifestPath = path.join(h.source, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  write("package.json", JSON.stringify({ ...manifest, dependencies: { lib: "1.0.0" } }))(h.source);
  live.status = "ready";
  h.service.onTurnEnd(live);
  await waitFor(async () => (await h.service.status()).changes[0].status === "ready", "ready");
  const kept = await h.service.keep(created.id);
  await h.service.idle();
  const own = path.join(h.service.paths.builds, kept.commit);
  assert.ok(!lstatSync(path.join(own, "node_modules")).isSymbolicLink());
  assert.equal(h.installs.length, 2);
  assert.ok(h.installs[1].includes(`${path.sep}builds${path.sep}`));
});

test("a version-only release keeps the dependency hash, a dependency change does not", async () => {
  const { hashDeps } = await import("./builds.mjs");
  const pkg = (version, deps) => JSON.stringify({ name: "ade", version, dependencies: deps });
  const lock = (version, deps) =>
    JSON.stringify({
      name: "ade",
      version,
      lockfileVersion: 3,
      packages: {
        "": { name: "ade", version, dependencies: deps },
        "node_modules/ws": { version: "8.21.1" },
      },
    });
  const deps = { ws: "8.21.1" };
  assert.equal(
    hashDeps(pkg("0.1.15", deps), lock("0.1.15", deps)),
    hashDeps(pkg("0.1.16", deps), lock("0.1.16", deps)),
  );
  const more = { ws: "8.21.1", zod: "^3.25.76" };
  assert.notEqual(
    hashDeps(pkg("0.1.15", deps), lock("0.1.15", deps)),
    hashDeps(pkg("0.1.16", more), lock("0.1.16", more)),
  );
});
