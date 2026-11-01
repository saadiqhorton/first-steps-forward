// Session turns end to end through ADE's API, with scripted stand-ins for the
// JSON-lines agent CLIs (codex, opencode, pi) on PATH: real spawn, real
// output parsing, real turn lifecycle.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skip = process.platform === "win32" ? "the fake CLIs are POSIX shell shims" : false;
const FAKE = fileURLToPath(new URL("./cli-fake-agent.test-helper.mjs", import.meta.url));
const home = mkdtempSync(path.join(os.tmpdir(), "ade-turns-"));
process.once("exit", () => rmSync(home, { recursive: true, force: true }));
mkdirSync(path.join(home, ".ade"), { mode: 0o700 });
const binDir = path.join(home, "bin");
mkdirSync(binDir);
for (const name of ["codex", "opencode", "pi"]) {
  writeFileSync(
    path.join(binDir, name),
    `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" ${name} "$@"\n`,
  );
  chmodSync(path.join(binDir, name), 0o755);
}
const invocations = path.join(home, "invocations.ndjson");
writeFileSync(invocations, "");

// One project per test, so a running turn in one never makes another wait.
const projectIds = [];
const project = (name, packageJson = { name }) => {
  const dir = path.join(home, name);
  mkdirSync(dir);
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(packageJson));
  projectIds.push(name);
  return {
    id: name,
    name,
    path: dir,
    branch: "not a git repository",
    ahead: 0,
    uncommittedFiles: [],
    defaultAgent: "codex",
    addedAt: 1,
  };
};
const projects = [
  project("p-turn"),
  project("p-queue"),
  project("p-now"),
  project("p-drop"),
  project("p-stop"),
  project("p-quota"),
  project("p-pi"),
  project("p-huge"),
  project("p-huge-error"),
  project("p-oc"),
  project("p-silent"),
  project("p-switch"),
  project("p-switch-race"),
  project("p-checks", {
    name: "checks",
    scripts: { test: `"${process.execPath}" -e "setTimeout(() => {}, 1200)"` },
  }),
  project("p-complete"),
  project("p-boot"),
  project("p-kind"),
  project("p-checks-stop", {
    name: "checks-stop",
    scripts: {
      typecheck: `"${process.execPath}" -e "setTimeout(() => {}, 800)"`,
      test: `"${process.execPath}" -e ""`,
    },
  }),
  project("p-manifest", {
    name: "manifest",
    scripts: { dev: "vite", "dev:backend": "node server.js" },
  }),
];
const agentRow = (id, name, extra = {}) => ({
  id,
  name,
  short: name,
  tools: `${name} tools`,
  authMethod: "x",
  authNote: "x",
  installHint: "x",
  installed: true,
  version: "1.0.0",
  signedIn: true,
  carriesConversation: true,
  installMethod: "npm",
  harness: { install: "x", update: "x" },
  ...extra,
});
const agents = [
  agentRow("codex", "OpenAI Codex"),
  agentRow("opencode", "OpenCode"),
  agentRow("pi", "Pi Agent", { providers: ["anthropic"] }),
];
writeFileSync(
  path.join(home, ".ade", "agents-status.json"),
  JSON.stringify({ fetchedAt: Date.now(), agents }),
);
writeFileSync(
  path.join(home, ".ade", "workspace.json"),
  JSON.stringify({
    projects,
    sessions: [
      {
        id: "s-biglog",
        projectId: "p-boot",
        agentId: "codex",
        createdBy: "codex",
        request: "task",
        criteria: "",
        status: "complete",
        messages: [],
        changes: [],
        checks: [],
        logs: [
          "$ codex exec",
          JSON.stringify({
            type: "agent_end",
            willRetry: false,
            messages: ["m".repeat(1_700_000)],
          }),
        ],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "s-interrupted",
        projectId: "p-boot",
        agentId: "codex",
        createdBy: "codex",
        request: "task",
        criteria: "",
        status: "working",
        steerNow: "go now",
        pendingPermissions: [{ id: "q1", title: "Run", options: [] }],
        messages: [],
        changes: [],
        checks: [],
        logs: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    processes: [],
  }),
);
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
process.env.FAKE_CLI_LOG = invocations;

const { handleLocalApi, _setAgentsForTest, _getSessionForTest } = await import("./ade-local.mjs");
_setAgentsForTest(agents);

const call = async (urlPath, body) => {
  const res = await handleLocalApi({
    url: `http://127.0.0.1:3000${urlPath}`,
    method: body === undefined ? "GET" : "POST",
    headers: { entries: () => [["host", "127.0.0.1:3000"]] },
    runtime: { node: { req: { socket: { remoteAddress: "::ffff:127.0.0.1" } } } },
    text: async () => JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: await res.json() };
};
async function waitFor(check, what, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const session = (id) => _getSessionForTest(id);
const settled = (id) => {
  const s = session(id);
  return s && !s.pid && ["ready", "blocked", "stopped"].includes(s.status) ? s : null;
};
/** Agent turns (not version, auth or model probes) started in a project. */
const turns = (projectId) =>
  readFileSync(invocations, "utf8")
    .split("\n")
    // A CLI may be mid-append: only newline-terminated lines are complete.
    .slice(0, -1)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter(
      (inv) =>
        inv.cwd === path.join(home, projectId) &&
        (inv.args[0] === "exec" || inv.args[0] === "run" || inv.args.includes("-p")),
    );
const promptOf = (inv) => inv.args.at(-1);
const systemTexts = (s) => s.messages.filter((m) => m.role === "system").map((m) => m.text);
const gates = [];
/** A gate file: turns in the "gate" scenario wait until it is opened. */
const gate = () => {
  const file = path.join(home, `gate-${gates.length + 1}`);
  gates.push(file);
  process.env.FAKE_CLI_GATE = file;
  return { open: () => writeFileSync(file, "") };
};
// A failed test must not leave a gated fake agent holding the test process open.
test.after(() => {
  for (const file of gates) writeFileSync(file, "");
});
const start = async (projectId, scenario = "text", extra = {}) => {
  process.env.FAKE_CLI_SCENARIO = scenario;
  const created = await call("/api/sessions", {
    projectId,
    agentId: "codex",
    request: "tidy the readme wording",
    ...extra,
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json.id;
};

test("boot recovery stops an interrupted turn and forgets what died with it", { skip }, () => {
  const s = session("s-interrupted");
  assert.equal(s.status, "stopped");
  assert.equal(s.steerNow, undefined);
  assert.equal(s.pendingPermissions, undefined);
  assert.ok(systemTexts(s).some((t) => t.startsWith("ADE restarted and stopped")));
});

test("boot shrinks stored logs and the next save drops the old megabytes", { skip }, async () => {
  const stored = session("s-biglog").logs;
  assert.equal(stored[0], "$ codex exec");
  assert.deepEqual(JSON.parse(stored[1]), { type: "agent_end", willRetry: false });
  const onDisk = () => readFileSync(path.join(home, ".ade", "workspace.json"), "utf8");
  await waitFor(() => !onDisk().includes("mmmmmmmmmm"), "the shrunk workspace to be saved");
});

test("a Codex turn runs to ready with the agent's reply", { skip }, async () => {
  const id = await start("p-turn");
  const done = await waitFor(() => settled(id), "the turn");
  assert.equal(done.status, "ready");
  assert.equal(done.agentSessionId, "thread-1");
  assert.equal(done.messages.at(-1).text, "Done.");
  assert.equal(done.summary, "Done.");
  const [first] = turns("p-turn");
  assert.deepEqual(first.args.slice(0, 2), ["exec", "--json"]);
  assert.ok(first.args.includes("workspace-write"));
  assert.match(promptOf(first), /^Safety instructions:/);
  assert.match(promptOf(first), /Task: tidy the readme wording$/);
  // The agent browser tools reach ADE's real URL through Codex's MCP config.
  assert.ok(
    first.args.includes(
      'mcp_servers.ade_computer.env={ADE_API="http://127.0.0.1:3000",ADE_PROJECT_ID="p-turn"}',
    ),
  );
});

test("a follow-up during a turn waits, then runs as the next turn", { skip }, async () => {
  const { open } = gate();
  const id = await start("p-queue", "gate");
  await waitFor(() => session(id).messages.some((m) => m.text === "Working."), "the first reply");
  const queued = await call(`/api/sessions/${id}/messages`, { text: "also fix the title" });
  assert.equal(queued.status, 200);
  assert.deepEqual(session(id).queuedMessages, ["also fix the title"]);
  assert.equal(turns("p-queue").length, 1);
  open();
  await waitFor(() => turns("p-queue").length === 2 && settled(id), "the queued turn");
  const second = turns("p-queue")[1];
  assert.deepEqual(second.args.slice(0, 3), ["exec", "resume", "--json"]);
  assert.ok(second.args.includes("thread-1"));
  assert.match(promptOf(second), /Task: also fix the title$/);
  assert.equal(session(id).status, "ready");
  assert.deepEqual(session(id).queuedMessages, []);
});

test("send now stops the running turn and runs the message next", { skip }, async () => {
  const { open } = gate();
  const id = await start("p-now", "gate");
  await waitFor(() => session(id).messages.some((m) => m.text === "Working."), "the first reply");
  process.env.FAKE_CLI_SCENARIO = "text";
  const now = await call(`/api/sessions/${id}/messages`, { text: "stop, do this", when: "now" });
  assert.equal(now.status, 200);
  const done = await waitFor(
    () => turns("p-now").length === 2 && settled(id),
    "the replacement turn",
  );
  open();
  assert.equal(done.status, "ready");
  assert.match(promptOf(turns("p-now")[1]), /Task: stop, do this$/);
  assert.equal(done.steerNow, undefined);
  // The interrupted turn is not reported as a failure.
  assert.ok(!systemTexts(done).some((t) => t.startsWith("Agent process exited")));
});

test("a waiting message can be dropped, or released to run now", { skip }, async () => {
  const { open } = gate();
  const id = await start("p-drop", "gate");
  await waitFor(() => session(id).messages.some((m) => m.text === "Working."), "the first reply");
  await call(`/api/sessions/${id}/messages`, { text: "never mind this" });
  const dropped = await call(`/api/sessions/${id}/messages`, { when: "drop" });
  assert.equal(dropped.status, 200);
  assert.deepEqual(session(id).queuedMessages, []);
  assert.ok(systemTexts(session(id)).includes("The waiting message will not be sent."));
  const nothing = await call(`/api/sessions/${id}/messages`, { when: "release" });
  assert.equal(nothing.status, 400);

  await call(`/api/sessions/${id}/messages`, { text: "release me" });
  process.env.FAKE_CLI_SCENARIO = "text";
  const released = await call(`/api/sessions/${id}/messages`, { when: "release" });
  assert.equal(released.status, 200);
  const done = await waitFor(
    () => turns("p-drop").length === 2 && settled(id),
    "the released turn",
  );
  open();
  assert.equal(done.status, "ready");
  assert.match(promptOf(turns("p-drop")[1]), /Task: release me$/);
});

test("stop ends the running turn and keeps the session stopped", { skip }, async () => {
  gate();
  const id = await start("p-stop", "gate");
  await waitFor(() => session(id).messages.some((m) => m.text === "Working."), "the first reply");
  const stopped = await call(`/api/sessions/${id}/stop`, {});
  assert.equal(stopped.status, 200);
  const done = await waitFor(() => settled(id), "the stop");
  assert.equal(done.status, "stopped");
  assert.ok(
    systemTexts(done).includes(
      "Stopped. Files are kept. Send a message when you want it to continue.",
    ),
  );
  assert.equal(turns("p-stop").length, 1);
});

test("a rate-limited turn is blocked with the quota recovery state", { skip }, async () => {
  const id = await start("p-quota", "quota");
  const done = await waitFor(() => settled(id), "the failed turn");
  assert.equal(done.status, "blocked");
  assert.equal(done.failureKind, "provider_quota");
  assert.ok(
    systemTexts(done).some(
      (t) => t.startsWith("Provider quota or rate limit reached") && t.includes("try again in 20s"),
    ),
  );
});

test("Pi's settled error blocks a turn that exited 0", { skip }, async () => {
  const id = await start("p-pi", "settled-error", { agentId: "pi" });
  const done = await waitFor(() => settled(id), "the failed turn");
  assert.equal(done.status, "blocked");
  const texts = systemTexts(done);
  assert.ok(texts.includes("Provider overloaded"));
  assert.ok(texts.some((t) => t.startsWith("The agent reported that this turn failed")));
  const [first] = turns("p-pi");
  assert.ok(first.args.includes("--provider") && first.args.includes("anthropic"));
});

test("a megabyte Pi line is stored as small valid JSON and the reply stays", { skip }, async () => {
  const id = await start("p-huge", "huge", { agentId: "pi" });
  const done = await waitFor(() => settled(id), "the turn");
  assert.equal(done.status, "ready");
  assert.ok(done.logs.length > 2);
  for (const line of done.logs) assert.ok(line.length < 8192, `a ${line.length}-char line`);
  const events = done.logs.filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
  const agentEnd = events.find((event) => event.type === "agent_end");
  assert.ok(agentEnd && !("messages" in agentEnd));
  const toolEnd = events.find((event) => event.type === "tool_execution_end");
  assert.match(toolEnd.result, /^A{500}…\[\+299500 chars\]$/);
  // A short line is stored exactly as the CLI wrote it.
  assert.ok(
    done.logs.includes(
      JSON.stringify({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
      }),
    ),
  );
  assert.ok(done.messages.some((m) => m.role === "agent" && m.text === "Done."));
});

test("a failure inside a megabyte Pi line is still classified", { skip }, async () => {
  const id = await start("p-huge-error", "huge-error", { agentId: "pi" });
  const done = await waitFor(() => settled(id), "the failed turn");
  assert.equal(done.status, "blocked");
  assert.equal(done.failureKind, "provider_quota");
  assert.ok(systemTexts(done).some((t) => t.includes("try again in 20s")));
  assert.ok(done.logs.every((line) => line.length < 8192));
});

test("OpenCode: a model error on stderr after exit 0 blocks the turn", { skip }, async () => {
  const id = await start("p-oc", "silent-error", { agentId: "opencode" });
  const done = await waitFor(() => settled(id), "the failed turn");
  assert.equal(done.status, "blocked");
  assert.equal(done.failureKind, "model_not_found");

  process.env.FAKE_CLI_SCENARIO = "permission";
  await call(`/api/sessions/${id}/messages`, { text: "try again" });
  const again = await waitFor(() => turns("p-oc").length === 2 && settled(id), "the second turn");
  assert.equal(again.status, "ready");
  assert.equal(again.failureKind, undefined);
  assert.ok(
    systemTexts(again).some((t) =>
      t.startsWith("OpenCode requested permission for bash (rm -rf build)"),
    ),
  );
  assert.ok(turns("p-oc")[1].args.includes("--session"));
});

test("a turn that exits 0 with no reply says so and stays ready", { skip }, async () => {
  const id = await start("p-silent", "silent");
  const done = await waitFor(() => settled(id), "the turn");
  assert.equal(done.status, "ready");
  assert.ok(systemTexts(done).some((t) => t.startsWith("The CLI exited successfully but did not")));
});

test(
  "model and provider changes do not start a CLI until the user sends a message",
  { skip },
  async () => {
    const id = await start("p-switch", "text", { model: "gpt-5.5", effort: "high" });
    await waitFor(() => settled(id), "the first turn");
    const modelChanged = await call(`/api/sessions/${id}/model`, { model: "gpt-5.6-sol" });
    assert.equal(modelChanged.status, 200);
    assert.equal(modelChanged.json.status, "ready");
    assert.equal(turns("p-switch").length, 1);

    const switched = await call(`/api/sessions/${id}/switch-agent`, {
      agentId: "opencode",
      model: "opencode-go/gpt-5.6-luna",
      permission: "build",
    });
    assert.equal(switched.status, 200);
    assert.equal(switched.json.carriesConversation, false);
    assert.equal(switched.json.status, "ready");
    assert.equal(switched.json.model, "opencode-go/gpt-5.6-luna");
    assert.equal(turns("p-switch").length, 1);
    assert.match(systemTexts(switched.json).at(-1), /No agent turn was started/);

    const message = await call(`/api/sessions/${id}/messages`, { text: "keep going" });
    assert.equal(message.status, 200);
    const done = await waitFor(
      () => turns("p-switch").length === 2 && settled(id),
      "the first OpenCode turn",
    );
    assert.equal(done.status, "ready");
    assert.equal(done.agentId, "opencode");
    assert.equal(done.model, "opencode-go/gpt-5.6-luna");
    assert.equal(done.effort, undefined);
    assert.ok(
      systemTexts(done).some((t) => t.startsWith("Switched from OpenAI Codex to OpenCode")),
    );
    const second = turns("p-switch")[1];
    assert.equal(second.agent, "opencode");
    assert.match(promptOf(second), /A different coding agent worked on this task before you/);
    assert.match(promptOf(second), /Original request: tidy the readme wording/);
    assert.match(promptOf(second), /User follow-up: keep going/);
    assert.ok(second.args.includes("opencode-go/gpt-5.6-luna"));
  },
);

test(
  "a message sent right after an agent switch starts exactly one fresh turn",
  { skip },
  async () => {
    const id = await start("p-switch-race");
    await waitFor(() => settled(id), "the first turn");
    const { open } = gate();
    process.env.FAKE_CLI_SCENARIO = "gate";
    await call(`/api/sessions/${id}/switch-agent`, { agentId: "opencode" });
    const followUp = await call(`/api/sessions/${id}/messages`, { text: "and the footer" });
    assert.equal(followUp.status, 200);
    await waitFor(() => turns("p-switch-race").length === 2, "the user-requested turn to start");
    // Give a wrongly auto-started provider turn time to show up.
    await sleep(500);
    assert.equal(turns("p-switch-race").length, 2, "only one turn runs at a time");
    process.env.FAKE_CLI_SCENARIO = "text";
    open();
    const done = await waitFor(() => settled(id), "the user-requested turn");
    assert.equal(done.status, "ready");
    assert.match(promptOf(turns("p-switch-race")[1]), /User follow-up: and the footer/);
  },
);

test(
  "checks run on a ready session; send now during checks runs the message",
  { skip },
  async () => {
    const id = await start("p-checks");
    await waitFor(() => settled(id), "the first turn");
    const ran = await call(`/api/sessions/${id}/checks`, {});
    assert.equal(ran.status, 200);
    assert.equal(ran.json.status, "ready");
    assert.equal(ran.json.checks.find((c) => c.name === "Unit tests").status, "passed");
    assert.equal(ran.json.checks.find((c) => c.name === "Lint").status, "skipped");

    const running = call(`/api/sessions/${id}/checks`, {});
    await waitFor(() => session(id).status === "verifying", "checks to start");
    const busy = await call(`/api/sessions/${id}/checks`, {});
    assert.equal(busy.status, 409);
    const now = await call(`/api/sessions/${id}/messages`, { text: "skip checks", when: "now" });
    assert.equal(now.status, 200);
    await running;
    const done = await waitFor(
      () => turns("p-checks").length === 2 && settled(id),
      "the message after checks",
    );
    assert.equal(done.status, "ready");
    assert.match(promptOf(turns("p-checks")[1]), /Task: skip checks$/);
  },
);

test("complete waits for the agent; reopen makes it ready again", { skip }, async () => {
  const { open } = gate();
  const id = await start("p-complete", "gate");
  await waitFor(() => session(id).messages.some((m) => m.text === "Working."), "the first reply");
  assert.equal((await call(`/api/sessions/${id}/complete`, {})).status, 409);
  open();
  await waitFor(() => settled(id), "the turn");
  const completed = await call(`/api/sessions/${id}/complete`, {});
  assert.equal(completed.status, 200);
  assert.equal(completed.json.status, "complete");
  assert.equal((await call(`/api/sessions/${id}/messages`, { text: "more" })).status, 409);
  const reopened = await call(`/api/sessions/${id}/reopen`, {});
  assert.equal(reopened.json.status, "ready");
});

test("failureKind always describes the latest turn", { skip }, async () => {
  const id = await start("p-kind", "quota");
  const next = async (scenario, n) => {
    process.env.FAKE_CLI_SCENARIO = scenario;
    await call(`/api/sessions/${id}/messages`, { text: `try ${n}` });
    return waitFor(() => turns("p-kind").length === n && settled(id), `turn ${n}`);
  };
  assert.equal((await waitFor(() => settled(id), "turn 1")).failureKind, "provider_quota");
  // A generic failure clears the earlier diagnosis instead of repeating it.
  const crashed = await next("crash", 2);
  assert.equal(crashed.status, "blocked");
  assert.equal(crashed.failureKind, undefined);
  assert.ok(systemTexts(crashed).some((t) => t.startsWith("Agent process exited with code 2")));
  assert.equal((await next("quota", 3)).failureKind, "provider_quota");
  const ok = await next("text", 4);
  assert.equal(ok.status, "ready");
  assert.equal(ok.failureKind, undefined);
});

test("a stop during checks is never overwritten by the checks finishing", { skip }, async () => {
  const id = await start("p-checks-stop");
  await waitFor(() => settled(id), "the first turn");
  const running = call(`/api/sessions/${id}/checks`, {});
  await waitFor(() => session(id).status === "verifying", "checks to start");
  const stopped = await call(`/api/sessions/${id}/stop`, {});
  assert.equal(stopped.json.status, "stopped");
  const ran = await running;
  assert.equal(ran.status, 200);
  assert.equal(ran.json.status, "stopped");
  // The check that was running finishes; the next one never starts.
  assert.equal(
    ran.json.checks.find((c) => c.name === "Unit tests"),
    undefined,
  );
  assert.equal(session(id).status, "stopped");
});

test(
  "the context manifest gives the agent its browser, dev server rules and services",
  { skip },
  async () => {
    const id = await start("p-manifest");
    await waitFor(() => settled(id), "the turn");
    const prompt = promptOf(turns("p-manifest")[0]);
    // The tool list comes from the tool definitions, browser_* tools included.
    assert.match(prompt, /agent browser: available \(1280x800; tools: [^)]*computer_open_url/);
    for (const tool of [
      "computer_screenshot",
      "dev_server_start",
      "browser_snapshot",
      "browser_upload",
    ])
      assert.ok(prompt.includes(tool), `the prompt lists ${tool}`);
    assert.match(
      prompt,
      /only with the dev_server_start\/dev_server_stop\/dev_server_status tools; never start a server yourself/,
    );
    assert.match(prompt, /verify it in your agent browser/);
    assert.match(prompt, /instead of asking the user which frontend port/);
    assert.match(
      prompt,
      /Additional package scripts: dev:backend\. ADE does not verify whether these services are running/,
    );
    const manifest = session(id).manifest;
    assert.equal(manifest.agentComputer.available, true);
    assert.equal(manifest.agentComputer.screen, "1280x800");

    // Pi gets the same browser, as a Pi extension.
    process.env.FAKE_CLI_SCENARIO = "text";
    const switched = await call(`/api/sessions/${id}/switch-agent`, { agentId: "pi" });
    assert.equal(switched.json.status, "ready");
    assert.equal(turns("p-manifest").length, 1);
    await call(`/api/sessions/${id}/messages`, { text: "continue with Pi" });
    await waitFor(() => turns("p-manifest").length === 2 && settled(id), "the Pi turn");
    const piArgs = turns("p-manifest")[1].args;
    assert.ok(
      piArgs[piArgs.indexOf("-e") + 1].endsWith(
        path.join("src", "local", "computer-pi-extension.mjs"),
      ),
    );
    assert.ok(piArgs[piArgs.indexOf("--tools") + 1].includes("computer_open_url"));
  },
);
