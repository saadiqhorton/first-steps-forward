import { body } from "../http.mjs";

/** Workspace-level assistant API. */
export async function workspaceAssistant(ctx) {
  const { req, res, parts, url, json, workspaceAssistant: assistant } = ctx;
  // Luna's small voice preference lives beside the assistant, not under a theme service.
  const isVoice = parts[0] === "workspace" && parts[1] === "voice" && parts.length === 2;
  if (!isVoice && (parts[0] !== "workspace" || parts[1] !== "assistant")) return false;
  const can = (capability) => ctx.devicePolicy?.(ctx.deviceContext, capability) ?? true;
  const tail = parts.slice(2);
  try {
    if (isVoice) {
      if (req.method === "GET") return json(res, 200, { voice: assistant.voice() });
      if (req.method === "PATCH")
        return json(res, 200, await assistant.updateVoice(await body(req)));
    }
    if (req.method === "POST" && tail.length === 1 && tail[0] === "tool-call") {
      const token = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ""))?.[1];
      const data = await body(req);
      const threadId = String(data.threadId ?? "");
      const thread = ctx.state.assistantThreads?.some((item) => item.id === threadId);
      if (thread || !ctx.handoffs)
        return json(
          res,
          200,
          await assistant.callTool(threadId, token, String(data.name ?? ""), data.arguments ?? {}),
        );
      return json(
        res,
        200,
        await ctx.handoffs.callSessionTool(
          threadId,
          token,
          String(data.name ?? ""),
          data.arguments ?? {},
        ),
      );
    }
    if (req.method === "GET" && tail.length === 0)
      return json(res, 200, {
        threads: assistant.listThreads(),
        agents: assistant.listAgents(),
        defaults: assistant.defaults(),
      });
    if (req.method === "GET" && tail[0] === "threads" && tail.length === 1)
      return json(res, 200, {
        threads: assistant.listThreads({
          query: url.searchParams.get("query") ?? "",
          limit: Number(url.searchParams.get("limit")) || 50,
        }),
        nextCursor: null,
      });
    if (req.method === "POST" && tail.length === 1 && tail[0] === "threads") {
      if (!can("start"))
        return json(res, 403, { error: "This device cannot start assistant work." });
      const data = await body(req);
      // A Work thread can write on this host, so it needs the owner's approval
      // capability even when the device may start chats.
      if (
        (data.mode === "work" || (data.permission && data.permission !== "plan")) &&
        !can("approve")
      )
        return json(res, 403, { error: "Only the host owner can start Luna in Work mode." });
      const result = await assistant.startThread(data);
      return json(res, 201, result);
    }
    if (
      req.method === "POST" &&
      tail.length === 2 &&
      tail[0] === "threads" &&
      tail[1] === "bulk-delete"
    ) {
      if (!can("approve"))
        return json(res, 403, { error: "Only the host owner can delete assistant history." });
      const data = await body(req);
      return json(res, 200, await assistant.deleteThreads(data.ids ?? []));
    }
    if (tail[0] !== "threads" || !tail[1])
      return json(res, 404, { error: "Assistant route not found." });
    const threadId = tail[1];
    if (req.method === "GET" && tail.length === 2) {
      const result = assistant.getThread(threadId);
      return result
        ? json(res, 200, result)
        : json(res, 404, { error: "Assistant chat not found." });
    }
    if (req.method === "POST" && tail[2] === "messages") {
      if (!can("message"))
        return json(res, 403, { error: "This device cannot send assistant messages." });
      return json(res, 202, await assistant.sendMessage(threadId, await body(req)));
    }
    if (req.method === "POST" && tail[2] === "stop") {
      if (!can("stop")) return json(res, 403, { error: "This device cannot stop work." });
      return json(res, 200, { stopped: await assistant.stopThread(threadId) });
    }
    if (req.method === "DELETE" && tail.length === 2) {
      if (!can("approve"))
        return json(res, 403, { error: "Only the host owner can delete assistant history." });
      return json(res, 200, { deleted: await assistant.deleteThread(threadId) });
    }
    if (req.method === "PATCH" && tail.length === 2) {
      const data = await body(req);
      const thread = assistant.getThread(threadId)?.thread;
      if (!thread) return json(res, 404, { error: "Assistant chat not found." });
      if (
        data.agentId !== undefined ||
        data.model !== undefined ||
        data.effort !== undefined ||
        data.mode !== undefined ||
        data.permission !== undefined
      ) {
        if ((data.mode !== undefined || data.permission !== undefined) && !can("approve"))
          return json(res, 403, { error: "Only the host owner can change how Luna works." });
        return json(res, 200, await assistant.updateThread(threadId, data));
      }
      let updated = thread;
      // A rename is durable state: going through the service saves it and emits
      // the workspace event, instead of mutating the in-memory thread only.
      if (data.title !== undefined)
        updated = (await assistant.renameThread(threadId, data.title)).thread;
      if (data.readAt !== undefined || data.unread !== undefined)
        updated = await assistant.markRead(
          threadId,
          data.unread ? 0 : Number(data.readAt) || Date.now(),
        );
      return json(res, 200, { thread: updated });
    }
    if (req.method === "POST" && tail[2] === "catchup")
      return json(res, 200, await assistant.catchup(tail[1], await body(req)));
    return json(res, 404, { error: "Assistant route not found." });
  } catch (error) {
    return json(res, error.status ?? 400, { error: error.message ?? String(error) });
  }
}
