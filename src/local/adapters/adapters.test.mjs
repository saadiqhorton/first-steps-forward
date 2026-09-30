import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { codex } from "./codex.mjs";
import { opencode } from "./opencode.mjs";
import { pi } from "./pi.mjs";

const session = { id: "session-id", agentSessionId: undefined };

test("Codex adapter uses its workspace-write sandbox and resumes the same thread", () => {
  const [bin, args] = codex.command({
    projectPath: "/tmp/project",
    prompt: "Fix it",
    session,
    continuing: false,
  });
  assert.equal(bin, "codex");
  assert.ok(args.includes("--sandbox") && args.includes("workspace-write"));
  assert.ok(!args.some((arg) => arg.includes("dangerously")));
  codex.parse(JSON.stringify({ type: "thread.started", thread_id: "thread-1" }), session);
  const resumed = codex.command({
    projectPath: "/tmp/project",
    prompt: "Continue",
    session,
    continuing: true,
  })[1];
  assert.ok(resumed.includes("thread-1"));
  assert.ok(resumed.includes("Continue"));
});

test("OpenCode adapter never opts into automatic permission approval", () => {
  const [bin, args] = opencode.command({
    projectPath: "/tmp/project",
    prompt: "Inspect",
    session,
    continuing: false,
  });
  assert.equal(bin, "opencode");
  assert.ok(args.includes("--format") && args.includes("json"));
  assert.ok(!args.includes("--auto"));
  const event = opencode.parse(
    JSON.stringify({ type: "text", sessionID: "oc-1", part: { text: "Real response" } }),
    session,
  );
  assert.equal(event.text, "Real response");
  assert.equal(session.agentSessionId, "oc-1");
});

test("Pi adapter restricts shell tools and parses actual JSON events", () => {
  const [bin, args] = pi.command({
    prompt: "Inspect",
    session,
    continuing: false,
    dataDir: "/tmp/ade",
  });
  assert.equal(bin, "pi");
  // Extensions stay enabled so package-registered providers resolve, but the
  // tool allowlist still sandboxes the run.
  assert.ok(!args.includes("--no-extensions"));
  assert.ok(args.includes("read,edit,write,grep,find,ls"));
  assert.ok(!args.includes("bash"));
  const event = pi.parse(
    JSON.stringify({
      type: "message_end",
      message: { content: [{ type: "text", text: "Pi response" }] },
    }),
  );
  assert.equal(event.text, "Pi response");
});

test("Pi reports only auth-check READY providers, not credential or catalog counts", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "ade-pi-auth-"));
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = home;
    mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(
      path.join(home, ".pi", "agent", "auth.json"),
      JSON.stringify({
        "opencode-go": {},
        "openai-codex": {},
        "ollama-cloud": {},
        "bad\nname": {},
      }),
    );
    const calls = [];
    const auth = await pi.detectAuth(async (bin, args) => {
      calls.push([bin, ...args]);
      const ready = args[3] !== "ollama-cloud" && args[3] !== "bad\nname";
      return {
        code: ready ? 0 : 1,
        stdout: JSON.stringify({ status: ready ? "ready" : "not_ready" }),
      };
    });
    assert.deepEqual(auth, {
      signedIn: true,
      providers: ["openai-codex", "opencode-go"],
      account: "2 READY providers: openai-codex, opencode-go",
    });
    assert.deepEqual(calls.map((call) => call[4]).sort(), [
      "bad\nname",
      "ollama-cloud",
      "openai-codex",
      "opencode-go",
    ]);
    const unusual = await pi.detectAuth(async (_bin, args) => ({
      code: args[3] === "bad\nname" ? 0 : 1,
      stdout: JSON.stringify({ status: args[3] === "bad\nname" ? "ready" : "not_ready" }),
    }));
    assert.deepEqual(unusual.providers, ["bad\nname"], "provider ID is preserved for Pi");
    assert.equal(unusual.account, "1 READY provider: (unusual provider name)");
    assert.ok(
      calls.every(
        (call) =>
          call[0] === "pi" &&
          call.includes("--json") &&
          call.includes("--no-refresh") &&
          !call.includes("--credentials"),
      ),
    );
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});

