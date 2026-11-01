import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = mkdtempSync(path.join(os.tmpdir(), "ade-terminal-test-"));
const projectPath = path.join(home, "project");
mkdirSync(path.join(home, ".ade"));
mkdirSync(projectPath);
writeFileSync(
  path.join(home, ".ade", "workspace.json"),
  JSON.stringify({
    projects: [
      {
        id: "project-1",
        name: "Test project",
        path: projectPath,
        branch: "",
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
const { handleLocalApi } = await import("./ade-local.mjs");

async function call(pathname, data, remoteAddress = "127.0.0.1", host = "127.0.0.1:3000") {
  const request = {
    url: `http://127.0.0.1:3000${pathname}`,
    method: data === undefined ? "GET" : "POST",
    headers: {
      entries: () => [
        ["host", host],
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

test("host terminal runs a real shell in the selected project and closes cleanly", async () => {
  const missing = await call("/api/terminal", { projectId: "missing", cols: 80, rows: 24 });
  assert.equal(missing.status, 404);
  const badSize = await call("/api/terminal", { projectId: "project-1", cols: 1, rows: 24 });
  assert.equal(badSize.status, 400);

  const opened = await call("/api/terminal", { projectId: "project-1", cols: 80, rows: 24 });
  assert.equal(opened.status, 201);
  assert.equal(opened.body.cwd, projectPath);
  const id = opened.body.id;

  try {
    assert.equal((await call(`/api/terminal/${id}/resize`, { cols: 100, rows: 30 })).status, 200);
    assert.equal((await call(`/api/terminal/${id}/resize`, { cols: 0, rows: 30 })).status, 400);
    assert.equal(
      (await call(`/api/terminal/${id}/input`, { data: 'printf "__ADE_PTY_TEST__%s\\n" "$PWD"\r' }))
        .status,
      200,
    );
    let cursor = 0;
    let output = "";
    for (
      let attempt = 0;
      attempt < 30 && !output.includes(`__ADE_PTY_TEST__${projectPath}`);
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const read = await call(`/api/terminal/${id}?cursor=${cursor}`);
      assert.equal(read.status, 200);
      cursor = read.body.cursor;
      output += read.body.data;
    }
    assert.ok(output.includes(`__ADE_PTY_TEST__${projectPath}`));
  } finally {
    assert.equal((await call(`/api/terminal/${id}/close`, {})).status, 200);
  }
  assert.equal((await call(`/api/terminal/${id}`)).status, 404);
});

test(
  "closing the terminal stops a running foreground command",
  { skip: process.platform !== "linux" },
  async () => {
    const opened = await call("/api/terminal", { projectId: "project-1", cols: 80, rows: 24 });
    assert.equal(opened.status, 201);
    const id = opened.body.id;
    const shellPid = opened.body.pid;
    let childPid = 0;
    const running = (pid) => {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        return stat.split(") ")[1]?.[0] !== "Z";
      } catch {
        return false;
      }
    };
    try {
      assert.equal((await call(`/api/terminal/${id}/input`, { data: "sleep 30\r" })).status, 200);
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        try {
          childPid = Number(
            readFileSync(`/proc/${shellPid}/task/${shellPid}/children`, "utf8")
              .trim()
              .split(" ")[0],
          );
        } catch {}
        if (childPid) break;
      }
      assert.ok(childPid, "the foreground process started");
      assert.equal((await call(`/api/terminal/${id}/close`, {})).status, 200);
      // Closing kills asynchronously and, under load, the shell can outlive
      // the command by a few milliseconds: wait for both before asserting.
      for (let attempt = 0; attempt < 80 && (running(childPid) || running(shellPid)); attempt++)
        await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(running(shellPid), false, "the shell stopped");
      assert.equal(running(childPid), false, "the foreground command stopped");
    } finally {
      await call(`/api/terminal/${id}/close`, {}).catch(() => {});
      if (childPid && running(childPid)) process.kill(childPid, "SIGTERM");
    }
  },
);

test(
  "closing the terminal stops a background job that ignores hangup",
  { skip: process.platform !== "linux" },
  async () => {
    const opened = await call("/api/terminal", { projectId: "project-1", cols: 80, rows: 24 });
    assert.equal(opened.status, 201);
    const id = opened.body.id;
    let jobPid = 0;
    const running = (pid) => {
      try {
        return readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.[0] !== "Z";
      } catch {
        return false;
      }
    };
    try {
      assert.equal(
        (
          await call(`/api/terminal/${id}/input`, {
            data: "nohup sleep 30 >/dev/null 2>&1 & echo __ADE_JOB__$!\r",
          })
        ).status,
        200,
      );
      let cursor = 0;
      for (let attempt = 0; attempt < 40 && !jobPid; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        const output = await call(`/api/terminal/${id}?cursor=${cursor}`);
        cursor = output.body.cursor;
        jobPid = Number(output.body.data.match(/__ADE_JOB__(\d+)/)?.[1] || 0);
      }
      assert.ok(jobPid && running(jobPid), "the background job started");
      assert.equal((await call(`/api/terminal/${id}/close`, {})).status, 200);
      for (let attempt = 0; attempt < 40 && running(jobPid); attempt++)
        await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(running(jobPid), false, "the background job stopped");
    } finally {
      await call(`/api/terminal/${id}/close`, {}).catch(() => {});
      if (jobPid && running(jobPid)) process.kill(jobPid, "SIGTERM");
    }
  },
);

test("output can be drained after a fast shell exits", async () => {
  const opened = await call("/api/terminal", { projectId: "project-1", cols: 80, rows: 24 });
  assert.equal(opened.status, 201);
  const id = opened.body.id;
  try {
    assert.equal(
      (await call(`/api/terminal/${id}/input`, { data: "seq 1 20000; exit\r" })).status,
      200,
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    let cursor = 0;
    let output = "";
    let sawMore = false;
    let done = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const read = await call(`/api/terminal/${id}?cursor=${cursor}`);
      assert.equal(read.status, 200);
      cursor = read.body.cursor;
      output += read.body.data;
      sawMore ||= read.body.hasMore;
      if (read.body.exited && !read.body.hasMore) {
        done = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.ok(done, "the shell exited and its output was drained");
    assert.ok(sawMore, "the output required multiple API reads");
    assert.ok(output.includes("19999\r\n20000\r\n"), "the final output line was delivered");
  } finally {
    await call(`/api/terminal/${id}/close`, {});
  }
});

test("terminal output wait returns the shell echo without holding the full interval", async () => {
  const opened = await call("/api/terminal", { projectId: "project-1", cols: 80, rows: 24 });
  assert.equal(opened.status, 201);
  const id = opened.body.id;
  try {
    let cursor = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      const read = await call(`/api/terminal/${id}?cursor=${cursor}&wait=200`);
      assert.equal(read.status, 200);
      cursor = read.body.cursor;
      if (!read.body.data && !read.body.hasMore) break;
    }
    const started = Date.now();
    const pending = call(`/api/terminal/${id}?cursor=${cursor}&wait=2000`);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal((await call(`/api/terminal/${id}/input`, { data: "x" })).status, 200);
    const read = await pending;
    const elapsed = Date.now() - started;
    assert.equal(read.status, 200);
    assert.ok(read.body.data.includes("x"), "the shell echo was delivered to the waiting read");
    assert.ok(elapsed < 1000, `echo took ${elapsed}ms; the read held the full wait`);
  } finally {
    await call(`/api/terminal/${id}/close`, {});
  }
});

test("terminal output wait rejects out-of-range values", async () => {
  const opened = await call("/api/terminal", { projectId: "project-1", cols: 80, rows: 24 });
  assert.equal(opened.status, 201);
  const id = opened.body.id;
  try {
    assert.equal((await call(`/api/terminal/${id}?cursor=0&wait=-1`)).status, 400);
    assert.equal((await call(`/api/terminal/${id}?cursor=0&wait=10001`)).status, 400);
    assert.equal((await call(`/api/terminal/${id}?cursor=0&wait=nope`)).status, 400);
  } finally {
    await call(`/api/terminal/${id}/close`, {});
  }
});

test("host terminal rejects non-loopback peers even when the API is otherwise exposed", async () => {
  const remote = await call(
    "/api/terminal",
    { projectId: "project-1", cols: 80, rows: 24 },
    "203.0.113.5",
  );
  assert.equal(remote.status, 403);
  const rebound = await call(
    "/api/terminal",
    { projectId: "project-1", cols: 80, rows: 24 },
    "127.0.0.1",
    "example.com",
  );
  assert.equal(rebound.status, 403);
});

test("host terminal rejects private-LAN peers when no token gate is configured", async () => {
  delete process.env.ADE_HOST;
  delete process.env.ADE_TOKEN;
  // No Origin header, so only the peer/Host rule can refuse these.
  const lanCall = async (remoteAddress) => {
    const response = await handleLocalApi({
      url: "http://192.168.1.50:3000/api/terminal",
      method: "POST",
      headers: { entries: () => [["host", "192.168.1.50:3000"]], get: () => null },
      runtime: { node: { req: { socket: { remoteAddress } } } },
      text: async () => JSON.stringify({ projectId: "project-1", cols: 80, rows: 24 }),
    });
    return response.status;
  };
  assert.equal(await lanCall("192.168.1.77"), 403);
  assert.equal(await lanCall("127.0.0.1"), 403);
});

// On exit, not in test.after(): ADE's last workspace save can land after the tests end.
process.once("exit", () => rmSync(home, { recursive: true, force: true }));
