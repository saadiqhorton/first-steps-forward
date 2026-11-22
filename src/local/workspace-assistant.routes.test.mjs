import test from "node:test";
import assert from "node:assert/strict";
import { workspaceAssistant } from "./routes/workspaceAssistant.mjs";

function context(parts, { method = "GET", body, assistant = {}, state, ...rest } = {}) {
  const responses = [];
  const calls = [];
  const service = {
    voice: () => ({ chimeDuringDictation: true }),
    updateVoice: async (patch) => {
      calls.push(["updateVoice", patch]);
      return { voice: { chimeDuringDictation: true, ...patch } };
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
    startThread: async (data) => {
      calls.push(["startThread", data]);
      return { thread: { id: "new", ...data } };
    },
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
      state: state ?? { assistantThreads: [] },
      workspaceAssistant: service,
      ...rest,
    },
  };
}

test("voice preferences use the workspace voice route", async () => {
  const get = context(["workspace", "voice"]);
  await workspaceAssistant(get.ctx);
  assert.equal(get.responses.at(-1)[0], 200);
  assert.deepEqual(get.responses.at(-1)[1].voice, { chimeDuringDictation: true });

  const patch = context(["workspace", "voice"], {
    method: "PATCH",
    body: { chimeDuringDictation: false },
  });
  await workspaceAssistant(patch.ctx);
  assert.deepEqual(patch.calls.at(-1), ["updateVoice", { chimeDuringDictation: false }]);
  assert.equal(patch.responses.at(-1)[1].voice.chimeDuringDictation, false);
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

test("mode and permission changes go through updateThread", async () => {
  const { ctx, calls, responses } = context(["workspace", "assistant", "threads", "t1"], {
    method: "PATCH",
    body: { permission: "build" },
  });
  await workspaceAssistant(ctx);
  assert.deepEqual(calls.at(-1), ["updateThread", "t1", { permission: "build" }]);
  assert.equal(responses.at(-1)[0], 200);

  const mode = context(["workspace", "assistant", "threads", "t1"], {
    method: "PATCH",
    body: { mode: "work" },
  });
  await workspaceAssistant(mode.ctx);
  assert.deepEqual(mode.calls.at(-1), ["updateThread", "t1", { mode: "work" }]);
});

test("a device without approve cannot change how Luna works", async () => {
  const denied = () => ({ devicePolicy: (_ctx, capability) => capability !== "approve" });
  for (const body of [{ permission: "build" }, { mode: "work" }]) {
    const { ctx, calls, responses } = context(["workspace", "assistant", "threads", "t1"], {
      method: "PATCH",
      body,
      ...denied(),
    });
    await workspaceAssistant(ctx);
    assert.equal(responses.at(-1)[0], 403);
    assert.equal(
      calls.find((call) => call[0] === "updateThread"),
      undefined,
    );
  }
});

test("starting a Work thread needs approve, a Chat thread only needs start", async () => {
  const denied = () => ({ devicePolicy: (_ctx, capability) => capability !== "approve" });

  const work = context(["workspace", "assistant", "threads"], {
    method: "POST",
    body: { text: "make a deck", mode: "work" },
    ...denied(),
  });
  await workspaceAssistant(work.ctx);
  assert.equal(work.responses.at(-1)[0], 403);
  assert.equal(
    work.calls.find((call) => call[0] === "startThread"),
    undefined,
  );

  const chat = context(["workspace", "assistant", "threads"], {
    method: "POST",
    body: { text: "what is this", mode: "chat" },
    ...denied(),
  });
  await workspaceAssistant(chat.ctx);
  assert.equal(chat.responses.at(-1)[0], 201);
  assert.equal(chat.calls.at(-1)[0], "startThread");

  const allowed = context(["workspace", "assistant", "threads"], {
    method: "POST",
    body: { text: "make a deck", mode: "work" },
  });
  await workspaceAssistant(allowed.ctx);
  assert.equal(allowed.responses.at(-1)[0], 201);
  assert.deepEqual(allowed.calls.at(-1)[1], { text: "make a deck", mode: "work" });
});