test("Pi does not label a configured but non-READY provider as signed in", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "ade-pi-auth-"));
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = home;
    mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(path.join(home, ".pi", "agent", "auth.json"), '{"ollama-cloud":{}}');
    const auth = await pi.detectAuth(async () => ({
      code: 1,
      stdout: '{"status":"not_ready"}',
    }));
    assert.deepEqual(auth, { signedIn: false });
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});

test("adapters omit the model flag entirely when no model is chosen", () => {
  const codexArgs = codex.command({
    projectPath: "/tmp/project",
    prompt: "Go",
    session,
    continuing: false,
  })[1];
  assert.ok(!codexArgs.includes("-m"));
  assert.ok(!codexArgs.includes("--model"));
  const openCodeArgs = opencode.command({
    projectPath: "/tmp/project",
    prompt: "Go",
    session,
    continuing: false,
  })[1];
  assert.ok(!openCodeArgs.includes("-m"));
  assert.ok(!openCodeArgs.includes("--model"));
  const piArgs = pi.command({
    prompt: "Go",
    session,
    continuing: false,
    dataDir: "/tmp/ade",
    providers: ["opencode-go"],
  })[1];
  assert.ok(!piArgs.includes("--model"));
  // With exactly one ready provider it is pinned explicitly so Pi's own
  // default cannot resolve to an unauthenticated provider.
  assert.ok(piArgs.includes("--provider") && piArgs.includes("opencode-go"));
  // With several ready providers ADE stays out of the way and lets Pi
  // resolve its own default across the providers the user set up.
  const piMultiArgs = pi.command({
    prompt: "Go",
    session,
    continuing: false,
    dataDir: "/tmp/ade",
    providers: ["opencode-go", "anthropic"],
  })[1];
  assert.ok(!piMultiArgs.includes("--provider"));
});

test("adapters pass the chosen model with each CLI's own flag spelling", () => {
  const codexArgs = codex.command({
    projectPath: "/tmp/project",
    prompt: "Go",
    session,
    continuing: false,
    model: "gpt-5.5",
  })[1];
  assert.equal(codexArgs[codexArgs.indexOf("-m") + 1], "gpt-5.5");
  const openCodeArgs = opencode.command({
    projectPath: "/tmp/project",
    prompt: "Go",
    session,
    continuing: false,
    model: "opencode-go/gpt-5.6-luna",
  })[1];
  assert.equal(openCodeArgs[openCodeArgs.indexOf("-m") + 1], "opencode-go/gpt-5.6-luna");
  const piArgs = pi.command({
    prompt: "Go",
    session,
    continuing: false,
    dataDir: "/tmp/ade",
    providers: ["opencode-go"],
    model: "opencode-go/gpt-5.6-luna",
  })[1];
  assert.equal(piArgs[piArgs.indexOf("--model") + 1], "opencode-go/gpt-5.6-luna");
});

test("Codex resume carries the model flag and Pi drops --provider when a model is set", () => {
  const resumed = codex.command({
    projectPath: "/tmp/project",
    prompt: "Continue",
    session: { id: "s", agentSessionId: "thread-9" },
    continuing: true,
    model: "gpt-5.6-terra",
  })[1];
  assert.ok(resumed.includes("resume") && resumed.includes("thread-9"));
  assert.equal(resumed[resumed.indexOf("-m") + 1], "gpt-5.6-terra");
  const piArgs = pi.command({
    prompt: "Continue",
    session: { id: "s", agentSessionId: "pi-1" },
    continuing: true,
    dataDir: "/tmp/ade",
    providers: ["opencode-go"],
    model: "opencode-go/gpt-5.6-luna",
  })[1];
  // provider/id is embedded in the model id; --provider must not compete.
  assert.ok(!piArgs.includes("--provider"));
  assert.ok(piArgs.includes("--continue"));
});

