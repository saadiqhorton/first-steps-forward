import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRpc, listAcpModels, runAcpTurn, selectValues, toolNameOf } from "./acp.mjs";
import { classifyFailure } from "./classify.mjs";
import { currentActivity, formatSessionLogs } from "../lib/ade/formatLogs.mjs";
import { groupActivityTurns } from "../lib/ade/activityTurns.mjs";

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

test("ACP discovery reports each model's own effort levels", async () => {
  const child = spawn(process.execPath, [FAKE], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, FAKE_ACP_EFFORT: "1" },
  });
  try {
    const rows = await listAcpModels({ child, name: "Fake", cwd: os.tmpdir() });
    assert.deepEqual(
      rows.map(({ id, efforts }) => ({ id, efforts })),
      [
        { id: "default", efforts: ["low"] },
        { id: "opus", efforts: ["high"] },
      ],
    );
  } finally {
    child.stdin.end();
    await new Promise((resolve) => child.once("close", resolve));
  }
});

test("ACP applies effort after model switch and rejects unavailable effort", async () => {
  const { received } = await turn({ FAKE_ACP_EFFORT: "1" }, { model: "opus", effort: "high" });
  const options = received
    .filter((m) => m.method === "session/set_config_option")
    .map((m) => m.params);
  assert.deepEqual(
    options.map(({ configId, value }) => [configId, value]),
    [
      ["model", "opus"],
      ["effort", "high"],
    ],
  );
  await assert.rejects(
    () => turn({ FAKE_ACP_EFFORT: "1" }, { model: "opus", effort: "low" }),
    /selected effort.*not available/,
  );
});

test("ACP applies selected advertised permission mode and fails closed when unavailable", async () => {
  const modes = { manual: ["default"], build: ["acceptEdits"], plan: ["plan"], auto: ["auto"] };
  const { received } = await turn({ FAKE_ACP_AUTO: "1" }, { permission: "auto", modes });
  assert.equal(received.find((m) => m.method === "session/set_mode").params.modeId, "auto");
  await assert.rejects(
    () => turn({}, { permission: "auto", modes }),
    /does not currently offer.*auto/,
  );
});

test("opt-in ACP authentication runs before the session and never selects an unoffered method", async () => {
  const acpAuth = {
    methods: ["xai.api_key", "cached_token"],
    meta: { headless: true },
    missingMessage: "Sign in first",
  };
  const { received } = await turn({ FAKE_ACP_HEADLESS_AUTH: "1" }, { acpAuth });
  assert.deepEqual(methods(received).slice(0, 3), ["initialize", "authenticate", "session/new"]);
  assert.deepEqual(received[1].params, { methodId: "cached_token", _meta: { headless: true } });
  await assert.rejects(() => turn({}, { acpAuth }), /Sign in first/);
});

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
  assert.deepEqual(toolLine, {
    type: "tool_call",
    callId: "t1",
    toolName: "Read",
    kind: "read",
    title: "Read a.ts",
    input: { path: "/p/a.ts" },
  });
  assert.ok(
    out.logs.every((line) => line.length < 600),
    "file contents never reach the log",
  );
  const resultLine = out.logs.map((l) => JSON.parse(l)).find((e) => e.type === "tool_result");
  assert.deepEqual(resultLine, {
    type: "tool_result",
    callId: "t1",
    toolName: "Read",
    kind: "read",
  });
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

