import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { adapters } from "./adapters/index.mjs";
import {
  commandLine,
  compareVersions,
  detectInstallMethod,
  latestVersion,
  createHarnessJobs,
  miseUpdateCommand,
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

test("each agent adapter lists its npm install and vendor update argv", () => {
  const HARNESS = Object.fromEntries(
    Object.values(adapters).map((adapter) => [adapter.id, adapter.harness]),
  );
  assert.deepEqual(HARNESS.codex, {
    pkg: "@openai/codex",
    install: ["npm", ["install", "-g", "@openai/codex"]],
    update: ["npm", ["install", "-g", "@openai/codex@latest"]],
    brews: [{ kind: "cask", name: "codex" }],
  });
  assert.deepEqual(HARNESS.opencode, {
    pkg: "opencode-ai",
    install: ["npm", ["install", "-g", "opencode-ai"]],
    update: ["npm", ["install", "-g", "opencode-ai@latest"]],
    brews: [{ kind: "formula", name: "opencode" }],
  });
  assert.deepEqual(HARNESS.pi, {
    pkg: "@earendil-works/pi-coding-agent",
    install: ["npm", ["install", "-g", "--ignore-scripts", "@earendil-works/pi-coding-agent"]],
    update: [
      "npm",
      ["install", "-g", "--ignore-scripts", "@earendil-works/pi-coding-agent@latest"],
    ],
    brews: [{ kind: "formula", name: "pi-coding-agent" }],
  });
  // Claude Code itself, not its ACP bridge (ADE sets that up on its own).
  assert.deepEqual(HARNESS.claude, {
    pkg: "@anthropic-ai/claude-code",
    install: ["npm", ["install", "-g", "@anthropic-ai/claude-code"]],
    update: ["npm", ["install", "-g", "@anthropic-ai/claude-code@latest"]],
    selfUpdates: true,
    brews: [{ kind: "cask", name: "claude-code" }],
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
  assert.equal(compareVersions("1.2.3-beta.2", "1.2.3"), -1);
  assert.equal(compareVersions("1.2.3-beta.11", "1.2.3-beta.2"), 1);
  assert.equal(compareVersions("unknown", "1.2.3"), 0);
});

test("detectInstallMethod reports missing, npm, and other", async () => {
  const missing = await detectInstallMethod(adapters.codex, {
    which: async () => null,
    realpath: async () => {
      throw new Error("should not realpath");
    },
    npmRoot: async () => "/usr/lib/node_modules",
  });
  assert.deepEqual(missing, { method: "missing" });

  const npmRoot = "/home/u/.nvm/versions/node/v24/lib/node_modules";
  const npm = await detectInstallMethod(adapters.codex, {
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

  const other = await detectInstallMethod(adapters.opencode, {
    which: async () => "/usr/local/bin/opencode",
    realpath: async () => "/opt/opencode/bin/opencode",
    npmRoot: async () => npmRoot,
  });
  assert.equal(other.method, "other");
  assert.equal(other.path, "/usr/local/bin/opencode");

  const noRoot = await detectInstallMethod(adapters.pi, {
    which: async () => "/usr/bin/pi",
    realpath: async () => "/usr/bin/pi",
    npmRoot: async () => null,
  });
  assert.equal(noRoot.method, "other");
});

test("Windows npm shim is recognized only when it targets the expected global package", async () => {
  const prefix = path.join(path.sep, "Users", "example", "npm");
  const shim = path.join(prefix, "codex.cmd");
  const deps = {
    platform: "win32",
    which: async (bin) => (bin === "codex" ? shim : null),
    npmRoot: async () => path.join(prefix, "node_modules"),
    realpath: async (p) => p,
    readFile: async () => "%~dp0\\node_modules\\@openai\\codex\\bin\\codex.js",
  };
  assert.equal((await detectInstallMethod(adapters.codex, deps)).method, "npm");
  assert.equal(
    (
      await detectInstallMethod(adapters.codex, {
        ...deps,
        readFile: async () => "%~dp0\\node_modules\\other\\bin.js",
      })
    ).method,
    "other",
  );
  assert.equal(
    (
      await detectInstallMethod(adapters.codex, {
        ...deps,
        which: async (bin) => (bin === "codex" ? path.join(path.sep, "other", "codex.cmd") : null),
      })
    ).method,
    "other",
  );
});

test("mise detection follows the exact active global agent, not a Node-managed package or unrelated binary", async () => {
  const root = path.join(path.sep, "home", "user", "mise", "installs", "codex", "1.0.0");
  const binary = path.join(root, "bin", "codex");
  const deps = {
    which: async (bin) => (bin === "codex" ? binary : bin === "mise" ? "/usr/bin/mise" : null),
    npmRoot: async () => "/elsewhere/node_modules",
    realpath: async (p) => p,
    run: async (bin, args) => {
      assert.equal(bin, "mise");
      if (args[0] === "which" && args[1] === "--plugin") return { code: 0, stdout: "codex\n" };
      if (args[0] === "which") return { code: 0, stdout: `${binary}\n` };
      return {
        code: 0,
        stdout: JSON.stringify([{ installed: true, active: true, install_path: root }]),
      };
    },
  };
  assert.deepEqual(await detectInstallMethod(adapters.codex, deps), {
    method: "mise",
    path: binary,
    miseTool: "codex",
  });
  const different = {
    ...deps,
    run: async (bin, args) =>
      args[0] === "which" && args[1] !== "--plugin"
        ? { code: 0, stdout: "/unrelated/codex" }
        : deps.run(bin, args),
  };
  assert.equal((await detectInstallMethod(adapters.codex, different)).method, "other");
  assert.deepEqual(miseUpdateCommand(adapters.codex, "codex"), [
    "mise",
    ["upgrade", "--global", "--no-prune", "codex"],
  ]);
  assert.equal(miseUpdateCommand(adapters.codex, "node"), null);
  assert.equal(miseUpdateCommand(adapters.codex, "codex;whoami"), null);
});

test("mise checks its configured channel and never falls back to an unrelated npm package", async () => {
  const calls = [];
  const run = async (bin, args, options) => {
    calls.push([bin, ...args]);
    assert.equal(options.timeout, 15000);
    return { code: 0, stdout: JSON.stringify({ opencode: { latest: "2.3.0" } }) };
  };
  assert.equal(
    await latestVersion(adapters.opencode, run, {
      miseTool: "opencode",
      installedVersion: "2.2.0",
      force: true,
    }),
    "2.3.0",
  );
  assert.deepEqual(calls, [["mise", "outdated", "--json", "--global", "opencode"]]);
  const upToDate = async () => ({ code: 0, stdout: "{}" });
  assert.equal(
    await latestVersion(adapters.opencode, upToDate, {
      miseTool: "opencode",
      installedVersion: "2.3.0",
      force: true,
    }),
    "2.3.0",
  );
  assert.equal(
    await latestVersion(adapters.opencode, async () => ({ code: 1, stdout: "" }), {
      miseTool: "opencode",
      installedVersion: "2.3.0",
      force: true,
    }),
    null,
  );
});

test("latestVersion caches successful checks for 15 minutes, retries failures, and supports forced checks", async () => {
  const calls = [];
  const run = async (bin, args, options) => {
    assert.equal(options.timeout, 5000, "registry checks must not keep running indefinitely");
    calls.push([bin, ...args]);
    if (args[1] === "@openai/codex") return { code: 0, stdout: "0.159.2\n", stderr: "" };
    if (args[1] === "opencode-ai") return { code: 1, stdout: "", stderr: "ERR" };
    return { code: 0, stdout: "1.0.0\n", stderr: "" };
  };

  const first = await latestVersion(adapters.codex, run, { now: 1_000 });
  assert.equal(first, "0.159.2");
  assert.deepEqual(calls[0], ["npm", "view", "@openai/codex", "version", "--prefer-online"]);

  const cached = await latestVersion(adapters.codex, run, { now: 1_000 + 900_000 - 1 });
  assert.equal(cached, "0.159.2");
  assert.equal(calls.length, 1, "must not re-query within the 15-minute TTL");

  const refreshed = await latestVersion(adapters.codex, run, { now: 1_000 + 900_000 });
  assert.equal(refreshed, "0.159.2");
  assert.equal(calls.length, 2, "TTL expiry re-queries");

  const failed = await latestVersion(adapters.opencode, run, { now: 1 });
  assert.equal(failed, null);
  const count = calls.length;
  await latestVersion(adapters.opencode, run, { now: 60_000 });
  assert.equal(calls.length, count, "failure has a short retry delay");
  await latestVersion(adapters.opencode, run, { now: 60_001 });
  assert.equal(calls.length, count + 1, "failed check retries after a minute");
  await latestVersion(adapters.codex, run, { now: 902_000, force: true });
  assert.equal(calls.length, count + 2, "manual check bypasses the cache");
});

test("Homebrew ownership is detected from the installed item's own file list", async () => {
  const prefix = path.join(path.sep, "opt", "homebrew");
  const shim = path.join(prefix, "bin", "codex");
  const owned = path.join(prefix, "Caskroom", "codex", "0.169.0", "bin", "codex");
  const deps = {
    which: async (bin) =>
      bin === "codex" ? shim : bin === "brew" ? path.join(prefix, "bin", "brew") : null,
    npmRoot: async () => path.join(path.sep, "node_modules"),
    realpath: async (p) => (p === shim ? owned : p),
    run: async (bin, args) => {
      assert.equal(bin, "brew");
      if (args[0] === "info")
        return {
          code: 0,
          stdout: JSON.stringify({ formulae: [], casks: [{ full_token: "codex" }] }),
        };
      assert.deepEqual(args, ["list", "--verbose", "--cask", "codex"]);
      return { code: 0, stdout: `${owned}\n` };
    },
  };
  assert.deepEqual(await detectInstallMethod(adapters.codex, deps), {
    method: "brew",
    path: shim,
    brewItem: { kind: "cask", name: "codex" },
  });
  // An allowlisted cask that does not own this file leaves the result "other".
  assert.equal(
    (
      await detectInstallMethod(adapters.codex, {
        ...deps,
        run: async (bin, args) =>
          args[0] === "info"
            ? {
                code: 0,
                stdout: JSON.stringify({ formulae: [], casks: [{ full_token: "codex" }] }),
              }
            : { code: 0, stdout: `${path.join(prefix, "bin", "other")}\n` },
      })
    ).method,
    "other",
  );
});

test("Homebrew update checks use brew outdated and never fall back to npm", async () => {
  const calls = [];
  const outdated = async (bin, args, options) => {
    calls.push([bin, ...args]);
    assert.equal(options.timeout, 15000);
    return {
      code: 1,
      stdout: JSON.stringify({
        formulae: [],
        casks: [{ name: "codex", current_version: "0.170.0", pinned: false }],
      }),
    };
  };
  assert.equal(
    await latestVersion(adapters.codex, outdated, {
      brewItem: { kind: "cask", name: "codex" },
      installedVersion: "0.169.0",
      force: true,
    }),
    "0.170.0",
  );
  assert.deepEqual(calls, [["brew", "outdated", "--json=v2", "--cask", "codex"]]);

  const current = await latestVersion(
    adapters.codex,
    async () => ({
      code: 0,
      stdout: JSON.stringify({ formulae: [], casks: [] }),
    }),
    {
      brewItem: { kind: "cask", name: "codex" },
      installedVersion: "0.170.0",
      force: true,
    },
  );
  assert.equal(current, "0.170.0", "Homebrew says the installed version is current");

  const pinned = await latestVersion(
    adapters.codex,
    async () => ({
      code: 1,
      stdout: JSON.stringify({
        formulae: [],
        casks: [{ name: "codex", current_version: "0.171.0", pinned: true }],
      }),
    }),
    { brewItem: { kind: "cask", name: "codex" }, installedVersion: "0.170.0", force: true },
  );
  assert.equal(pinned, "0.170.0", "a pinned package is never offered an upgrade ADE cannot apply");

  const failed = await latestVersion(
    adapters.codex,
    async () => ({ code: 0, stdout: "not json" }),
    { brewItem: { kind: "cask", name: "codex" }, installedVersion: "0.169.0", force: true },
  );
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

  const started = jobs.start("codex", "install", adapters.codex.harness.install);
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
  jobs.start("pi", "update", adapters.pi.harness.update);
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
  jobs.start("codex", "install", adapters.codex.harness.install);
  assert.throws(
    () => jobs.start("codex", "update", adapters.codex.harness.update),
    (err) => err instanceof Error && err.code === "BUSY",
  );
  // A different agent can still start on the same runner.
  assert.doesNotThrow(() => jobs.start("opencode", "install", adapters.opencode.harness.install));
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
  jobs.start("codex", "install", adapters.codex.harness.install);
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
  jobs.start("opencode", "update", adapters.opencode.harness.update);
  await new Promise((r) => setTimeout(r, 80));
  const job = jobs.get("opencode");
  assert.equal(job.status, "failed");
  assert.equal(child.killed, true);
  assert.ok(job.output.includes("Timed out after 10 minutes."));
  assert.deepEqual(finished, ["failed"]);
});
