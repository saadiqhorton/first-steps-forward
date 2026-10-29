import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRpc, runAcpTurn, selectValues, toolNameOf } from "./acp.mjs";
import { classifyFailure } from "./classify.mjs";

const FAKE = fileURLToPath(new URL("./acp-fake-agent.test-helper.mjs", import.meta.url));

/** Run one turn against the scripted fake agent; `received` lists what it got. */
async function turn(env = {}, options = {}, on = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-acp-"));
  const log = path.join(dir, "received.ndjson");
  const child = spawn(process.execPath, [FAKE], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, FAKE_ACP_LOG: log, ...env },
  });
  const out = {
    texts: [],
    logs: [],
    notices: [],
    sessionIds: [],
    models: [],
    defaults: [],
    asked: [],
  };
  const received = () => {
    try {
      return readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((message) => !message.startup);
    } catch {
      return [];
    }
  };
  try {
    const result = await runAcpTurn({
      child,
      name: "Fake Agent",
      cwd: dir,
      prompt: "do it",
      permission: "build",
      modes: { build: ["acceptEdits"], plan: ["plan"] },
      ...options,
      on: {
        sessionId: (value) => out.sessionIds.push(value),
        text: (text) => out.texts.push(text),
        log: (line) => out.logs.push(line),
        notice: (text) => out.notices.push(text),
        models: (models) => out.models.push(models),
        defaultModel: (value) => out.defaults.push(value),
        permission: async (request) => {
          out.asked.push(request);
          return { outcome: "cancelled" };
        },
        ...on,
      },
    });
    return { result, out, received: received() };
  } catch (error) {
    error.out = out;
    error.received = received();
    throw error;
  } finally {
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null)
      await new Promise((resolve) => child.once("close", resolve));
    rmSync(dir, { recursive: true, force: true });
  }
}
const methods = (received) => received.filter((m) => m.method).map((m) => m.method);

test("a fresh turn: handshake, Build mode, streamed text, compact tool logs", async () => {
  const { result, out, received } = await turn();
  assert.deepEqual(result, { stopReason: "end_turn" });
  assert.deepEqual(methods(received), [
    "initialize",
    "session/new",
    "session/set_mode",
    "session/prompt",
  ]);
  const init = received[0].params;
  assert.equal(init.protocolVersion, 1);
  // ADE never becomes the agent's file server or shell.
  assert.deepEqual(init.clientCapabilities, {
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
  });
  assert.equal(received.find((m) => m.method === "session/set_mode").params.modeId, "acceptEdits");
  assert.deepEqual(out.sessionIds, ["s-new"]);
  // Chunks are joined into whole messages around tool calls; other sessions' updates are dropped.
  assert.deepEqual(out.texts, ["Hello", "\n\nDone."]);
  const toolLine = out.logs.map((l) => JSON.parse(l)).find((e) => e.type === "tool_call");
  assert.deepEqual(toolLine, { type: "tool_call", toolName: "Read", input: { path: "/p/a.ts" } });
  assert.ok(
    out.logs.every((line) => line.length < 600),
    "file contents never reach the log",
  );
  assert.ok(out.logs.some((l) => JSON.parse(l).type === "tool_result"));
  assert.ok(out.logs.some((l) => JSON.parse(l).type === "plan"));
  assert.deepEqual(out.models, [
    [
      { id: "default", label: "Default" },
      { id: "opus", label: "Opus", meta: "Most capable" },
    ],
  ]);
  assert.deepEqual(out.defaults, ["default"]);
});

test("a follow-up resumes the conversation and restores the recorded default model", async () => {
  const { out, received } = await turn(
    { FAKE_ACP_RESUME: "1" },
    { resumeId: "s-old", defaultModel: "default" },
  );
  assert.deepEqual(methods(received), [
    "initialize",
    "session/resume",
    "session/set_config_option",
    "session/prompt",
  ]);
  assert.equal(received[1].params.sessionId, "s-old");
  // The resumed session was on "opus"; no model chosen means its recorded default.
  assert.equal(received[2].params.value, "default");
  assert.deepEqual(out.sessionIds, ["s-old"]);
  assert.deepEqual(out.defaults, [], "only a fresh session reports its default");
});

