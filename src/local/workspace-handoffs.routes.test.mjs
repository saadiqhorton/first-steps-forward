import test from "node:test";
import assert from "node:assert/strict";
import { workspaceHandoffs } from "./routes/workspaceHandoffs.mjs";

function context(overrides = {}) {
  const calls = [];
  const handoffs = {
    dispatch: async (input) => {
      calls.push(["dispatch", input]);
      return {
        handoffs: [
          { id: "h1", status: "delivered", targetProjectId: "web", targetSessionId: "s1" },
        ],
      };
    },
    decide: async (id, input) => {
      calls.push(["decide", id, input]);
      return { handoff: { id, status: input.decision === "send" ? "delivered" : "declined" } };
    },
    retry: async (id) => {
      calls.push(["retry", id]);
      return { handoff: { id: "h2", attempt: 2, previousId: id } };
    },
    list: async (options) => {
      calls.push(["list", options]);
      return { handoffs: [] };
    },
    ...overrides.handoffs,
  };
  const responses = [];
  return {
    calls,
    responses,
    ctx: {
      req: { method: "GET" },
      res: {},
      parts: [],
      url: new URL("http://127.0.0.1/api/workspace/handoffs"),
      json: (res, status, value) => {
        responses.push([status, value]);
        return value;
      },
      handoffs,
      ...overrides.ctx,
    },
  };
}

test("the handoff route lists, dispatches, decides and retries", async () => {
  const { ctx, calls, responses } = context();
  assert.equal(await workspaceHandoffs(ctx), false);

  ctx.parts = ["workspace", "handoffs"];
  ctx.url = new URL("http://127.0.0.1/api/workspace/handoffs?sourceThreadId=chat");
  await workspaceHandoffs(ctx);
  assert.deepEqual(calls[0], [
    "list",
    { sourceThreadId: "chat", sourceSessionId: "", status: "", limit: undefined },
  ]);
  assert.equal(responses.at(-1)[0], 200);

  ctx.req = {
    method: "POST",
    url: "/api/workspace/handoffs",
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(
        JSON.stringify({
          source: { kind: "assistant", id: "chat" },
          targets: [{ projectId: "web" }],
          deliveryKey: "k",
        }),
      );
    },
  };
  await workspaceHandoffs(ctx);
  assert.equal(calls.at(-1)[0], "dispatch");
  assert.equal(calls.at(-1)[1].confirmed, true);
  assert.equal(responses.at(-1)[0], 202);

  ctx.req = {
    method: "POST",
    url: "/api/workspace/handoffs",
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(JSON.stringify({ decision: "send" }));
    },
  };
  ctx.parts = ["workspace", "handoffs", "h1", "decision"];
  await workspaceHandoffs(ctx);
  assert.deepEqual(calls.at(-1), ["decide", "h1", { decision: "send" }]);

  ctx.parts = ["workspace", "handoffs", "h1", "retry"];
  await workspaceHandoffs(ctx);
  assert.deepEqual(calls.at(-1), ["retry", "h1"]);
  assert.equal(responses.at(-1)[0], 202);
});

test("the handoff route reports a missing handoff as JSON", async () => {
  const { ctx } = context({
    handoffs: {
      decide: async () => {
        throw Object.assign(new Error("Handoff not found."), { status: 404 });
      },
    },
  });
  ctx.req = {
    method: "POST",
    url: "/api/workspace/handoffs",
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(JSON.stringify({ decision: "send" }));
    },
  };
  ctx.parts = ["workspace", "handoffs", "missing", "decision"];
  const value = await workspaceHandoffs(ctx);
  assert.deepEqual(value, { error: "Handoff not found." });
});
