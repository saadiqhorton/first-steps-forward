#!/usr/bin/env node
// Scripted stand-in for the JSON-lines agent CLIs (`codex`, `opencode`, `pi`)
// in tests; not shipped behaviour. A PATH shim runs it as
// `node cli-fake-agent.test-helper.mjs <agent> ...args`.
//
// Environment:
// - FAKE_CLI_LOG: append every invocation ({ agent, args, cwd, adeApi }) as one JSON line.
// - FAKE_CLI_SCENARIO: what a turn does (default "text"):
//   text            reply "Done." and exit 0
//   gate            reply "Working.", wait until the file FAKE_CLI_GATE exists, then
//                   reply "Done." and exit 0 (a turn the test ends on purpose)
//   quota           print a rate-limit error on stderr and exit 1
//   crash           print a generic error on stderr and exit 2
//   settled-error   Pi only: report a settled provider error but exit 0
//   silent          exit 0 without any output
//   silent-error    exit 0 with only a model error on stderr (OpenCode's habit)
//   permission      OpenCode only: auto-reject a permission on stderr, then reply
// - FAKE_CLI_REPLY: the final reply text instead of "Done.".
import { appendFileSync, existsSync } from "node:fs";

const [agent, ...args] = process.argv.slice(2);
const env = process.env;
if (env.FAKE_CLI_LOG)
  appendFileSync(
    env.FAKE_CLI_LOG,
    `${JSON.stringify({ agent, args, cwd: process.cwd(), adeApi: env.ADE_API ?? null })}\n`,
  );
const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const has = (...words) => words.every((word) => args.includes(word));

if (args.includes("--version")) {
  console.log({ codex: "codex-cli 0.158.0", opencode: "1.14.2", pi: "0.71.0" }[agent] ?? "1.0.0");
  process.exit(0);
}

// Sign-in status, the way each CLI reports it.
if (agent === "codex" && has("login", "status")) {
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
if (agent === "opencode" && has("auth", "list")) {
  console.log("● OpenAI oauth\n\n1 credentials");
  process.exit(0);
}
if (agent === "pi" && has("auth", "check")) {
  const provider = args[args.indexOf("--provider") + 1];
  console.log(JSON.stringify({ status: provider === "anthropic" ? "ready" : "missing" }));
  process.exit(0);
}

// Model listings.
if (agent === "codex" && has("debug", "models")) {
  console.log(
    JSON.stringify({
      models: [
        {
          slug: "gpt-5.5",
          display_name: "GPT-5.5",
          visibility: "list",
          priority: 1,
          supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
          default_reasoning_level: "low",
          additional_speed_tiers: ["fast"],
        },
        { slug: "gpt-5.5-mini", visibility: "list", priority: 2 },
      ],
    }),
  );
  process.exit(0);
}
if (agent === "opencode" && args[0] === "models") {
  if (args.includes("--verbose"))
    console.log('openai/gpt-5\n{\n  "variants": { "high": {} }\n}\nopenai/gpt-5-mini\n{}');
  else console.log("openai/gpt-5\nopenai/gpt-5-mini");
  process.exit(0);
}
if (agent === "pi" && args.includes("--list-models")) {
  console.log("provider   model      context  max-out  thinking  images");
  console.log("anthropic  sonnet-5   200K     64K      yes       yes");
  process.exit(0);
}

// A turn.
const scenario = env.FAKE_CLI_SCENARIO ?? "text";
const reply = env.FAKE_CLI_REPLY ?? "Done.";
const say = (text) => {
  if (agent === "codex") out({ type: "item.completed", item: { type: "agent_message", text } });
  else if (agent === "opencode") out({ type: "text", sessionID: "oc-1", part: { text } });
  else
    out({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text }] },
    });
};
const begin = () => {
  if (agent === "codex") out({ type: "thread.started", thread_id: "thread-1" });
  if (agent === "opencode") out({ type: "step_start", sessionID: "oc-1" });
};
const end = () => {
  if (agent === "pi") out({ type: "agent_end", willRetry: false, messages: [] });
};

begin();
if (scenario === "quota") {
  process.stderr.write("Error: 429 rate limit exceeded. Please try again in 20s.\n");
  process.exit(1);
}
if (scenario === "crash") {
  process.stderr.write("Error: socket hang up\n");
  process.exit(2);
}
if (scenario === "silent") process.exit(0);
if (scenario === "silent-error") {
  process.stderr.write("ProviderModelNotFoundError: Model not found: openai/nope\n");
  process.exit(0);
}
if (scenario === "settled-error") {
  out({
    type: "agent_end",
    willRetry: false,
    messages: [{ role: "assistant", stopReason: "error", errorMessage: "Provider overloaded" }],
  });
  process.exit(0);
}
if (scenario === "permission")
  process.stderr.write("permission requested: bash (rm -rf build); auto-rejecting\n");
if (scenario === "gate") {
  say("Working.");
  // The CLI is spawned detached, so when the test runner dies mid-file this
  // helper is re-parented and would wait forever. Give up then, and after a
  // minute even with the runner alive.
  const parent = process.ppid;
  const started = Date.now();
  const timer = setInterval(() => {
    if (env.FAKE_CLI_GATE && existsSync(env.FAKE_CLI_GATE)) {
      clearInterval(timer);
      say(reply);
      end();
      process.exit(0);
    }
    if (process.ppid !== parent || Date.now() - started > 60_000) process.exit(3);
  }, 20);
} else {
  say(reply);
  end();
  process.exit(0);
}
