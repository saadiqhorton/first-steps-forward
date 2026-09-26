import test from "node:test";
import assert from "node:assert/strict";
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

test("Pi adapter disables extensions and shell tools and parses actual JSON events", () => {
  const [bin, args] = pi.command({
    prompt: "Inspect",
    session,
    continuing: false,
    dataDir: "/tmp/ade",
  });
  assert.equal(bin, "pi");
  assert.ok(args.includes("--no-extensions"));
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
