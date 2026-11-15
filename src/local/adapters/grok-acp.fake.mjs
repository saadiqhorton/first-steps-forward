// Minimal Grok-shaped ACP subprocess. Used only by grok.acp.test.mjs.
import readline from "node:readline";
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let authenticated = false;
const models = { currentModelId: "grok-a", availableModels: [
  { modelId: "grok-a", name: "Grok A", _meta: { reasoningEfforts: [{ value: "low", default: true }] } },
  { modelId: "grok-b", name: "Grok B", _meta: { reasoningEfforts: [{ value: "high", default: true }] } },
] };
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  if (id == null) return;
  let result = {};
  if (method === "initialize") result = { protocolVersion: 1, agentCapabilities: {}, authMethods: [{ id: "cached_token" }] };
  else if (method === "authenticate") {
    if (params.methodId !== "cached_token" || !params._meta?.headless) return send({ jsonrpc: "2.0", id, error: { code: -32602, message: "invalid auth" } });
    authenticated = true;
  } else if (method === "session/new") {
    if (!authenticated) return send({ jsonrpc: "2.0", id, error: { code: -32000, message: "Authentication required" } });
    result = { sessionId: "grok-session", models };
  } else if (method === "session/set_mode") {
    if (params.modeId !== "plan" || process.env.FAIL_MODE) return send({ jsonrpc: "2.0", id, error: { code: -32602, message: "mode rejected" } });
  } else if (method === "session/set_model") {
    if (params.modelId !== "grok-b" || params._meta?.reasoningEffort !== "high") return send({ jsonrpc: "2.0", id, error: { code: -32602, message: "invalid model or effort" } });
  } else if (method === "session/prompt") result = { stopReason: "end_turn" };
  else return send({ jsonrpc: "2.0", id, error: { code: -32601, message: "unknown method" } });
  process.stderr.write(`${method}\n`);
  send({ jsonrpc: "2.0", id, result });
});
