import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { claude } from "./claude.agent.mjs";
import { codex } from "./codex.agent.mjs";
import { opencode, parseOpencodeAuthJson, parseOpencodeAuthText } from "./opencode.agent.mjs";
import { pi } from "./pi.agent.mjs";
import { acpComputerServers } from "./computer-tools.mjs";

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
  const [conversation] = codex.parse(
    JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
  );
  assert.deepEqual(conversation, { type: "conversation", id: "thread-1" });
  const resumed = codex.command({
    projectPath: "/tmp/project",
    prompt: "Continue",
    session: { ...session, agentSessionId: conversation.id },
    continuing: true,
  })[1];
  assert.ok(resumed.includes("thread-1"));
  assert.ok(resumed.includes("Continue"));
});

test("Codex runs in project folders that are not Git repositories, first turn and follow-ups", () => {
  // Without the flag Codex exits 1: "Not inside a trusted directory and
  // --skip-git-repo-check was not specified."
  const base = { projectPath: "/tmp/plain-folder", prompt: "Go", session };
  assert.ok(codex.command({ ...base, continuing: false })[1].includes("--skip-git-repo-check"));
  const followUp = codex.command({
    ...base,
    session: { ...session, agentSessionId: "thread-2" },
    continuing: true,
  })[1];
  assert.equal(followUp[1], "resume");
  assert.ok(followUp.includes("--skip-git-repo-check"));
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
  assert.deepEqual(
    opencode.parse(
      JSON.stringify({ type: "text", sessionID: "oc-1", part: { text: "Real response" } }),
    ),
    [
      { type: "conversation", id: "oc-1" },
      { type: "text", text: "Real response" },
    ],
  );
  // `opencode run` rejects permission requests itself; the user is told.
  assert.deepEqual(opencode.stderr("permission requested: bash (rm -rf x); auto-rejecting"), [
    {
      type: "notice",
      text: "OpenCode requested permission for bash (rm -rf x); its non-interactive CLI rejected the request. ADE did not approve or run that action.",
    },
  ]);
  assert.deepEqual(opencode.stderr("some other warning"), []);
});

test("OpenCode detection reads the 2.x JSON integration listing", async () => {
  const calls = [];
  const auth = await opencode.detectAuth(async (bin, args) => {
    calls.push([bin, ...args]);
    return {
      code: 0,
      stdout: JSON.stringify([
        { id: "opencode-go", name: "OpenCode Go", connections: [{ id: "cred-1" }] },
        { id: "ollama-cloud", name: "Ollama Cloud", connections: [{ id: "cred-2" }] },
      ]),
    };
  });
  assert.deepEqual(auth, {
    signedIn: true,
    providers: ["opencode-go", "ollama-cloud"],
    account: "2 providers: opencode-go, ollama-cloud",
  });
  assert.deepEqual(calls, [["opencode", "auth", "list", "--format", "json"]]);
});

test("OpenCode detection reports no sign-in for an empty JSON store", async () => {
  const auth = await opencode.detectAuth(async () => ({ code: 0, stdout: "[]" }));
  assert.deepEqual(auth, { signedIn: false });
});

test("OpenCode detection falls back to the 1.x text table", async () => {
  const calls = [];
  const auth = await opencode.detectAuth(async (bin, args) => {
    calls.push([bin, ...args]);
    if (args.includes("--format"))
      return { code: 1, stdout: "ERROR\n  Unrecognized flag: --format" };
    return {
      code: 0,
      stdout: [
        "\u250c  Credentials ~/.local/share/opencode/auth.json",
        "\u2502",
        "\u25cf  Anthropic oauth",
        "\u2502",
        "\u2514  2 credentials",
        "",
      ].join("\n"),
    };
  });
  assert.deepEqual(auth, { signedIn: true, account: "Configured in OpenCode" });
  assert.deepEqual(calls, [
    ["opencode", "auth", "list", "--format", "json"],
    ["opencode", "auth", "list"],
  ]);
});

test("OpenCode detection counts credentials exactly (10 is not 0)", () => {
  // The old `! /0 credentials/` check read "10 credentials" as signed out.
  assert.equal(parseOpencodeAuthText("\u2514  10 credentials\n"), true);
  assert.equal(parseOpencodeAuthText("\u2514  0 credentials\n"), false);
});

test("OpenCode detection reads the 2.x text rows and an empty store message", () => {
  assert.equal(parseOpencodeAuthText("OpenCode Go   API key                     stored\n"), true);
  assert.equal(parseOpencodeAuthText("No authenticated integrations\n"), false);
});

