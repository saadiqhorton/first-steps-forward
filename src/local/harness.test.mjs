import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  HARNESS,
  commandLine,
  compareVersions,
  detectInstallMethod,
  latestVersion,
  createHarnessJobs,
} from "./harness.mjs";

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

test("HARNESS lists npm install and vendor update argv for each agent", () => {
  assert.deepEqual(HARNESS.codex, {
    pkg: "@openai/codex",
    install: ["npm", ["install", "-g", "@openai/codex"]],
    update: ["codex", ["update"]],
  });
  assert.deepEqual(HARNESS.opencode, {
    pkg: "opencode-ai",
    install: ["npm", ["install", "-g", "opencode-ai"]],
    update: ["opencode", ["upgrade", "--method", "npm"]],
  });
  assert.deepEqual(HARNESS.pi, {
    pkg: "@earendil-works/pi-coding-agent",
    install: ["npm", ["install", "-g", "--ignore-scripts", "@earendil-works/pi-coding-agent"]],
    update: ["pi", ["update", "--self"]],
  });
  // Claude Code itself, not its ACP bridge (ADE sets that up on its own).
  assert.deepEqual(HARNESS.claude, {
    pkg: "@anthropic-ai/claude-code",
    install: ["npm", ["install", "-g", "@anthropic-ai/claude-code"]],
    update: ["npm", ["install", "-g", "@anthropic-ai/claude-code@latest"]],
    selfUpdates: true,
  });
});

test("commandLine joins bin and args, quoting args that contain spaces", () => {
  assert.equal(
    commandLine(["npm", ["install", "-g", "@openai/codex"]]),
    "npm install -g @openai/codex",
  );
  assert.equal(
    commandLine(["opencode", ["upgrade", "--method", "npm"]]),
    "opencode upgrade --method npm",
  );
  assert.equal(commandLine(["echo", ["hello world"]]), 'echo "hello world"');
});

test("compareVersions does numeric dotted compare and strips prefixes", () => {
  assert.equal(compareVersions("0.158.0", "0.159.2"), -1);
  assert.equal(compareVersions("0.159.2", "0.158.0"), 1);
  assert.equal(compareVersions("0.158.0", "0.158.0"), 0);
  assert.equal(compareVersions("codex-cli 0.158.0", "0.159.2"), -1);
  assert.equal(compareVersions("v1.2", "1.2.0"), 0);
  assert.equal(compareVersions("v1.2.1", "1.2.0"), 1);
});

test("detectInstallMethod reports missing, npm, and other", async () => {
  const missing = await detectInstallMethod("codex", {
    which: async () => null,
    realpath: async () => {
      throw new Error("should not realpath");
    },
    npmRoot: async () => "/usr/lib/node_modules",
  });
  assert.deepEqual(missing, { method: "missing" });

  const npmRoot = "/home/u/.nvm/versions/node/v24/lib/node_modules";
  const npm = await detectInstallMethod("codex", {
    which: async (bin) => {
      assert.equal(bin, "codex");
      return "/home/u/.nvm/versions/node/v24/bin/codex";
    },
    realpath: async (p) => {
      assert.equal(p, "/home/u/.nvm/versions/node/v24/bin/codex");
      return `${npmRoot}/@openai/codex/bin/codex.js`;
    },
    npmRoot: async () => npmRoot,
  });
  assert.equal(npm.method, "npm");
  assert.equal(npm.path, "/home/u/.nvm/versions/node/v24/bin/codex");

  const other = await detectInstallMethod("opencode", {
    which: async () => "/usr/local/bin/opencode",
    realpath: async () => "/opt/opencode/bin/opencode",
    npmRoot: async () => npmRoot,
  });
  assert.equal(other.method, "other");
  assert.equal(other.path, "/usr/local/bin/opencode");

  const noRoot = await detectInstallMethod("pi", {
    which: async () => "/usr/bin/pi",
    realpath: async () => "/usr/bin/pi",
    npmRoot: async () => null,
  });
  assert.equal(noRoot.method, "other");
});

test("latestVersion runs npm view, caches for one hour, null on failure", async () => {
  const calls = [];
  const run = async (bin, args) => {
    calls.push([bin, ...args]);
    if (args[1] === "@openai/codex") return { code: 0, stdout: "0.159.2\n", stderr: "" };
    if (args[1] === "opencode-ai") return { code: 1, stdout: "", stderr: "ERR" };
    return { code: 0, stdout: "1.0.0\n", stderr: "" };
  };

  const first = await latestVersion("codex", run, { now: 1_000 });
  assert.equal(first, "0.159.2");
  assert.deepEqual(calls[0], ["npm", "view", "@openai/codex", "version"]);

  const cached = await latestVersion("codex", run, { now: 1_000 + 3_600_000 - 1 });
  assert.equal(cached, "0.159.2");
  assert.equal(calls.length, 1, "must not re-query within the 1-hour TTL");

  const refreshed = await latestVersion("codex", run, { now: 1_000 + 3_600_000 });
  assert.equal(refreshed, "0.159.2");
  assert.equal(calls.length, 2, "TTL expiry re-queries");

  const failed = await latestVersion("opencode", run, { now: 1 });
  assert.equal(failed, null);
});