test("adapters omit effort/speed/permission flags when options are absent (byte-for-byte)", () => {
  const base = {
    projectPath: "/tmp/project",
    prompt: "Go",
    session: { id: "s", agentSessionId: undefined },
    continuing: false,
  };
  assert.deepEqual(codex.command(base)[1], [
    "exec",
    "--json",
    "--cd",
    "/tmp/project",
    "--sandbox",
    "workspace-write",
    "Go",
  ]);
  assert.deepEqual(opencode.command(base)[1], [
    "run",
    "--format",
    "json",
    "--dir",
    "/tmp/project",
    "Go",
  ]);
  assert.deepEqual(pi.command({ ...base, dataDir: "/tmp/ade", providers: ["opencode-go"] })[1], [
    "-p",
    "--mode",
    "json",
    "--tools",
    "read,edit,write,grep,find,ls",
    "--provider",
    "opencode-go",
    "--session",
    "/tmp/ade/sessions/s.jsonl",
    "Go",
  ]);
});

test("Codex maps effort, speed, and plan permission onto argv", () => {
  const newPlan = codex.command({
    projectPath: "/tmp/project",
    prompt: "Plan it",
    session: { id: "s" },
    continuing: false,
    effort: "high",
    speed: "fast",
    permission: "plan",
  })[1];
  assert.deepEqual(newPlan, [
    "exec",
    "--json",
    "-c",
    'model_reasoning_effort="high"',
    "-c",
    'service_tier="fast"',
    "--cd",
    "/tmp/project",
    "--sandbox",
    "read-only",
    "Plan it",
  ]);

  const resumedPlan = codex.command({
    projectPath: "/tmp/project",
    prompt: "Continue planning",
    session: { id: "s", agentSessionId: "thread-9" },
    continuing: true,
    effort: "medium",
    permission: "plan",
  })[1];
  assert.deepEqual(resumedPlan, [
    "exec",
    "resume",
    "--json",
    "-c",
    'model_reasoning_effort="medium"',
    "-c",
    'sandbox_mode="read-only"',
    "thread-9",
    "Continue planning",
  ]);
});

test("OpenCode maps effort to --variant and plan to --agent plan", () => {
  const args = opencode.command({
    projectPath: "/tmp/project",
    prompt: "Inspect",
    session: { id: "s" },
    continuing: false,
    model: "opencode/ling",
    effort: "high",
    permission: "plan",
  })[1];
  assert.deepEqual(args, [
    "run",
    "--format",
    "json",
    "--dir",
    "/tmp/project",
    "-m",
    "opencode/ling",
    "--variant",
    "high",
    "--agent",
    "plan",
    "Inspect",
  ]);
  const build = opencode.command({
    projectPath: "/tmp/project",
    prompt: "Build",
    session: { id: "s" },
    continuing: false,
    permission: "build",
  })[1];
  assert.ok(!build.includes("--agent"));
});

test("Pi maps effort to --thinking and plan to a read-only tools allowlist", () => {
  const planArgs = pi.command({
    prompt: "Review",
    session: { id: "s" },
    continuing: false,
    dataDir: "/tmp/ade",
    providers: ["opencode-go"],
    model: "opencode-go/gpt-5.6-luna",
    effort: "high",
    permission: "plan",
  })[1];
  assert.equal(planArgs[planArgs.indexOf("--thinking") + 1], "high");
  assert.equal(planArgs[planArgs.indexOf("--tools") + 1], "read,grep,find,ls");
  assert.ok(!planArgs.includes("read,edit,write,grep,find,ls"));

  const buildArgs = pi.command({
    prompt: "Edit",
    session: { id: "s" },
    continuing: false,
    dataDir: "/tmp/ade",
    providers: ["opencode-go"],
    permission: "build",
  })[1];
  assert.equal(buildArgs[buildArgs.indexOf("--tools") + 1], "read,edit,write,grep,find,ls");
});