test("session/load replays history that ADE already has: it is not shown again", async () => {
  const { out, received } = await turn({ FAKE_ACP_LOAD: "1" }, { resumeId: "s-old" });
  assert.ok(methods(received).includes("session/load"));
  assert.ok(!out.texts.join("").includes("OLD"));
  assert.deepEqual(out.texts, ["Hello", "\n\nDone."]);
});

test("a conversation that cannot be reopened starts fresh and says so", async () => {
  const { out, received } = await turn({ FAKE_ACP_RESUME: "1" }, { resumeId: "gone" });
  assert.deepEqual(methods(received).slice(0, 3), ["initialize", "session/resume", "session/new"]);
  assert.match(out.notices[0], /could not reopen its earlier conversation/);
  assert.deepEqual(out.sessionIds, ["s-new"]);
});

test("an agent without resume or load starts fresh and discloses it", async () => {
  const { out, received } = await turn({}, { resumeId: "s-old" });
  assert.ok(methods(received).includes("session/new"));
  assert.match(out.notices[0], /cannot reopen an earlier conversation/);
});

test("a permission request waits for the user's choice and passes it back", async () => {
  const { out } = await turn(
    { FAKE_ACP_SCENARIO: "permission" },
    {},
    {
      permission: async (request) => {
        assert.equal(request.title, "rm -rf build");
        assert.equal(request.kind, "execute");
        assert.equal(request.detail, "rm -rf build");
        assert.deepEqual(
          request.options.map((o) => o.kind),
          ["allow_once", "allow_always", "reject_once"],
        );
        return { outcome: "selected", optionId: "a1" };
      },
    },
  );
  assert.deepEqual(out.texts, ['answer:{"outcome":"selected","optionId":"a1"}']);
});

test("an answer naming an option the agent did not offer is sent as cancelled", async () => {
  const { out } = await turn(
    { FAKE_ACP_SCENARIO: "permission" },
    {},
    { permission: async () => ({ outcome: "selected", optionId: "invented" }) },
  );
  assert.deepEqual(out.texts, ['answer:{"outcome":"cancelled"}']);
});

test("Plan declines edits itself without asking, and selects the agent's plan mode", async () => {
  const { out, received } = await turn(
    { FAKE_ACP_SCENARIO: "edit-permission" },
    { permission: "plan" },
  );
  assert.equal(out.asked.length, 0);
  assert.deepEqual(out.texts, ['answer:{"outcome":"selected","optionId":"r1"}']);
  assert.match(out.notices[0], /declined because this session is in Plan/);
  assert.equal(received.find((m) => m.method === "session/set_mode").params.modeId, "plan");
});

test("a declined plan exit hands the plan back as the agent's message", async () => {
  const { result, out } = await turn({ FAKE_ACP_SCENARIO: "exit-plan" }, { permission: "plan" });
  assert.deepEqual(result, { stopReason: "cancelled", declinedModeSwitch: true });
  assert.equal(out.asked.length, 0);
  assert.deepEqual(out.texts, ["I have a plan.", "\n\n1. Add hello.txt\n2. Write hi"]);
  assert.match(out.notices[0], /asked to leave plan mode/);
});

test("Plan declines shell commands too", async () => {
  const declined = await turn({ FAKE_ACP_SCENARIO: "permission" }, { permission: "plan" });
  assert.equal(declined.out.asked.length, 0);
  assert.match(declined.out.notices[0], /asked to run a command \(rm -rf build\)/);
});

test("a chosen model is applied through the agent's model option", async () => {
  const { received } = await turn({}, { model: "opus" });
  const set = received.find((m) => m.method === "session/set_config_option");
  assert.deepEqual(set.params, { sessionId: "s-new", configId: "model", value: "opus" });
});

