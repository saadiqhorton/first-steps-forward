import test from "node:test";
import assert from "node:assert/strict";
import { workspaceAssistant } from "./routes/workspaceAssistant.mjs";

function context(parts, { method = "GET", body, assistant = {} } = {}) {
  const responses = [];
  const calls = [];
  const service = {
    voice: () => ({ muted: false, speakReplies: true, chimeDuringDictation: true }),
    updateVoice: async (patch) => {
      calls.push(["updateVoice", patch]);
      return { voice: { muted: true, speakReplies: true, chimeDuringDictation: true, ...patch } };
    },
    updateThread: async (id, patch) => {
      calls.push(["updateThread", id, patch]);
      return { thread: { id, agentId: patch.agentId ?? "fake", model: patch.model } };
    },
    renameThread: async (id, title) => {
      calls.push(["renameThread", id, title]);
      return { thread: { id, title: String(title).slice(0, 120) } };
    },
    listThreads: () => [{ id: "t1" }],
    listAgents: () => [{ id: "fake", workspaceAssistant: "tools" }],
    getThread: () => ({ thread: { id: "t1" } }),
    markRead: async (id, at) => ({ id, readAt: at }),
    defaults: () => ({}),
    ...assistant,
  };
  return {
    calls,
    responses,
    ctx: {
      req: {
        method,
        url: `/api/${parts.join("/")}`,
        headers: {},
        ...(body
          ? {
              [Symbol.asyncIterator]: async function* () {
                yield Buffer.from(JSON.stringify(body));
              },
            }
          : {}),
      },
      res: {},
      parts,
      json: (res, status, value) => {
        responses.push([status, value]);
        return value;
      },
      state: { assistantThreads: [] },
      workspaceAssistant: service,
    },
  };
}

test("voice preferences use the workspace voice route", async () => {
  const get = context(["workspace", "voice"]);
  await workspaceAssistant(get.ctx);
  assert.equal(get.responses.at(-1)[0], 200);
  assert.equal(get.responses.at(-1)[1].voice.muted, false);

  const patch = context(["workspace", "voice"], { method: "PATCH", body: { muted: true } });
  await workspaceAssistant(patch.ctx);
  assert.deepEqual(patch.calls.at(-1), ["updateVoice", { muted: true }]);
  assert.equal(patch.responses.at(-1)[1].voice.muted, true);
});

test("agent and model changes go through updateThread, not a raw thread write", async () => {
  const { ctx, calls, responses } = context(["workspace", "assistant", "threads", "t1"], {
    method: "PATCH",
    body: { agentId: "fake", model: "m1" },
  });
  await workspaceAssistant(ctx);
  assert.deepEqual(calls.at(-1), ["updateThread", "t1", { agentId: "fake", model: "m1" }]);
  assert.equal(responses.at(-1)[0], 200);
  assert.equal(responses.at(-1)[1].thread.model, "m1");
});

test("the assistant list route still serves threads, agents and defaults", async () => {
  const { ctx, responses } = context(["workspace", "assistant"]);
  await workspaceAssistant(ctx);
  assert.equal(responses.at(-1)[0], 200);
  assert.equal(responses.at(-1)[1].threads[0].id, "t1");
  assert.equal(responses.at(-1)[1].agents[0].workspaceAssistant, "tools");
});

test("renaming an assistant chat goes through the saving service", async () => {
  const { ctx, calls, responses } = context(["workspace", "assistant", "threads", "t1"], {
    method: "PATCH",
    body: { title: "Release checklist" },
  });
  await workspaceAssistant(ctx);
  assert.deepEqual(calls.at(-1), ["renameThread", "t1", "Release checklist"]);
  assert.equal(responses.at(-1)[0], 200);
  assert.equal(responses.at(-1)[1].thread.title, "Release checklist");
});