test("createHarnessJobs lifecycle: idle → running → succeeded with exitCode", async () => {
  let child;
  const finished = [];
  const jobs = createHarnessJobs({
    spawn: (bin, args, opts) => {
      assert.equal(bin, "npm");
      assert.deepEqual(args, ["install", "-g", "@openai/codex"]);
      assert.deepEqual(opts, { stdio: ["ignore", "pipe", "pipe"] });
      child = fakeChild();
      return child;
    },
    onFinished: (job) => finished.push({ ...job, output: [...job.output] }),
  });

  assert.deepEqual(jobs.get("codex"), { status: "idle", command: "", output: [] });

  const started = jobs.start("codex", "install", HARNESS.codex.install);
  assert.equal(started.status, "running");
  assert.equal(started.agentId, "codex");
  assert.equal(started.kind, "install");
  assert.equal(started.command, "npm install -g @openai/codex");
  assert.ok(started.startedAt);
  assert.equal(jobs.get("codex").status, "running");

  child.stdout.emit("data", Buffer.from("downloading\n"));
  child.emit("close", 0);

  await new Promise((r) => setImmediate(r));
  const done = jobs.get("codex");
  assert.equal(done.status, "succeeded");
  assert.equal(done.exitCode, 0);
  assert.ok(done.finishedAt);
  assert.deepEqual(done.output, ["downloading"]);
  assert.equal(finished.length, 1);
  assert.equal(finished[0].status, "succeeded");
});

test("createHarnessJobs marks non-zero exit as failed", async () => {
  let child;
  const jobs = createHarnessJobs({
    spawn: () => {
      child = fakeChild();
      return child;
    },
    onFinished: () => {},
  });
  jobs.start("pi", "update", HARNESS.pi.update);
  child.emit("close", 7);
  await new Promise((r) => setImmediate(r));
  const job = jobs.get("pi");
  assert.equal(job.status, "failed");
  assert.equal(job.exitCode, 7);
});

test("createHarnessJobs throws BUSY when a job for the agent is already running", () => {
  const children = [];
  const jobs = createHarnessJobs({
    spawn: () => {
      const child = fakeChild();
      children.push(child);
      return child;
    },
    onFinished: () => {},
  });
  jobs.start("codex", "install", HARNESS.codex.install);
  assert.throws(
    () => jobs.start("codex", "update", HARNESS.codex.update),
    (err) => err instanceof Error && err.code === "BUSY",
  );
  // A different agent can still start on the same runner.
  assert.doesNotThrow(() => jobs.start("opencode", "install", HARNESS.opencode.install));
  for (const child of children) child.emit("close", 0);
});

test("createHarnessJobs caps output at the last 400 lines and strips ANSI", async () => {
  let child;
  const jobs = createHarnessJobs({
    spawn: () => {
      child = fakeChild();
      return child;
    },
    onFinished: () => {},
  });
  jobs.start("codex", "install", HARNESS.codex.install);
  const lines = Array.from({ length: 450 }, (_, i) => `line-${i}`);
  child.stdout.emit("data", Buffer.from(`\x1b[31m${lines.join("\n")}\x1b[0m\n`));
  child.stderr.emit("data", Buffer.from("\x1b[1mwarn\x1b[0m\n"));
  child.emit("close", 0);
  await new Promise((r) => setImmediate(r));
  const out = jobs.get("codex").output;
  assert.equal(out.length, 400);
  assert.equal(out[0], "line-51");
  assert.equal(out[out.length - 2], "line-449");
  assert.equal(out[out.length - 1], "warn");
  assert.ok(out.every((line) => !/\x1b\[/.test(line)));
});

test("createHarnessJobs times out, kills the child, and marks failed", async () => {
  let child;
  const finished = [];
  const jobs = createHarnessJobs({
    spawn: () => {
      child = fakeChild();
      return child;
    },
    onFinished: (job) => finished.push(job.status),
    timeoutMs: 30,
  });
  jobs.start("opencode", "update", HARNESS.opencode.update);
  await new Promise((r) => setTimeout(r, 80));
  const job = jobs.get("opencode");
  assert.equal(job.status, "failed");
  assert.equal(child.killed, true);
  assert.ok(job.output.includes("Timed out after 10 minutes."));
  assert.deepEqual(finished, ["failed"]);
});