test("a model the agent does not offer fails the turn and lists what it offers", async () => {
  await assert.rejects(turn({}, { model: "gpt-9" }), (error) => {
    assert.match(
      error.message,
      /"gpt-9" is not available in Fake Agent\. It offers: default, opus\./,
    );
    assert.equal(classifyFailure([error.message]), "model_not_found");
    assert.ok(!methods(error.received).includes("session/prompt"));
    return true;
  });
});

test("ACP's authentication error is worded for the auth recovery card", async () => {
  await assert.rejects(turn({ FAKE_ACP_AUTH: "1" }), (error) => {
    assert.match(error.message, /^Authentication required: /);
    assert.equal(classifyFailure([error.message]), "auth_expired");
    return true;
  });
});

test("an agent that exits mid-turn rejects with its exit status", async () => {
  await assert.rejects(turn({ FAKE_ACP_SCENARIO: "crash" }), /exited \(code 3\) before finishing/);
});

test("an unsupported protocol version is refused before any session opens", async () => {
  await assert.rejects(turn({ FAKE_ACP_PROTOCOL: "2" }), (error) => {
    assert.match(error.message, /speaks ACP protocol version 2; ADE supports version 1/);
    assert.deepEqual(methods(error.received), ["initialize"]);
    return true;
  });
});

test("requests ADE did not advertise get Method not found", async () => {
  const { out } = await turn({ FAKE_ACP_SCENARIO: "fs" });
  assert.deepEqual(out.texts, ["fs:-32601"]);
});

test("images go as image blocks when the agent accepts them", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-acp-img-"));
  const png = path.join(dir, "shot.png");
  writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  try {
    const { out, received } = await turn(
      { FAKE_ACP_SCENARIO: "blocks" },
      { images: [{ path: png, mime: "image/png" }] },
    );
    assert.deepEqual(out.texts, ["blocks:text,image"]);
    const block = received.find((m) => m.method === "session/prompt").params.prompt[1];
    assert.deepEqual(block, { type: "image", mimeType: "image/png", data: "iVBORw==" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stop reasons pass through for ADE to judge", async () => {
  const { result } = await turn({ FAKE_ACP_SCENARIO: "refusal" });
  assert.deepEqual(result, { stopReason: "refusal" });
});

test("rpc: answers requests, reports errors, and sets aside lines that are not JSON-RPC", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const written = [];
  output.on("data", (data) =>
    written.push(
      ...String(data)
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l)),
    ),
  );
  const invalid = [];
  const rpc = createRpc(input, output, {
    onRequest: async (method) => {
      if (method === "boom") throw Object.assign(new Error("nope"), { code: -32099 });
      return { ok: true };
    },
    onNotification: () => {},
    onInvalid: (line) => invalid.push(line),
  });
  input.write('{"jsonrpc":"2.0","id":7,"method":"ping"}\nnot json\n');
  input.write('{"jsonrpc":"2.0","id":8,"method":"boom"}\n');
  const pending = rpc.request("initialize", {});
  input.write(
    '{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"Authentication required"}}\n',
  );
  await assert.rejects(pending, (error) => error.code === -32000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(invalid, ["not json"]);
  assert.deepEqual(
    written.find((m) => m.id === 7),
    { jsonrpc: "2.0", id: 7, result: { ok: true } },
  );
  assert.deepEqual(written.find((m) => m.id === 8).error, { code: -32099, message: "nope" });
  rpc.close(new Error("gone"));
  await assert.rejects(rpc.request("later", {}), /gone/);
});

test("tool names come from structured fields, never the free-text title", () => {
  assert.equal(
    toolNameOf({ name: "mcp__ade_computer__browser_click", title: "x" }),
    "browser_click",
  );
  assert.equal(
    toolNameOf({ _meta: { claudeCode: { toolName: "Bash" } }, title: "npm test" }),
    "Bash",
  );
  assert.equal(toolNameOf({ kind: "execute", title: "mcp__ade_computer__browser_click" }), "bash");
  assert.deepEqual(
    selectValues({ options: [{ value: "a" }, { group: "g", options: [{ value: "b" }] }, {}] }).map(
      (v) => v.value,
    ),
    ["a", "b"],
  );
});