test("OpenCode detection never counts a failed listing as signed in", async () => {
  const auth = await opencode.detectAuth(async (_bin, args) =>
    args.includes("--format")
      ? { code: 1, stdout: "Unrecognized flag: --format" }
      : { code: 1, stdout: "credentials" },
  );
  assert.deepEqual(auth, { signedIn: false });
});

test("parseOpencodeAuthJson rejects streams that are not the 2.x shape", () => {
  assert.equal(parseOpencodeAuthJson("Unrecognized flag: --format"), null);
  assert.equal(parseOpencodeAuthJson('{"id":"x"}'), null);
  assert.deepEqual(parseOpencodeAuthJson('[{"id":"x","connections":[]}]'), {
    signedIn: false,
    providers: [],
  });
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
  assert.deepEqual(
    pi.parse(
      JSON.stringify({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Pi response" }] },
      }),
    ),
    [{ type: "text", text: "Pi response" }],
  );
});

test("Pi reports only auth-check READY providers, not credential or catalog counts", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "ade-pi-auth-"));
  const previousHome = process.env.HOME;
  // os.homedir() reads USERPROFILE on Windows, not HOME.
  const previousProfile = process.env.USERPROFILE;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
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
    if (previousProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousProfile;
    rmSync(home, { recursive: true, force: true });
  }
});

test("Pi reports only assistant messages, never the echoed user prompt", () => {
  // Pi emits message_end for its system preamble and the user's prompt too.
  // Treating those as agent output duplicated the prompt as a fake reply.
  assert.deepEqual(
    pi.parse(
      JSON.stringify({
        type: "message_end",
        message: { role: "user", content: [{ type: "text", text: "My question" }] },
      }),
    ),
    [],
  );
  assert.deepEqual(
    pi.parse(
      JSON.stringify({
        type: "message_end",
        message: { role: "system", content: [{ type: "text", text: "Preamble" }] },
      }),
    ),
    [],
  );
  assert.deepEqual(
    pi.parse(
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hmm" },
            { type: "text", text: "Answer" },
          ],
        },
      }),
    ),
    [{ type: "text", text: "Answer" }],
  );
});

test("Pi surfaces a settled failed turn so ADE does not report success", () => {
  // Print mode's JSON path exits 0 even when every retry failed, so the
  // adapter's agent_end event is the only failure signal.
  const failed = pi.parse(
    JSON.stringify({
      type: "agent_end",
      willRetry: false,
      messages: [
        { role: "user", content: [{ type: "text", text: "go" }] },
        {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "500 status code (no body)",
        },
      ],
    }),
  );
  assert.deepEqual(failed, [{ type: "error", text: "500 status code (no body)", fatal: true }]);

  // A retryable agent_end is not the end of the turn.
  const retrying = pi.parse(
    JSON.stringify({
      type: "agent_end",
      willRetry: true,
      messages: [{ role: "assistant", content: [], stopReason: "error", errorMessage: "boom" }],
    }),
  );
  assert.deepEqual(retrying, []);

  // A settled successful turn reports nothing at all.
  assert.deepEqual(
    pi.parse(
      JSON.stringify({
        type: "agent_end",
        willRetry: false,
        messages: [
          { role: "assistant", content: [{ type: "text", text: "OK" }], stopReason: "stop" },
        ],
      }),
    ),
    [],
  );
});

test("Pi does not label a configured but non-READY provider as signed in", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "ade-pi-auth-"));
  const previousHome = process.env.HOME;
  // os.homedir() reads USERPROFILE on Windows, not HOME.
  const previousProfile = process.env.USERPROFILE;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
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
    if (previousProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousProfile;
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
    "--skip-git-repo-check",
    "--cd",
    "/tmp/project",
    "--sandbox",
    "workspace-write",
    "Go",
  ]);
  // `opencode run` has no --dir option (only `attach` does); the project comes
  // from the process cwd ADE spawns the CLI in. Passing --dir made the CLI
  // print usage and exit 1 without ever sending the prompt.
  assert.deepEqual(opencode.command(base)[1], ["run", "--format", "json", "Go"]);
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
    "--skip-git-repo-check",
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
    "--skip-git-repo-check",
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

const imageAttachment = {
  path: "/tmp/shot.png",
  mime: "image/png",
  kind: "image",
  name: "shot.png",
};
const fileAttachment = {
  path: "/tmp/notes.txt",
  mime: "text/plain",
  kind: "file",
  name: "notes.txt",
};

