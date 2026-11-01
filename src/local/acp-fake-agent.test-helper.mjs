#!/usr/bin/env node
// Scripted ACP agent for acp.test.mjs and ade-local.acp.test.mjs (not shipped
// behaviour). Environment: FAKE_ACP_SCENARIO picks what session/prompt does;
// FAKE_ACP_LOG appends every message received, one JSON per line;
// FAKE_ACP_PROTOCOL, FAKE_ACP_LOAD=1, FAKE_ACP_RESUME=1 and FAKE_ACP_AUTH=1
// shape the handshake. It also answers `--version` and `auth status`, so it
// can stand in for `claude` on PATH as well.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("0.99.0");
  process.exit(0);
}
if (args[0] === "--cli" || args[0] === "auth") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }));
  process.exit(0);
}

const env = process.env;
const scenario = env.FAKE_ACP_SCENARIO ?? "text";
// Which Claude Code the bridge was told to run (a line with no method).
if (env.FAKE_ACP_LOG)
  appendFileSync(
    env.FAKE_ACP_LOG,
    `${JSON.stringify({ startup: { CLAUDE_CODE_EXECUTABLE: env.CLAUDE_CODE_EXECUTABLE ?? null } })}\n`,
  );
const send = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const update = (sessionId, body) =>
  send({ method: "session/update", params: { sessionId, update: body } });
const chunk = (sessionId, text) =>
  update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
let nextId = 1000;
const waiting = new Map();
// The helper is spawned detached, so if the test runner dies mid-request the
// reply never comes and this helper would wait forever. Give up then: when
// re-parented, or after a minute with no reply.
const parent = process.ppid;
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    send({ id, method, params });
    const started = Date.now();
    const watch = setInterval(() => {
      if (!waiting.has(id)) {
        clearInterval(watch);
        return;
      }
      if (process.ppid !== parent || Date.now() - started > 60_000) process.exit(3);
    }, 1000);
  });
const modes = (currentModeId) => ({
  currentModeId,
  availableModes: [
    { id: "default", name: "Default" },
    { id: "acceptEdits", name: "Accept edits" },
    { id: "plan", name: "Plan" },
  ],
});
const models = (currentValue) => [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue,
    options: [
      { value: "default", name: "Default" },
      { value: "opus", name: "Opus", description: "Most capable" },
    ],
  },
];

async function prompt(sessionId, params) {
  switch (scenario) {
    case "text":
      chunk(sessionId, "Hel");
      chunk(sessionId, "lo");
      update(sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "Read a.ts",
        kind: "read",
        status: "pending",
        rawInput: { file_path: "/p/a.ts", content: "x".repeat(5000) },
        _meta: { claudeCode: { toolName: "Read" } },
      });
      update(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
      });
      update(sessionId, {
        sessionUpdate: "plan",
        entries: [{ content: "Check the readme", priority: "high", status: "in_progress" }],
      });
      chunk("another-session", "LEAK");
      chunk(sessionId, "Done.");
      return { stopReason: "end_turn" };
    case "permission":
    case "edit-permission": {
      const shell = scenario === "permission";
      const answer = await ask("session/request_permission", {
        sessionId,
        toolCall: {
          toolCallId: "t2",
          title: shell ? "rm -rf build" : "Edit a.ts",
          kind: shell ? "execute" : "edit",
          rawInput: shell ? { command: "rm -rf build" } : { file_path: "/p/a.ts" },
        },
        options: [
          { optionId: "a1", name: "Allow", kind: "allow_once" },
          { optionId: "a2", name: "Always allow", kind: "allow_always" },
          { optionId: "r1", name: "Reject", kind: "reject_once" },
        ],
      });
      chunk(sessionId, `answer:${JSON.stringify(answer.result?.outcome ?? answer.error)}`);
      return { stopReason: "end_turn" };
    }
    case "fs": {
      const answer = await ask("fs/read_text_file", { sessionId, path: "/etc/hostname" });
      chunk(sessionId, `fs:${answer.error?.code}`);
      return { stopReason: "end_turn" };
    }
    case "blocks":
      chunk(sessionId, `blocks:${params.prompt.map((block) => block.type).join(",")}`);
      return { stopReason: "end_turn" };
    case "exit-plan": {
      // Like Claude Code: the plan rides in ExitPlanMode's input, and a
      // rejection interrupts the turn, which then ends "cancelled".
      chunk(sessionId, "I have a plan.");
      const answer = await ask("session/request_permission", {
        sessionId,
        toolCall: {
          toolCallId: "t3",
          title: "Ready to code?",
          kind: "switch_mode",
          rawInput: { plan: "1. Add hello.txt\n2. Write hi" },
        },
        options: [
          { optionId: "acceptEdits", name: "Yes, and auto-accept edits", kind: "allow_always" },
          { optionId: "default", name: "Yes, and manually approve edits", kind: "allow_once" },
          { optionId: "reject", name: "No, keep planning", kind: "reject_once" },
        ],
      });
      return {
        stopReason: answer.result?.outcome?.optionId === "reject" ? "cancelled" : "end_turn",
      };
    }
    case "refusal":
      return { stopReason: "refusal" };
    case "crash":
      process.exit(3);
      break;
    default:
      return { stopReason: "end_turn" };
  }
}

async function handle(message) {
  if (env.FAKE_ACP_LOG) appendFileSync(env.FAKE_ACP_LOG, `${JSON.stringify(message)}\n`);
  if (message.method === undefined) {
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
    return;
  }
  const { id, method, params } = message;
  const reply = (result) => send({ id, result });
  const fail = (code, text) => send({ id, error: { code, message: text } });
  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: Number(env.FAKE_ACP_PROTOCOL ?? 1),
        agentCapabilities: {
          loadSession: env.FAKE_ACP_LOAD === "1",
          promptCapabilities: { image: true },
          sessionCapabilities: env.FAKE_ACP_RESUME === "1" ? { resume: {} } : {},
        },
        authMethods: [],
      });
    case "session/new":
      if (env.FAKE_ACP_AUTH === "1") return fail(-32000, "Authentication required");
      return reply({
        sessionId: "s-new",
        modes: modes("default"),
        configOptions: models("default"),
      });
    case "session/resume":
      if (params.sessionId === "gone") return fail(-32002, "Resource not found");
      return reply({ modes: modes("acceptEdits"), configOptions: models("opus") });
    case "session/load":
      update(params.sessionId, {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "OLD PROMPT" },
      });
      chunk(params.sessionId, "OLD REPLY");
      return reply({ modes: modes("default"), configOptions: models("default") });
    case "session/set_mode":
    case "session/set_config_option":
      return reply({});
    case "session/prompt":
      return reply(await prompt(params.sessionId, params));
    default:
      return fail(-32601, `Method not found: ${method}`);
  }
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (line.trim()) void handle(JSON.parse(line));
});
lines.on("close", () => process.exit(0));
