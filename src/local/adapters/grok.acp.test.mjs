import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runAcpTurn, listAcpModels } from "../acp.mjs";

const fake = fileURLToPath(new URL("./grok-acp.fake.mjs", import.meta.url));
const auth = { methods: ["xai.api_key", "cached_token"], meta: { headless: true } };
function child(extra = {}) {
  return spawn(process.execPath, [fake], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...extra } });
}
async function finish(proc) {
  proc.stdin.end();
  await new Promise((resolve) => proc.once("close", resolve));
}
test("Grok ACP discovers model-specific efforts and sends auth, plan, model and effort", async () => {
  const proc = child();
  const methods = [];
  proc.stderr.on("data", (data) => methods.push(...String(data).trim().split("\n")));
  const rows = [];
  try {
    await runAcpTurn({ child: proc, name: "Grok", cwd: process.cwd(), prompt: "Plan", acpAuth: auth,
      permission: "plan", modes: { plan: ["plan"] }, unadvertisedModes: true, model: "grok-b", effort: "high",
      on: { sessionId() {}, text() {}, log() {}, notice() {}, permission: async () => ({ outcome: "cancelled" }), models: (value) => rows.push(...value) } });
  } finally { await finish(proc); }
  assert.deepEqual(methods, ["initialize", "authenticate", "session/new", "session/set_mode", "session/set_model", "session/prompt"]);
  assert.deepEqual(rows.map(({ id, efforts }) => [id, efforts]), [["grok-a", ["low"]], ["grok-b", ["high"]]]);
  const probe = child();
  try {
    const discovered = await listAcpModels({ child: probe, name: "Grok", cwd: process.cwd(), acpAuth: auth });
    assert.deepEqual(discovered.map(({ id, efforts }) => [id, efforts]), [["grok-a", ["low"]], ["grok-b", ["high"]]]);
  } finally { await finish(probe); }
});

test("Grok ACP stops before prompting when plan mode is rejected", async () => {
  const proc = child({ FAIL_MODE: "1" });
  const methods = [];
  proc.stderr.on("data", (data) => methods.push(...String(data).trim().split("\n")));
  try {
    await assert.rejects(runAcpTurn({ child: proc, name: "Grok", cwd: process.cwd(), prompt: "Plan", acpAuth: auth,
      permission: "plan", modes: { plan: ["plan"] }, unadvertisedModes: true,
      on: { sessionId() {}, text() {}, log() {}, notice() {}, permission: async () => ({ outcome: "cancelled" }) } }), /mode rejected/);
  } finally { await finish(proc); }
  assert.ok(!methods.includes("session/prompt"));
});
