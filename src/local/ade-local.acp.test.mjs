// End to end through ADE's API with a scripted ACP agent standing in for
// claude-agent-acp on PATH (and a stand-in `claude` beside it): real spawn,
// real JSON-RPC, real turn lifecycle.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skip = process.platform === "win32" ? "the fake agent is a POSIX shell shim" : false;
const FAKE = fileURLToPath(new URL("./acp-fake-agent.test-helper.mjs", import.meta.url));
const home = mkdtempSync(path.join(os.tmpdir(), "ade-acp-api-"));
mkdirSync(path.join(home, ".ade"), { mode: 0o700 });
const projectDir = path.join(home, "proj");
mkdirSync(projectDir);
writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "proj" }));
const binDir = path.join(home, "bin");
mkdirSync(binDir);
for (const name of ["claude-agent-acp", "claude"]) {
  writeFileSync(path.join(binDir, name), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
  chmodSync(path.join(binDir, name), 0o755);
}
const receivedLog = path.join(home, "received.ndjson");

const claudeAgent = {
  id: "claude",
  name: "Claude Code",
  short: "Claude",
  tools: "tools",
  authMethod: "x",
  authNote: "x",
  installHint: "x",
  installed: true,
  version: "0.99.0",
  signedIn: true,
  carriesConversation: true,
  installMethod: "npm",
  harness: { install: "x", update: "x" },
};
writeFileSync(
  path.join(home, ".ade", "agents-status.json"),
  JSON.stringify({ fetchedAt: Date.now(), agents: [claudeAgent] }),
);
writeFileSync(
  path.join(home, ".ade", "workspace.json"),
  JSON.stringify({
    projects: [
      {
        id: "p1",
        name: "proj",
        path: projectDir,
        branch: "not a git repository",
        ahead: 0,
        uncommittedFiles: [],
        defaultAgent: "claude",
        addedAt: 1,
      },
    ],
    sessions: [],
    processes: [],
  }),
);
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
process.env.FAKE_ACP_LOG = receivedLog;

const {
  handle,
  start: startAde,
  _setAgentsForTest,
  _getSessionForTest,
} = await import("./ade-local.mjs");
const { callApi } = await import("./api-request.test-helper.mjs");
_setAgentsForTest([claudeAgent]);
await startAde();
// On exit, not in after(): ADE's last workspace save can land after the tests end.
process.once("exit", () => rmSync(home, { recursive: true, force: true }));

const call = async (urlPath, body) => {
  const res = await callApi(handle, {
    url: `http://127.0.0.1:3000${urlPath}`,
    body,
    remoteAddress: "::ffff:127.0.0.1",
  });
  return { status: res.status, json: await res.json() };
};
async function waitFor(check, what) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const received = () =>
  readFileSync(receivedLog, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((message) => message.method);
const startups = () =>
  readFileSync(receivedLog, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((message) => message.startup);
const settled = (id) => {
  const s = _getSessionForTest(id);
  return s && !s.pid && ["ready", "blocked", "stopped"].includes(s.status) ? s : null;
};
const start = async (scenario, extra = {}) => {
  process.env.FAKE_ACP_SCENARIO = scenario;
  const created = await call("/api/sessions", {
    projectId: "p1",
    agentId: "claude",
    request: "tidy the readme wording",
    permission: "build",
    ...extra,
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json.id;
};

test("the model list comes from Claude itself before any task", { skip }, async () => {
  writeFileSync(receivedLog, "");
  const listed = await call("/api/agents/claude/models");
  assert.equal(listed.status, 200);
  assert.equal(listed.json.source, "acp");
  assert.deepEqual(
    listed.json.models.map((m) => m.id),
    ["default", "opus"],
  );
  // A session that is never prompted and leaves nothing in ~/.claude.
  const opened = received().find((m) => m.method === "session/new").params;
  assert.equal(opened._meta.claudeCode.options.persistSession, false);
  assert.ok(!received().some((m) => m.method === "session/prompt"));
  // Remembered for this Claude Code version: no second probe.
  writeFileSync(receivedLog, "");
  assert.equal((await call("/api/agents/claude/models")).json.source, "acp");
  assert.deepEqual(startups(), []);
});

test(
  "a permission request pauses the turn until the user answers over the API",
  { skip },
  async () => {
    writeFileSync(receivedLog, "");
    const id = await start("permission");
    const asked = await waitFor(
      () => _getSessionForTest(id)?.pendingPermissions?.[0],
      "the permission request",
    );
    assert.equal(_getSessionForTest(id).status, "working");
    assert.equal(asked.kind, "execute");
    assert.equal(asked.detail, "rm -rf build");
    assert.deepEqual(
      asked.options.map((o) => o.optionId),
      ["a1", "a2", "r1"],
    );

    const invented = await call(`/api/sessions/${id}/permission`, {
      requestId: asked.id,
      optionId: "approve-everything",
    });
    assert.equal(invented.status, 400);
    const unknown = await call(`/api/sessions/${id}/permission`, {
      requestId: "nope",
      optionId: "a1",
    });
    assert.equal(unknown.status, 409);

    const answered = await call(`/api/sessions/${id}/permission`, {
      requestId: asked.id,
      optionId: "r1",
    });
    assert.equal(answered.status, 200);
    assert.equal(answered.json.pendingPermissions, undefined);

    const done = await waitFor(() => settled(id), "the turn to finish");
    assert.equal(done.status, "ready");
    assert.equal(done.agentSessionId, "s-new");
    assert.ok(
      done.messages.some(
        (m) => m.role === "agent" && m.text === 'answer:{"outcome":"selected","optionId":"r1"}',
      ),
    );
    const decisions = done.logs
      .filter((line) => line.startsWith('{"type":"permission"'))
      .map((line) => JSON.parse(line).decision);
    assert.deepEqual(decisions, ["asked", "rejected"]);

    // The bridge on PATH ran, pointed at the user's own claude.
    assert.deepEqual(
      startups().map((line) => line.startup.CLAUDE_CODE_EXECUTABLE),
      [path.join(binDir, "claude")],
    );
    // What ADE told the agent when the session opened.
    const opened = received().find((m) => m.method === "session/new").params;
    assert.equal(opened.cwd, projectDir);
    assert.equal(opened._meta.claudeCode.options.allowDangerouslySkipPermissions, false);
    assert.equal(
      received().find((m) => m.method === "session/set_mode").params.modeId,
      "acceptEdits",
    );
    const prompt = received().find((m) => m.method === "session/prompt").params.prompt[0].text;
    assert.match(prompt, /Safety instructions:/);
    assert.match(prompt, /Task: tidy the readme wording/);

    // A follow-up resumes the same ACP conversation.
    writeFileSync(receivedLog, "");
    process.env.FAKE_ACP_SCENARIO = "text";
    process.env.FAKE_ACP_RESUME = "1";
    try {
      const followUp = await call(`/api/sessions/${id}/messages`, { text: "one more pass" });
      assert.equal(followUp.status, 200);
      const again = await waitFor(
        () =>
          settled(id) && _getSessionForTest(id).messages.at(-1)?.text === "Hello\n\nDone."
            ? settled(id)
            : null,
        "the follow-up turn",
      );
      assert.equal(again.status, "ready");
      const methods = received().map((m) => m.method);
      assert.ok(methods.includes("session/resume") && !methods.includes("session/new"));
      assert.equal(received().find((m) => m.method === "session/resume").params.sessionId, "s-new");
    } finally {
      delete process.env.FAKE_ACP_RESUME;
    }
  },
);

test("stopping a turn that waits on the user drops the request", { skip }, async () => {
  const id = await start("permission");
  const asked = await waitFor(
    () => _getSessionForTest(id)?.pendingPermissions?.[0],
    "the permission request",
  );
  const stopped = await call(`/api/sessions/${id}/stop`, {});
  assert.equal(stopped.status, 200);
  assert.equal(stopped.json.pendingPermissions, undefined);
  const late = await call(`/api/sessions/${id}/permission`, {
    requestId: asked.id,
    optionId: "a1",
  });
  assert.equal(late.status, 409);
  const done = await waitFor(() => settled(id), "the agent to exit");
  assert.equal(done.status, "stopped");
  // The kill is on purpose: no "exited before finishing" noise.
  assert.ok(!done.messages.some((m) => /before finishing the turn/.test(m.text)));
});

test("Plan sessions decline edits without asking the user", { skip }, async () => {
  const id = await start("edit-permission", { permission: "plan" });
  const done = await waitFor(() => settled(id), "the turn to finish");
  assert.equal(done.status, "ready");
  assert.equal(done.pendingPermissions, undefined);
  assert.ok(done.messages.some((m) => /declined because this session is in Plan/.test(m.text)));
  assert.ok(done.messages.some((m) => m.text.includes('"optionId":"r1"')));
});

test(
  "a Plan turn that ends on a declined plan exit is ready, with the plan shown",
  { skip },
  async () => {
    const id = await start("exit-plan", { permission: "plan" });
    const done = await waitFor(() => settled(id), "the turn to finish");
    assert.equal(done.status, "ready");
    assert.ok(done.messages.some((m) => m.role === "agent" && m.text.includes("1. Add hello.txt")));
    assert.ok(!done.messages.some((m) => /cancelled the turn|did not finish/.test(m.text)));
  },
);

test("a refused sign-in blocks the turn with the auth recovery state", { skip }, async () => {
  process.env.FAKE_ACP_AUTH = "1";
  try {
    const id = await start("text");
    const done = await waitFor(() => settled(id), "the turn to fail");
    assert.equal(done.status, "blocked");
    assert.equal(done.failureKind, "auth_expired");
    assert.ok(done.messages.some((m) => /^Authentication required: /.test(m.text)));
  } finally {
    delete process.env.FAKE_ACP_AUTH;
  }
});

test(
  "an agent that crashes mid-turn blocks the session and keeps its error",
  { skip },
  async () => {
    const id = await start("crash");
    const done = await waitFor(() => settled(id), "the turn to fail");
    assert.equal(done.status, "blocked");
    assert.ok(
      done.messages.some((m) => /exited \(code 3\) before finishing the turn/.test(m.text)),
    );
    assert.ok(done.messages.some((m) => /did not finish this turn/.test(m.text)));
  },
);