test("Don't ask declines every request instead of showing it", async () => {
  const declined = await turn(
    { FAKE_ACP_SCENARIO: "permission" },
    { permission: "dont-ask", modes: { "dont-ask": ["default"] } },
  );
  assert.equal(declined.out.asked.length, 0);
  assert.deepEqual(declined.out.texts, ['answer:{"outcome":"selected","optionId":"r1"}']);
  assert.match(declined.out.notices[0], /set to Don't ask/);
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

/** The tool lines of a turn, parsed. */
function toolLogs(out) {
  const events = out.logs.map((line) => JSON.parse(line));
  const calls = events.filter((event) => event.type === "tool_call");
  const results = events.filter((event) => event.type === "tool_result");
  /** The one result of a call; a call with two would fail here. */
  const resultOf = (callId) => {
    const found = results.filter((event) => event.callId === callId);
    assert.ok(found.length <= 1, `${callId} has ${found.length} results`);
    return found[0];
  };
  return { events, calls, results, resultOf };
}

test("tool lines carry the call id, kind and title, and a refined call is logged again", async () => {
  const { out } = await turn({ FAKE_ACP_SCENARIO: "tools" });
  const { calls } = toolLogs(out);
  assert.deepEqual(
    calls.filter((call) => call.callId === "read1"),
    [
      {
        type: "tool_call",
        callId: "read1",
        toolName: "read",
        kind: "read",
        title: "Read File",
        input: {},
      },
      {
        type: "tool_call",
        callId: "read1",
        toolName: "read",
        kind: "read",
        title: "Read src/a.ts",
        input: { path: "/p/src/a.ts" },
      },
    ],
  );
  // The command shows up once its input has streamed in, under the name the call started with.
  const run = calls.filter((call) => call.callId === "run1");
  assert.equal(run.length, 2);
  assert.deepEqual(run[1].input, { command: "npm test" });
  assert.equal(run[1].toolName, run[0].toolName);
  assert.equal(run[1].title, "npm test");
});

test("a read logs how many lines it read, never the text, and a repeated result once", async () => {
  const { out } = await turn({ FAKE_ACP_SCENARIO: "tools" });
  const { resultOf } = toolLogs(out);
  // The agent sent the completed status twice; the result is logged once.
  assert.deepEqual(resultOf("read1"), {
    type: "tool_result",
    callId: "read1",
    toolName: "read",
    kind: "read",
    summary: "95 lines",
  });
  const log = out.logs.join("\n");
  for (const secret of ["TOP-SECRET", "OLD-SECRET", "NEW-SECRET", "keep 3"])
    assert.ok(!log.includes(secret), `${secret} stays out of the log`);
});

test("an edit logs changed line counts from its diff, never the diff", async () => {
  const { out } = await turn({ FAKE_ACP_SCENARIO: "tools" });
  const { resultOf } = toolLogs(out);
  // Two lines change among unchanged ones and one is added: +3 -2, not the whole hunk.
  assert.deepEqual(resultOf("edit1"), {
    type: "tool_result",
    callId: "edit1",
    toolName: "edit",
    kind: "edit",
    additions: 3,
    deletions: 2,
    files: ["/p/src/a.ts"],
  });
});

test("a call that arrives completed logs its call and then its result; a new file is all additions", async () => {
  const { out } = await turn({ FAKE_ACP_SCENARIO: "tools" });
  const { events, resultOf } = toolLogs(out);
  const at = (type, callId) =>
    events.findIndex((event) => event.type === type && event.callId === callId);
  assert.ok(at("tool_call", "write1") >= 0);
  assert.ok(at("tool_call", "write1") < at("tool_result", "write1"));
  assert.deepEqual(resultOf("write1"), {
    type: "tool_result",
    callId: "write1",
    toolName: "edit",
    kind: "edit",
    additions: 3,
    deletions: 0,
    files: ["/p/src/new.ts"],
  });
});

test("a command logs its last line of output, and a failed one the reason it failed", async () => {
  const { out } = await turn({ FAKE_ACP_SCENARIO: "tools" });
  const { resultOf } = toolLogs(out);
  assert.equal(resultOf("run1").summary, "Tests 12 passed");
  assert.equal(resultOf("run1").isError, undefined);
  assert.deepEqual(resultOf("run2"), {
    type: "tool_result",
    callId: "run2",
    toolName: "bash",
    kind: "execute",
    isError: true,
    summary: "Exit code 1: cat: missing.txt: No such file or directory",
  });
});

test("an update for a call never announced is logged as a call with its result", async () => {
  const { out } = await turn({ FAKE_ACP_SCENARIO: "tools" });
  const { calls, resultOf } = toolLogs(out);
  assert.deepEqual(
    calls.find((call) => call.callId === "ghost1"),
    { type: "tool_call", callId: "ghost1", toolName: "tool", input: {} },
  );
  assert.deepEqual(resultOf("ghost1"), {
    type: "tool_result",
    callId: "ghost1",
    toolName: "tool",
    isError: true,
    summary: "Tool use aborted",
  });
});

test("every call in a turn gets exactly one result, with the call's kind", async () => {
  const { out } = await turn({ FAKE_ACP_SCENARIO: "tools" });
  const { calls, results } = toolLogs(out);
  const ids = [...new Set(calls.map((call) => call.callId))];
  assert.deepEqual(ids, ["read1", "edit1", "write1", "run1", "run2", "ghost1", "find1", "mode1"]);
  assert.deepEqual(
    results.map((result) => result.callId),
    ["read1", "edit1", "write1", "run1", "run2", "ghost1", "find1", "mode1"],
  );
  assert.equal(results.find((result) => result.callId === "find1").kind, "search");
  assert.equal(results.find((result) => result.callId === "mode1").kind, "switch_mode");
  assert.ok(out.logs.every((line) => line.length < 1000));
  // Text runs around the tools still read as separate messages.
  assert.deepEqual(out.texts, ["All done."]);
});

test("a Write over an existing file is not logged as all additions, whichever order Claude reports it in", async () => {
  const { out } = await turn({ FAKE_ACP_SCENARIO: "claude-writes" });
  const { events, results } = toolLogs(out);
  const of = (callId) => results.filter((event) => event.callId === callId);
  const counts = (event) => [event.additions, event.deletions];
  // The result comes first, with no counts: the diff it has says "new file" for every Write.
  // The real diff arrives after, and corrects it (one line changed among the context).
  const [first, fix, ...extra] = of("over1");
  assert.deepEqual(extra, []);
  assert.deepEqual(counts(first), [undefined, undefined]);
  assert.deepEqual(first.files, ["/p/src/a.ts"]);
  assert.equal(first.amends, undefined);
  assert.equal(fix.amends, true);
  assert.deepEqual(counts(fix), [1, 1]);
  // The real diff before the result: one result, right the first time.
  assert.deepEqual(of("over2").map(counts), [[2, 1]]);
  assert.equal(of("over2")[0].amends, undefined);
  // A new file is told by the report (type "create"), which has no diff to correct it with.
  const [made, madeFix] = of("new1");
  assert.deepEqual(counts(made), [undefined, undefined]);
  assert.deepEqual([madeFix.amends, ...counts(madeFix)], [true, 3, 0]);
  assert.deepEqual(of("new2").map(counts), [[2, 0]]);
  // A Write whose report never came claims nothing about its size.
  assert.deepEqual(of("lost1").map(counts), [[undefined, undefined]]);
  assert.deepEqual(of("lost1")[0].files, ["/p/src/lost.ts"]);
  // An Edit's snippet is right for one site and the report agrees, so there is nothing to fix;
  // for replace_all the snippet shows one of three sites and the report corrects it.
  assert.deepEqual(of("edit1").map(counts), [[1, 1]]);
  assert.deepEqual(of("edit2").map(counts), [
    [1, 1],
    [3, 3],
  ]);
  assert.equal(of("edit2")[1].amends, true);
  // No result ever claimed the 40 lines the Write's first diff held.
  assert.ok(results.every((event) => (event.additions ?? 0) < 40));
  // The correction comes after its result in the log, and no file text is in it.
  const at = (callId, amends) =>
    events.findIndex(
      (event) =>
        event.callId === callId && event.type === "tool_result" && !!event.amends === amends,
    );
  assert.ok(at("over1", false) < at("over1", true));
  const log = out.logs.join("\n");
  assert.doesNotMatch(log, /changed 10|line 11|"one"|two/);
  assert.ok(out.logs.every((line) => line.length < 1000));
});

test("a corrected result reads as one step with the right counts, and says nothing new live", async () => {
  const { out } = await turn({ FAKE_ACP_SCENARIO: "claude-writes" });
  const logs = ["Context manifest: 1 candidate file, tools: Claude Code tools", ...out.logs];
  const [turn_] = groupActivityTurns(formatSessionLogs(logs));
  assert.equal(turn_.items.filter((item) => item.kind === "result").length, 0);
  assert.deepEqual(
    turn_.items.map(({ detail, additions, deletions }) => [detail, additions, deletions]),
    [
      ["src/a.ts", 1, 1],
      ["src/b.ts", 2, 1],
      ["src/new.ts", 3, 0],
      ["src/new2.ts", 2, 0],
      ["src/lost.ts", undefined, undefined],
      ["src/c.ts", 1, 1],
      ["src/d.ts", 3, 3],
    ],
  );
  // The correction is a line like any other, but the status line ignores it.
  const lastFix = logs.findLastIndex((line) => line.includes('"amends":true'));
  assert.ok(lastFix > 0);
  assert.equal(
    currentActivity(logs.slice(0, lastFix + 1)),
    currentActivity(logs.slice(0, lastFix)),
  );
});

test("updates no agent should send do not break a turn, and cost the log little", async () => {
  const { result, out } = await turn({ FAKE_ACP_SCENARIO: "malformed" });
  assert.equal(result.stopReason, "end_turn");
  const events = out.logs.filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
  // Nothing needed the safety net: every shape was read as it came.
  assert.ok(!out.logs.some((line) => line.includes("could not read")), "an update was skipped");
  // A normal call after all of it is logged in full.
  const fine = events.filter((event) => event.callId === "fine");
  assert.deepEqual(
    fine.map((event) => [event.type, event.summary]),
    [
      ["tool_call", undefined],
      ["tool_result", "2 lines"],
    ],
  );
  assert.deepEqual(out.texts, ["Still here."]);
  // A command typed out character by character is a few lines, the last of them complete.
  const typed = events.filter((event) => event.callId === "typed");
  assert.ok(typed.length <= 8, `${typed.length} lines for one call`);
  assert.equal(typed.filter((event) => event.type === "tool_result").length, 1);
  assert.equal(
    typed.filter((event) => event.type === "tool_call").at(-1).input.command.length,
    250,
  );
  // Calls with no id cannot be told apart, so a turn only gets so many of them.
  assert.ok(events.filter((event) => !event.callId).length <= 120);
  // Nothing from a huge string reached the log, and each line is within what a log keeps.
  assert.ok(out.logs.every((line) => line.length < 4096));
  assert.ok(out.logs.length < 700, `${out.logs.length} lines`);
  assert.doesNotMatch(out.logs.join("\n"), /x{300}/);
});

test("a logging failure while reading one update is skipped and the turn goes on", async () => {
  let failed = false;
  const logs = [];
  const { result, out } = await turn(
    { FAKE_ACP_SCENARIO: "text" },
    {},
    {
      log(line) {
        if (!failed && line.includes('"type":"tool_call"')) {
          failed = true;
          throw new Error("disk full");
        }
        logs.push(line);
      },
    },
  );
  assert.equal(result.stopReason, "end_turn");
  assert.ok(failed);
  assert.deepEqual(out.texts, ["Hello", "\n\nDone."]);
  assert.equal(logs.filter((line) => line.includes("could not read")).length, 1);
});
