import test from "node:test";
import assert from "node:assert/strict";
import { createComputerManager, SCREEN } from "./computer.mjs";

const coded = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

function fakeInstaller({ state = "installed", progress, executable } = {}) {
  const installer = {
    state,
    waits: [],
    status: () =>
      installer.state === "installing"
        ? { state: "installing", progress }
        : installer.state === "unsupported"
          ? { state: "unsupported", detail: "Not on freebsd-x64." }
          : { state: installer.state },
    async executable({ wait } = {}) {
      installer.waits.push(wait);
      return executable ? executable() : "/opt/chrome-headless-shell";
    },
  };
  return installer;
}

function fakeHub({ get } = {}) {
  const sessions = new Map();
  const hub = {
    opened: [],
    closed: [],
    async get(projectId) {
      if (get) await get(projectId);
      let session = sessions.get(projectId);
      if (!session) {
        session = {
          actions: [],
          async runComputerAction(body) {
            session.actions.push(body);
            if (body.action === "boom") throw coded("dialog_pending", "A dialog is open.");
            if (body.action === "bad") throw new Error("x and y must be numbers.");
            return { width: 1280, height: 800, cursor: { x: 1, y: 2 }, screenshot: "png" };
          },
        };
        sessions.set(projectId, session);
        hub.opened.push(projectId);
      }
      return session;
    },
    peek: (projectId) => sessions.get(projectId) ?? null,
    async close(projectId) {
      sessions.delete(projectId);
      hub.closed.push(projectId);
    },
  };
  return hub;
}

test("status reads stopped, then running once the browser is open, then stopped again", async () => {
  const hub = fakeHub();
  const computers = createComputerManager({ installer: fakeInstaller(), hub });
  assert.deepEqual(computers.status("p"), { projectId: "p", screen: SCREEN, status: "stopped" });
  await computers.start("p");
  assert.equal(computers.status("p").status, "running");
  await computers.stop("p");
  assert.equal(computers.status("p").status, "stopped");
  assert.deepEqual(hub.closed, ["p"]);
});

test("start waits out the first install without a bound and reports installing meanwhile", async () => {
  let finish;
  const installer = fakeInstaller({
    state: "installing",
    progress: { downloadedBytes: 5, totalBytes: 10, unpacking: false },
    executable: () => new Promise((resolve) => (finish = resolve)),
  });
  const computers = createComputerManager({ installer, hub: fakeHub() });
  const started = computers.start("p");
  assert.equal(computers.start("p"), started);
  await Promise.resolve();
  assert.deepEqual(installer.waits, [Infinity]);
  const installing = computers.status("p");
  assert.equal(installing.status, "installing");
  assert.deepEqual(installing.progress, { downloadedBytes: 5, totalBytes: 10, unpacking: false });
  installer.state = "installed";
  assert.equal(computers.status("p").status, "starting");
  finish("/opt/chrome-headless-shell");
  await started;
  assert.equal(computers.status("p").status, "running");
});

test("stopping during browser installation prevents the stale start from reopening it", async () => {
  let finishFirst;
  let calls = 0;
  const installer = fakeInstaller({
    state: "installing",
    executable: () =>
      ++calls === 1
        ? new Promise((resolve) => {
            finishFirst = resolve;
          })
        : "/opt/chrome-headless-shell",
  });
  const hub = fakeHub();
  const computers = createComputerManager({ installer, hub });
  const stale = computers.start("p");
  const rejected = assert.rejects(stale, { code: "browser_closed" });
  await Promise.resolve();
  await computers.stop("p");
  assert.equal(computers.status("p").status, "stopped");
  installer.state = "installed";
  await computers.start("p");
  finishFirst("/opt/chrome-headless-shell");
  await rejected;
  assert.deepEqual(hub.opened, ["p"]);
  assert.equal(computers.status("p").status, "running");
});

test("a failed start shows its words and setup command until the next start", async () => {
  let fail = true;
  const hub = fakeHub({
    get: async () => {
      if (fail)
        throw coded("browser_libraries_missing", "Missing libnss3.so.", {
          setupCommand: "npm run browser:setup",
        });
    },
  });
  const computers = createComputerManager({ installer: fakeInstaller(), hub });
  await assert.rejects(computers.start("p"), { code: "browser_libraries_missing" });
  assert.deepEqual(computers.status("p"), {
    projectId: "p",
    screen: SCREEN,
    status: "error",
    detail: "Missing libnss3.so.",
    setupCommand: "npm run browser:setup",
  });
  fail = false;
  await computers.start("p");
  assert.equal(computers.status("p").status, "running");
});

test("unsupported hosts read as unavailable", () => {
  const computers = createComputerManager({
    installer: fakeInstaller({ state: "unsupported" }),
    hub: fakeHub(),
  });
  assert.deepEqual(computers.status("p"), {
    projectId: "p",
    screen: SCREEN,
    status: "unavailable",
    detail: "Not on freebsd-x64.",
  });
});

test("actions start the browser on first use and return the page's result", async () => {
  const hub = fakeHub();
  const computers = createComputerManager({ installer: fakeInstaller(), hub });
  const { status, payload } = await computers.action("p", { action: "click", x: 1, y: 2 });
  assert.equal(status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.screenshot, "png");
  assert.deepEqual(hub.opened, ["p"]);
  assert.deepEqual(hub.peek("p").actions, [{ action: "click", x: 1, y: 2 }]);
});

test("action errors keep their code and map to an HTTP status", async () => {
  const computers = createComputerManager({ installer: fakeInstaller(), hub: fakeHub() });
  assert.deepEqual(await computers.action("p", { action: "boom" }), {
    status: 409,
    payload: { error: "A dialog is open.", code: "dialog_pending" },
  });
  assert.deepEqual(await computers.action("p", { action: "bad" }), {
    status: 400,
    payload: { error: "x and y must be numbers." },
  });
});

test("a closed browser control lock maps to a retryable service error", async () => {
  const hub = fakeHub();
  const computers = createComputerManager({ installer: fakeInstaller(), hub });
  const session = await hub.get("p");
  session.runComputerAction = async () => {
    throw coded("browser_closed", "The agent browser is closed.");
  };

  assert.deepEqual(await computers.action("p", { action: "click" }), {
    status: 503,
    payload: { error: "The agent browser is closed.", code: "browser_closed" },
  });
});

test("an install in progress answers the agent with its progress, not a stuck call", async () => {
  const hub = fakeHub({
    get: async () => {
      throw coded("browser_installing", "ADE is installing its headless browser (5 of 120 MB).");
    },
  });
  const computers = createComputerManager({
    installer: fakeInstaller({ state: "installing", progress: { downloadedBytes: 5 } }),
    hub,
  });
  const { status, payload } = await computers.action("p", { action: "screenshot" });
  assert.equal(status, 503);
  assert.equal(payload.code, "browser_installing");
  assert.equal(computers.status("p").status, "installing");
});
