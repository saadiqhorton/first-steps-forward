// "Try it": the change's ADE runs from the private copy on a free port with a
// throwaway HOME. The fixture launcher (fixture.test-helper.mjs) is a tiny
// HTTP server; real git, real `npm run build`, real processes.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CRASHING_SERVER, tempDir, makeStockRepo } from "./fixture.test-helper.mjs";

// Never the real home: git and npm read it.
const home = tempDir("ade-preview-home-");
process.env.HOME = home;
process.env.USERPROFILE = home;
// The preview must not inherit this ADE's bind settings.
process.env.ADE_HOST = "0.0.0.0";

const skip = process.platform === "win32" ? "process groups are POSIX" : false;
const { createCustomize } = await import("./index.mjs");
const { runCommand } = await import("../spawn.mjs");
const { allocatePort } = await import("../ports.mjs");
const { previewEnv, seedPreview } = await import("./preview.mjs");

async function waitFor(check, what, ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
// A failed assertion must not leave a preview holding the test process open.
const services = [];
test.after(() => services.forEach((service) => service.shutdown()));
const gone = (pid) => waitFor(() => !alive(pid), `pid ${pid} to exit`, 8000);

/** A ready customize service with one change the scripted agent finished. */
async function harness({
  scripts,
  edit,
  preview = {},
  dataDir = tempDir("ade-preview-data-"),
} = {}) {
  const root = makeStockRepo({ scripts });
  const run = async (bin, args, opts = {}) => {
    if (bin === "npm" && args[0] === "ci") {
      mkdirSync(path.join(opts.cwd, "node_modules"), { recursive: true });
      return { code: 0, stdout: "", stderr: "" };
    }
    return runCommand(bin, args, opts);
  };
  const sessions = new Map();
  let n = 0;
  const service = createCustomize({
    dataDir,
    appState: { projects: [], sessions: [] },
    saveApp: async () => {},
    deps: {
      startSession: async (input) => {
        const session = { id: `s${++n}`, projectId: input.projectId, status: "working" };
        sessions.set(session.id, session);
        return session;
      },
      sendMessage: async (session) => {
        session.status = "working";
      },
      stopSession: async (session) => {
        session.status = "stopped";
      },
      getSession: (id) => sessions.get(id),
      isBusy: (session) => session.status === "working",
    },
    sourceRoot: root,
    run,
    id: () => `c${++n}`,
    checkTimeout: 60000,
    preview,
  });
  services.push(service);
  await service.init();
  await service.startSetup();
  await service.idle();
  const change = async (id) => (await service.status()).changes.find((c) => c.id === id);
  const created = await service.createChange({
    request: "Copy a session's full log",
    agentId: "codex",
  });
  const session = sessions.get(created.sessionId);
  if (edit !== null) {
    (edit ?? ((dir) => writeFileSync(path.join(dir, "src", "feature.txt"), "one\ntwo\n")))(
      service.paths.source,
    );
    session.status = "ready";
    service.onTurnEnd(session);
    await service.idle();
  }
  const previewOf = async (id = created.id) => (await change(id)).preview;
  const reachPreview = (status, id = created.id) =>
    waitFor(async () => {
      const p = await previewOf(id);
      return p.status === status ? p : null;
    }, `preview ${status}`);
  return { service, dataDir, session, id: created.id, change, previewOf, reachPreview };
}
const launcherInfo = (h) =>
  JSON.parse(
    readFileSync(path.join(h.service.paths.homes, `preview-${h.id}`, "preview.json"), "utf8"),
  );

test(
  "Try it serves the built change on a free port with a throwaway HOME; Stop ends the group",
  { skip },
  async () => {
    const h = await harness();
    assert.equal((await h.change(h.id)).status, "ready");
    const started = await h.service.startPreview(h.id);
    assert.equal(started.preview.status, "starting");
    assert.ok(started.triedAt, "the change remembers it was tried");
    const running = await h.reachPreview("running");
    const port = Number(new URL(running.url).port);
    assert.notEqual(port, 3100);
    assert.equal(running.url, `http://127.0.0.1:${port}/`);
    assert.equal(running.rebuilt, undefined, "the build check's output is reused");

    const answer = await (await fetch(`${running.url}api/bootstrap`)).json();
    const previewHome = path.join(h.dataDir, "self", "homes", `preview-${h.id}`);
    assert.equal(answer.home, previewHome);
    const workspace = JSON.parse(
      readFileSync(path.join(previewHome, ".ade", "workspace.json"), "utf8"),
    );
    assert.equal(workspace.projects.length, 1);
    const sample = workspace.projects[0];
    assert.equal(sample.name, "Sample project");
    assert.equal(sample.path, path.join(previewHome, "sample-project"));
    assert.ok(realpathSync(sample.path).startsWith(`${realpathSync(previewHome)}${path.sep}`));
    assert.match(readFileSync(path.join(sample.path, "README.md"), "utf8"), /disposable/i);
    assert.match(readFileSync(path.join(sample.path, "notes.md"), "utf8"), /sample/i);
    assert.deepEqual(workspace.sessions, []);
    assert.deepEqual(workspace.agents, []);
    assert.deepEqual(workspace.processes, []);
    writeFileSync(path.join(sample.path, "notes.md"), "changed in preview");
    const info = launcherInfo(h);
    assert.equal(info.cwd, realpathSync(h.service.paths.source));
    assert.equal(info.adeHost, null);
    assert.ok(!JSON.stringify(await h.change(h.id)).includes("previewProcess"));

    // Starting again while it runs keeps the same preview.
    assert.equal((await h.service.startPreview(h.id)).preview.url, running.url);

    const stopped = await h.service.stopPreview(h.id);
    assert.equal(stopped.preview.status, "stopped");
    await gone(info.pid);
    await gone(info.grandchild);
    assert.ok(!existsSync(previewHome), "the throwaway home is removed");
    await h.service.startPreview(h.id);
    await h.reachPreview("running");
    assert.match(readFileSync(path.join(sample.path, "notes.md"), "utf8"), /sample/i);
    await h.service.stopPreview(h.id);
    assert.ok(!existsSync(previewHome), "the restarted preview home is removed");
  },
);

test(
  "stopping while the sample is being seeded removes it before a clean restart",
  { skip },
  async () => {
    let release;
    let entered;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    let calls = 0;
    const h = await harness({
      preview: {
        seed: async (previewHome) => {
          if (++calls === 1) {
            entered();
            await blocked;
          }
          await seedPreview(previewHome);
        },
      },
    });
    await h.service.startPreview(h.id);
    await started;
    const stopping = h.service.stopPreview(h.id);
    release();
    await stopping;
    const previewHome = path.join(h.dataDir, "self", "homes", `preview-${h.id}`);
    assert.ok(!existsSync(previewHome));
    await h.service.startPreview(h.id);
    await h.reachPreview("running");
    assert.ok(existsSync(path.join(previewHome, "sample-project", "README.md")));
    await h.service.stopPreview(h.id);
  },
);

test("a missing or stale build is built first, with the step reported", { skip }, async () => {
  const h = await harness();
  rmSync(path.join(h.service.paths.source, ".output"), { recursive: true, force: true });
  await h.service.startPreview(h.id);
  const running = await h.reachPreview("running");
  assert.equal(running.rebuilt, true);
  assert.ok(existsSync(path.join(h.service.paths.source, ".output", "public", "_shell.html")));
  await h.service.stopPreview(h.id);
});

test("a change that breaks ADE's start fails with its last output lines", { skip }, async () => {
  const h = await harness({
    edit: (dir) => writeFileSync(path.join(dir, "bin", "ade.mjs"), CRASHING_SERVER),
  });
  await h.service.startPreview(h.id);
  const failed = await h.reachPreview("failed");
  assert.equal(failed.step, "start");
  assert.match(failed.error, /stopped before it was ready/);
  assert.match(failed.output, /broken by this change/);
  // Try again is the same start.
  assert.equal((await h.service.startPreview(h.id)).preview.status, "starting");
  await h.reachPreview("failed");
});

test("a failing build fails the preview at the build step", { skip }, async () => {
  const h = await harness({
    scripts: { build: `node -e "console.error('build exploded'); process.exit(2)"` },
  });
  // The agent gets two tries to fix the build, then the change fails.
  while ((await h.change(h.id)).status === "fixing") {
    h.session.status = "ready";
    h.service.onTurnEnd(h.session);
    await h.service.idle();
  }
  assert.equal((await h.change(h.id)).status, "failed");
  await h.service.startPreview(h.id);
  const failed = await h.reachPreview("failed");
  assert.equal(failed.step, "build");
  assert.match(failed.output, /build exploded/);
});

test("a launcher that never answers times out and is stopped", { skip }, async () => {
  const h = await harness({
    preview: { timeout: 800 },
    edit: (dir) =>
      writeFileSync(
        path.join(dir, "bin", "ade.mjs"),
        "console.log('waiting');setInterval(() => {}, 1000);\n",
      ),
  });
  await h.service.startPreview(h.id);
  const failed = await h.reachPreview("failed");
  assert.match(failed.error, /did not answer within 1 seconds/);
  assert.match(failed.output, /waiting/);
});

test("Undo, a new agent turn and shutdown stop the preview", { skip }, async () => {
  const h = await harness();
  await h.service.startPreview(h.id);
  await h.reachPreview("running");
  let info = launcherInfo(h);
  h.service.onTurnStart(h.session);
  await h.reachPreview("stopped");
  await gone(info.pid);

  await h.service.startPreview(h.id);
  await h.reachPreview("running");
  info = launcherInfo(h);
  h.service.shutdown();
  await gone(info.pid);
  await gone(info.grandchild);
  assert.equal((await h.previewOf()).status, "stopped");

  await h.service.startPreview(h.id);
  await h.reachPreview("running");
  info = launcherInfo(h);
  await h.service.undo(h.id);
  await gone(info.pid);
});

test("Keep stops the preview; a kept change cannot be tried", { skip }, async () => {
  const h = await harness();
  await h.service.startPreview(h.id);
  await h.reachPreview("running");
  const info = launcherInfo(h);
  const kept = await h.service.keep(h.id);
  assert.equal(kept.status, "kept");
  assert.equal(kept.preview.status, "stopped");
  await gone(info.pid);
  await assert.rejects(h.service.startPreview(h.id), { status: 409 });
});

test("a change the agent is still working on cannot be tried", { skip }, async () => {
  const h = await harness({ edit: null });
  await assert.rejects(h.service.startPreview(h.id), { status: 409 });
  await assert.rejects(h.service.startPreview("nope"), { status: 404 });
});

test(
  "on start, stale previews are marked stopped; only ADE's own leftover is killed",
  { skip },
  async () => {
    const h = await harness();
    const source = realpathSync(h.service.paths.source);
    // Ours: a leftover launcher in the copy. Not ours: this test process (another cwd).
    const leftover = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "bin/ade.mjs"], {
      cwd: source,
      detached: true,
      stdio: "ignore",
    });
    const stranger = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "bin/ade.mjs"], {
      cwd: home,
      detached: true,
      stdio: "ignore",
    });
    await h.service.idle();
    const file = path.join(h.dataDir, "self", "state.json");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    saved.changes[0].preview = { status: "running", url: "http://127.0.0.1:1/" };
    saved.changes[0].previewProcess = { pid: leftover.pid, port: 1 };
    saved.changes.push({
      ...saved.changes[0],
      id: "other",
      preview: { status: "starting" },
      previewProcess: { pid: stranger.pid, port: 2 },
    });
    writeFileSync(file, JSON.stringify(saved));

    const again = createCustomize({
      dataDir: h.dataDir,
      appState: { projects: [], sessions: [] },
      saveApp: async () => {},
      deps: {
        startSession: async () => ({}),
        sendMessage: async () => {},
        stopSession: async () => {},
        getSession: () => undefined,
        isBusy: () => false,
      },
    });
    services.push(again);
    await again.init();
    await again.idle();
    const changes = (await again.status()).changes;
    assert.deepEqual(
      changes.map((c) => c.preview.status),
      ["stopped", "stopped"],
    );
    await gone(leftover.pid);
    assert.ok(alive(stranger.pid), "a process that is not ADE's preview is never signalled");
    process.kill(stranger.pid, "SIGKILL");
  },
);

test("ports: never ADE's default port; the preview env drops ADE_* and PORT", async () => {
  const asks = [3100, 3100];
  const port = await allocatePort({
    ask: async () => asks.shift() ?? (await import("../ports.mjs")).ephemeralPort(),
  });
  assert.notEqual(port, 3100);
  assert.deepEqual(previewEnv("/h", { ADE_TOKEN: "t", ADE_HOST: "x", PORT: "1", PATH: "/bin" }), {
    PATH: "/bin",
    HOME: "/h",
    USERPROFILE: "/h",
  });
});