test("Codex ends image flags with -- so the prompt is not swallowed", () => {
  const args = codex.command({
    projectPath: "/tmp/project",
    prompt: "Look at this",
    session: { id: "s" },
    continuing: false,
    attachments: [imageAttachment],
  })[1];
  const imageAt = args.indexOf("--image");
  const sepAt = args.lastIndexOf("--");
  assert.ok(imageAt >= 0);
  assert.equal(args[imageAt + 1], "/tmp/shot.png");
  assert.equal(args[sepAt], "--");
  assert.equal(args[sepAt + 1], "Look at this");
  assert.equal(args.at(-1), "Look at this");

  const resumed = codex.command({
    projectPath: "/tmp/project",
    prompt: "Look at this",
    session: { id: "s", agentSessionId: "thread-1" },
    continuing: true,
    attachments: [imageAttachment],
  })[1];
  assert.equal(resumed.at(-2), "--");
  assert.equal(resumed.at(-1), "Look at this");
});

test("adapters pass native attachment flags when provided", () => {
  const codexArgs = codex.command({
    projectPath: "/tmp/project",
    prompt: "Look",
    session: { id: "s" },
    continuing: false,
    attachments: [imageAttachment, fileAttachment],
  })[1];
  assert.ok(codexArgs.includes("--image"));
  assert.ok(codexArgs.includes("/tmp/shot.png"));
  assert.ok(
    !codexArgs.some((arg, i) => arg === "--image" && codexArgs[i + 1] === "/tmp/notes.txt"),
  );

  const openCodeArgs = opencode.command({
    projectPath: "/tmp/project",
    prompt: "Look",
    session: { id: "s" },
    continuing: false,
    attachments: [imageAttachment, fileAttachment],
  })[1];
  assert.deepEqual(
    openCodeArgs.filter((a) => a === "--file"),
    ["--file", "--file"],
  );
  assert.ok(openCodeArgs.includes("/tmp/shot.png"));
  assert.ok(openCodeArgs.includes("/tmp/notes.txt"));

  const piArgs = pi.command({
    prompt: "Look",
    session: { id: "s" },
    continuing: false,
    dataDir: "/tmp/ade",
    providers: ["opencode-go"],
    attachments: [imageAttachment, fileAttachment],
  })[1];
  const promptIndex = piArgs.indexOf("Look");
  assert.ok(piArgs.includes("@/tmp/shot.png"));
  assert.ok(piArgs.includes("@/tmp/notes.txt"));
  assert.ok(piArgs.indexOf("@/tmp/shot.png") < promptIndex);
  assert.ok(piArgs.indexOf("@/tmp/notes.txt") < promptIndex);
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

const computer = {
  node: "/usr/bin/node",
  mcpScript: "/ade/src/local/computer-mcp.mjs",
  piExtension: "/ade/src/local/computer-pi-extension.mjs",
  env: { ADE_API: "http://127.0.0.1:3000", ADE_PROJECT_ID: "p1" },
};

test("every agent gets the computer: Codex MCP overrides, OpenCode inline config, Pi extension", () => {
  const base = { projectPath: "/tmp/project", prompt: "Test it", session, continuing: false };
  const [, codexArgs, codexEnv] = codex.command({ ...base, computer });
  assert.ok(codexArgs.includes('mcp_servers.ade_computer.command="/usr/bin/node"'));
  assert.ok(
    codexArgs.includes('mcp_servers.ade_computer.args=["/ade/src/local/computer-mcp.mjs"]'),
  );
  assert.ok(
    codexArgs.includes(
      'mcp_servers.ade_computer.env={ADE_API="http://127.0.0.1:3000",ADE_PROJECT_ID="p1"}',
    ),
  );
  // `codex exec` runs with approval policy "never", which denies MCP tools
  // unless their server pre-approves them; only ADE's own server is approved.
  assert.ok(codexArgs.includes('mcp_servers.ade_computer.default_tools_approval_mode="approve"'));
  assert.ok(!codexArgs.some((a) => a.startsWith("approval_policy")));
  assert.equal(codexArgs.at(-1), "Test it");
  assert.equal(codexEnv, undefined);
  const resumed = codex.command({
    ...base,
    continuing: true,
    session: { ...session, agentSessionId: "t1" },
    computer,
  })[1];
  assert.ok(resumed.some((a) => a.startsWith("mcp_servers.ade_computer.command=")));
  assert.equal(resumed.at(-2), "t1");
  // Overrides must precede Codex's greedy --image list and the prompt.
  const withImage = codex.command({
    ...base,
    computer,
    attachments: [{ kind: "image", path: "/tmp/a.png" }],
  })[1];
  assert.ok(
    withImage.lastIndexOf("-c") < withImage.indexOf("--image"),
    "computer -c overrides come before --image",
  );

  const [, , openCodeEnv] = opencode.command({ ...base, computer });
  const config = JSON.parse(openCodeEnv.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(config.mcp.ade_computer.command, [computer.node, computer.mcpScript]);
  assert.deepEqual(config.mcp.ade_computer.environment, computer.env);

  const [, piArgs, piEnv] = pi.command({ ...base, dataDir: "/data", computer });
  assert.equal(piArgs[piArgs.indexOf("-e") + 1], computer.piExtension);
  const allowed = piArgs[piArgs.indexOf("--tools") + 1].split(",");
  assert.ok(allowed.includes("read") && allowed.includes("computer_screenshot"));
  assert.ok(!allowed.includes("bash"));
  assert.deepEqual(piEnv, computer.env);
  const planned = pi.command({ ...base, dataDir: "/data", computer, permission: "plan" })[1];
  const planTools = planned[planned.indexOf("--tools") + 1].split(",");
  assert.ok(!planTools.includes("edit") && planTools.includes("computer_click"));
});

test("without a computer context nothing extra is passed", () => {
  const base = { projectPath: "/tmp/project", prompt: "x", session, continuing: false };
  assert.ok(!codex.command(base)[1].some((a) => a.includes("ade_computer")));
  assert.deepEqual(opencode.command(base)[2], {});
  const piArgs = pi.command({ ...base, dataDir: "/data" })[1];
  assert.ok(!piArgs.includes("-e"));
  assert.equal(piArgs[piArgs.indexOf("--tools") + 1], "read,edit,write,grep,find,ls");
});

test("Claude Code runs over ACP: the bridge drives the user's own claude", async () => {
  assert.equal(claude.bin, "claude");
  assert.deepEqual(
    claude.command({
      bridge: ["/usr/bin/node", ["/home/u/.ade/acp/claude-agent-acp-0.99.0/index.js"]],
      executable: "/home/u/.local/bin/claude",
    }),
    [
      "/usr/bin/node",
      ["/home/u/.ade/acp/claude-agent-acp-0.99.0/index.js"],
      { CLAUDE_CODE_EXECUTABLE: "/home/u/.local/bin/claude" },
    ],
  );
  assert.deepEqual(claude.modes, { build: ["acceptEdits"], plan: ["plan"] });
  const calls = [];
  const runWith = (stdout) => async (bin, args) => {
    calls.push([bin, ...args]);
    return { code: 0, stdout, stderr: "" };
  };
  assert.deepEqual(
    await claude.detectAuth(runWith(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }))),
    { signedIn: true, account: "Claude Code account (claude.ai)" },
  );
  assert.deepEqual(calls[0], ["claude", "auth", "status", "--json"]);
  assert.deepEqual(await claude.detectAuth(runWith(JSON.stringify({ loggedIn: false }))), {
    signedIn: false,
  });
  assert.deepEqual(await claude.detectAuth(runWith("not json")), { signedIn: false });
  // An odd auth method string never reaches the UI.
  assert.equal(
    (
      await claude.detectAuth(
        runWith(JSON.stringify({ loggedIn: true, authMethod: "\u001b[31mx" })),
      )
    ).account,
    "Claude Code account",
  );
});

test("Claude pre-allows only ADE's own MCP server and never offers bypass mode", () => {
  assert.deepEqual(claude.sessionMeta({ computer: true }), {
    claudeCode: {
      options: { allowDangerouslySkipPermissions: false, allowedTools: ["mcp__ade_computer"] },
    },
  });
  assert.deepEqual(claude.sessionMeta({ computer: false }), {
    claudeCode: { options: { allowDangerouslySkipPermissions: false } },
  });
  // The model-list session saves no transcript and no memory folder.
  assert.deepEqual(claude.sessionMeta({ computer: false, ephemeral: true }), {
    claudeCode: {
      options: {
        allowDangerouslySkipPermissions: false,
        persistSession: false,
        settings: { autoMemoryEnabled: false },
      },
    },
  });
});

test("ACP agents receive the agent computer as a stdio MCP server", () => {
  const computer = {
    node: "/usr/bin/node",
    mcpScript: "/ade/src/local/computer-mcp.mjs",
    piExtension: "/ade/src/local/computer-pi-extension.mjs",
    env: { ADE_API: "http://127.0.0.1:3000", ADE_PROJECT_ID: "p1" },
  };
  assert.deepEqual(acpComputerServers(computer), [
    {
      name: "ade_computer",
      command: "/usr/bin/node",
      args: ["/ade/src/local/computer-mcp.mjs"],
      env: [
        { name: "ADE_API", value: "http://127.0.0.1:3000" },
        { name: "ADE_PROJECT_ID", value: "p1" },
      ],
    },
  ]);
  assert.deepEqual(acpComputerServers(null), []);
});
