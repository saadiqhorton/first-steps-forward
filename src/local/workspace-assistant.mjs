import { isHiddenSession } from "./customize/paths.mjs";
import { randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { spawnCommand } from "./spawn.mjs";
import { shrinkLogLine } from "./session-turns.mjs";
import { TOOLS, runWorkspaceTool } from "./workspace-tools.mjs";
import { resolveAttachments, formatAttachmentPrompt } from "./attachments.mjs";
import { lunaBrief } from "./luna-brief.mjs";

const clean = (s, n = 4000) => String(s ?? "").slice(0, n);
export { TOOLS };

// Adapters that accept the workspaceAssistant capability in a workspace chat.
// ACP adapters are always tool-capable; these CLI adapters wire the same
// capability object (see adapters/codex|opencode|pi.agent.mjs).
const TOOL_CAPABLE_IDS = new Set(["codex", "opencode", "pi"]);

/** Attachment metadata stored on a message (survives reload), like session-turns. */
const attachmentMeta = (files) =>
  files.length
    ? {
        attachments: files.map(({ id, name, mime, size, kind }) => ({
          id,
          name,
          mime,
          size,
          kind,
        })),
      }
    : {};

/** Native files handed to the adapter; recordings stay path-only (see session-turns). */
const nativeAttachments = (files) =>
  files
    .filter((file) => !file.recording)
    .map(({ absPath, mime, kind, name }) => ({ path: absPath, mime, kind, name }));

/** Host-owned assistant conversations, executed by the same installed adapters as project turns. */
export function createWorkspaceAssistant({
  state,
  save,
  id = randomUUID,
  now = Date.now,
  emit = () => {},
  adapters = {},
  agentStatus = () => [],
  resolveSessionOptions = async () => ({ ok: true, value: {} }),
  dispatchAction,
  dataDir = process.cwd(),
  getAppAddress = () => null,
  onDeleteThread = () => {},
  spawn = spawnCommand,
  connectors: listConnectors = () => [],
}) {
  state.assistantThreads ??= [];
  state.assistantMessages ??= [];
  state.assistantActivity ??= [];
  const running = new Map();

  // Luna's folders live under the ADE data dir, never in the directory ADE
  // happened to be launched from. Chat shares the root; Work gets one folder
  // per chat, created only when a Work turn actually runs.
  const lunaRoot = () => path.join(dataDir, "luna");
  const ensureLunaRoot = async () => {
    await fsp.mkdir(lunaRoot(), { recursive: true, mode: 0o700 });
    return lunaRoot();
  };
  const ensureWorkFolder = async (thread) => {
    const folder = path.join(lunaRoot(), thread.id);
    await fsp.mkdir(folder, { recursive: true, mode: 0o700 });
    return folder;
  };
  const turnFolder = (thread) =>
    thread.mode === "work" ? ensureWorkFolder(thread) : ensureLunaRoot();

  /** Threads written before modes existed read as a read-only chat. */
  const normalizeThread = (thread) => {
    thread.mode ??= "chat";
    thread.permission ??= "plan";
    thread.workspacePath ??= path.join(lunaRoot(), thread.id);
    return thread;
  };

  /** Whether this agent's adapter actually receives ADE workspace tools in a workspace chat. */
  const adapterSupportsTools = (agent) => {
    const adapter = adapters[agent.id];
    if (!adapter) return false;
    return adapter.protocol === "acp" || TOOL_CAPABLE_IDS.has(adapter.id);
  };

  /** Resolve attachment ids, normalizing the attachments helper's thrown objects into Errors. */
  const resolveFiles = async (attachmentIds) => {
    const ids = Array.isArray(attachmentIds) ? attachmentIds : [];
    if (!ids.length) return [];
    try {
      return await resolveAttachments(dataDir, ids, { includeBytes: false });
    } catch (error) {
      const status = error?.status ?? 400;
      const message = error?.message ?? (error instanceof Error ? error.message : String(error));
      throw Object.assign(new Error(message), { status });
    }
  };

  // History metadata, computed on read: the last message as a preview and whether
  // the thread changed since it was last read. Mutates in place so getThread keeps
  // returning the live thread the PATCH route renames.
  const withMeta = (thread) => {
    normalizeThread(thread);
    const last = state.assistantMessages.filter((m) => m.threadId === thread.id).at(-1);
    thread.preview = last?.text ? clean(last.text, 140) : undefined;
    thread.unread = (thread.updatedAt ?? 0) > (thread.readAt ?? 0);
    return thread;
  };
  const listThreads = ({ query = "", limit = 50 } = {}) => {
    const q = clean(query, 200).toLowerCase();
    return state.assistantThreads
      .filter(
        (t) =>
          !q ||
          `${t.title} ${state.assistantMessages
            .filter((m) => m.threadId === t.id)
            .map((m) => m.text)
            .join(" ")}`
            .toLowerCase()
            .includes(q),
      )
      .slice()
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, Math.min(100, limit))
      .map(withMeta);
  };
  const listAgents = () =>
    state.agents.map((agent) => ({
      ...agent,
      workspaceAssistant: adapterSupportsTools(agent) ? "tools" : "chat_only",
    }));
  const getThread = (threadId) => {
    const thread = state.assistantThreads.find((t) => t.id === threadId);
    if (!thread) return null;
    return {
      thread: withMeta(thread),
      messages: state.assistantMessages.filter((m) => m.threadId === threadId),
      activity: state.assistantActivity.filter((a) => a.threadId === threadId).slice(-100),
      cursor: state.assistantMessages.filter((m) => m.threadId === threadId).length,
    };
  };
  async function run(thread, userMessage, runId = id(), files = []) {
    normalizeThread(thread);
    const adapter = adapters[thread.agentId];
    const agent = state.agents.find((a) => a.id === thread.agentId);
    if (!adapter || !agent?.installed || !agent?.signedIn)
      throw new Error(`${agent?.name ?? thread.agentId} is unavailable or not signed in.`);
    const controller = new AbortController();
    const toolToken = id() + id();
    thread.toolToken = toolToken;
    running.set(thread.id, { controller, runId });
    // Mark the turn running before the first await: callers read status right
    // after startThread returns.
    thread.status = "thinking";
    thread.updatedAt = now();
    thread.runId = runId;
    await save();
    emit("workspace-assistant");
    // Set once the turn is registered; io.spawn reads it when the adapter runs.
    let cwd = "";
    const activity = (type, text) => {
      // A CLI log line is a JSON event. Cutting it at 1,000 chars turns valid
      // JSON into an unreadable dump in the trace, so bound it like a session
      // log does: keep it valid JSON and drop repeated transcripts.
      state.assistantActivity.push({
        id: id(),
        threadId: thread.id,
        runId,
        type,
        text: type === "log" ? shrinkLogLine(text) : clean(text, 1000),
        at: now(),
      });
      state.assistantActivity = state.assistantActivity.slice(-5000);
    };
    let sawText = false;
    const io = {
      signal: controller.signal,
      emit(event) {
        if (event.type === "text" && event.text?.trim()) {
          sawText = true;
          const last = state.assistantMessages.at(-1);
          // Streamed replies arrive as many text events; merge the ones from the
          // same run that arrive in quick succession into one message (like
          // session-turns), keeping the first message's agentId/model attribution.
          if (
            last?.role === "assistant" &&
            last.threadId === thread.id &&
            last.runId === runId &&
            now() - last.at < 1200
          ) {
            last.text = clean(`${last.text}${event.text}`);
            last.at = now();
          } else {
            state.assistantMessages.push({
              id: id(),
              threadId: thread.id,
              runId,
              role: "assistant",
              text: clean(event.text),
              at: now(),
              agentId: thread.agentId,
              model: thread.model,
            });
          }
        } else if (event.type === "log") activity("log", event.line);
        else if (event.type === "notice" || event.type === "error")
          activity(event.type, event.text);
        else if (event.type === "conversation") thread.agentSessionId = event.id;
        else if (event.type === "default-model") thread.defaultModel = event.id;
        thread.updatedAt = now();
        void save();
        emit("workspace-assistant");
      },
      ask: async (request) => {
        thread.status = "awaiting_input";
        activity("permission", request?.title ?? "Agent needs input");
        await save();
        return { outcome: "cancelled" };
      },
      spawn(bin, args, { env = {}, stdin = "ignore" } = {}) {
        const child = spawn(bin, args, {
          cwd,
          env: { ...process.env, ...env },
          stdio: [stdin, "pipe", "pipe"],
          shell: false,
        });
        running.get(thread.id).child = child;
        controller.signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
        return child;
      },
    };
    try {
      // Resolve the folder inside the try: a mkdir failure is a failed turn, never
      // a silent run in another directory.
      cwd = await turnFolder(thread);
      // Brief a new agent session, and re-brief when the mode changed. Follow-ups
      // in the same mode do not repeat it.
      const needsBrief = !thread.agentSessionId || thread.briefedMode !== thread.mode;
      const brief = needsBrief ? `${lunaBrief({ mode: thread.mode, folder: cwd })}\n\n` : "";
      if (needsBrief) thread.briefedMode = thread.mode;
      const workspaceAssistant =
        adapterSupportsTools(agent) && getAppAddress()
          ? {
              url: `${getAppAddress()}/api/workspace/assistant/tool-call`,
              token: toolToken,
              threadId: thread.id,
              node: process.execPath,
            }
          : undefined;
      /** @type {object[]} */
      let connectors = [];
      try {
        connectors = (await listConnectors()) ?? [];
      } catch (error) {
        activity(
          "notice",
          `Connectors could not be read, so this turn runs without them: ${error?.message ?? error}`,
        );
      }
      const result = await adapter.runTurn(
        {
          projectPath: cwd,
          prompt: `${brief}${userMessage}${formatAttachmentPrompt(files)}`,
          session: { id: thread.id, agentSessionId: thread.agentSessionId },
          continuing: !!thread.agentSessionId,
          dataDir: thread.dataDir,
          providers: agent.providers,
          version: agent.version ?? "",
          model: thread.model,
          defaultModel: thread.defaultModel,
          effort: thread.effort,
          permission: thread.permission,
          attachments: nativeAttachments(files),
          computer: null,
          workspaceAssistant,
          connectors,
        },
        io,
      );
      thread.status = controller.signal.aborted
        ? "idle"
        : result?.ok && sawText
          ? "idle"
          : "failed";
      if (!result?.ok)
        activity(
          controller.signal.aborted ? "stopped" : "failed",
          result?.reason ?? "Agent turn failed.",
        );
    } catch (error) {
      thread.status = "failed";
      activity("failed", error?.message ?? String(error));
    } finally {
      thread.updatedAt = now();
      thread.runId = undefined;
      delete thread.toolToken;
      running.delete(thread.id);
      await save();
      emit("workspace-assistant");
    }
    return runId;
  }
  async function startThread(input = {}) {
    const agentId =
      input.agentId ??
      state.assistantDefaults?.agentId ??
      state.agents.find((a) => a.installed && a.signedIn)?.id;
    if (!agentId)
      throw Object.assign(new Error("No installed signed-in agent is available."), { status: 409 });
    const files = await resolveFiles(input.attachmentIds);
    const mode = input.mode === "work" ? "work" : "chat";
    const permission = input.permission ?? (mode === "work" ? "build" : "plan");
    const option = await resolveSessionOptions(agentId, input.model, {
      effort: input.effort,
      permission,
    });
    if (!option.ok) throw Object.assign(new Error(option.error), { status: 400 });
    const threadId = id();
    const thread = {
      id: threadId,
      title: clean(input.text, 80) || "New chat",
      status: "idle",
      agentId,
      model: input.model,
      effort: option.value?.effort ?? input.effort,
      mode: permission === "plan" ? "chat" : "work",
      permission: option.value?.permission ?? permission,
      workspacePath: path.join(lunaRoot(), threadId),
      dataDir,
      createdAt: now(),
      updatedAt: now(),
      readAt: now(),
    };
    state.assistantThreads.unshift(thread);
    await save();
    const text = clean(input.text).trim();
    if (text) {
      state.assistantMessages.push({
        id: id(),
        threadId: thread.id,
        role: "user",
        text,
        at: now(),
        source: "user",
        ...attachmentMeta(files),
      });
      await save();
      const runId = id();
      startRun(thread, text, runId, files);
      return { thread, runId };
    }
    return { thread, runId: null };
  }
  async function sendMessage(threadId, input) {
    const thread = state.assistantThreads.find((t) => t.id === threadId);
    if (!thread) throw Object.assign(new Error("Assistant chat not found."), { status: 404 });
    if (running.has(threadId))
      throw Object.assign(new Error("This assistant chat is already running."), { status: 409 });
    const text = clean(input.text).trim();
    if (!text) throw Object.assign(new Error("Message cannot be empty."), { status: 400 });
    const files = await resolveFiles(input.attachmentIds);
    state.assistantMessages.push({
      id: id(),
      threadId,
      role: "user",
      text,
      at: now(),
      source: "user",
      ...attachmentMeta(files),
    });
    await save();
    const runId = id();
    startRun(thread, text, runId, files);
    return { message: state.assistantMessages.at(-1), runId };
  }
  async function stopThread(threadId) {
    const slot = running.get(threadId);
    if (!slot) return false;
    slot.controller.abort();
    return true;
  }
  async function deleteThread(threadId) {
    await stopThread(threadId);
    state.assistantDeleted ??= [];
    if (!state.assistantDeleted.includes(threadId)) state.assistantDeleted.push(threadId);
    state.assistantThreads = state.assistantThreads.filter((t) => t.id !== threadId);
    state.assistantMessages = state.assistantMessages.filter((m) => m.threadId !== threadId);
    state.assistantActivity = state.assistantActivity.filter((a) => a.threadId !== threadId);
    // Only this thread's folder, only when it really is a folder under the Luna
    // root. A symlink or a path that escaped the root is left alone.
    const root = lunaRoot();
    const target = path.join(root, threadId);
    const rel = path.relative(root, target);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      const stat = await fsp.lstat(target).catch(() => null);
      if (stat?.isDirectory() && !stat.isSymbolicLink())
        await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
    }
    try {
      await onDeleteThread(threadId);
    } catch {}
    await save();
    emit("workspace-assistant");
    return true;
  }
  /** Rename without blocking a running turn and without marking the chat unread. */
  async function renameThread(threadId, title) {
    const thread = state.assistantThreads.find((item) => item.id === threadId);
    if (!thread) throw Object.assign(new Error("Assistant chat not found."), { status: 404 });
    thread.title = String(title ?? "").slice(0, 120);
    await save();
    emit("workspace-assistant");
    return { thread: withMeta(thread) };
  }
  async function updateThread(threadId, input = {}) {
    const thread = state.assistantThreads.find((item) => item.id === threadId);
    if (!thread) throw Object.assign(new Error("Assistant chat not found."), { status: 404 });
    if (running.has(threadId))
      throw Object.assign(new Error("This assistant chat is already running."), { status: 409 });
    if (input.agentId !== undefined) {
      const agent = state.agents.find((item) => item.id === input.agentId);
      if (!agent) throw Object.assign(new Error("Choose a supported agent."), { status: 400 });
      if (thread.agentId !== agent.id) {
        thread.agentId = agent.id;
        delete thread.agentSessionId;
        // A default model reported by the previous CLI does not apply to the new one.
        delete thread.defaultModel;
        thread.model = undefined;
        thread.effort = undefined;
        // A permission the previous adapter offered may not exist on this one.
        thread.permission = "plan";
        thread.mode = "chat";
      }
    }
    normalizeThread(thread);
    const nextModel = input.model !== undefined ? String(input.model) || undefined : thread.model;
    let nextMode = thread.mode;
    let nextPermission = thread.permission;
    if (input.mode !== undefined) {
      if (input.mode !== "chat" && input.mode !== "work")
        throw Object.assign(new Error("Choose chat or work."), { status: 400 });
      nextMode = input.mode;
      if (nextMode === "chat") nextPermission = "plan";
      else if (nextPermission === "plan") nextPermission = "build";
    }
    if (input.permission !== undefined) {
      nextPermission = String(input.permission);
      nextMode = nextPermission === "plan" ? "chat" : "work";
    }
    const checked = await resolveSessionOptions(thread.agentId, nextModel, {
      effort: input.effort !== undefined ? input.effort : thread.effort,
      permission: nextPermission,
    });
    if (!checked.ok) throw Object.assign(new Error(checked.error), { status: 400 });
    if (input.model !== undefined) thread.model = nextModel;
    if (input.effort !== undefined) thread.effort = checked.value?.effort ?? input.effort;
    thread.permission = checked.value?.permission ?? nextPermission;
    thread.mode = nextMode;
    thread.updatedAt = now();
    await save();
    emit("workspace-assistant");
    return { thread };
  }
  async function markRead(threadId, readAt = now()) {
    const t = state.assistantThreads.find((x) => x.id === threadId);
    if (!t) return null;
    t.readAt = readAt;
    await save();
    return t;
  }
  async function deleteThreads(ids) {
    const list = Array.isArray(ids) ? [...new Set(ids.map(String))].slice(0, 100) : [];
    if (!list.length)
      throw Object.assign(new Error("Choose at least one assistant chat."), { status: 400 });
    const results = [];
    for (const threadId of list) {
      if (!state.assistantThreads.some((t) => t.id === threadId)) {
        results.push({ id: threadId, deleted: false, error: "Assistant chat not found." });
        continue;
      }
      results.push({ id: threadId, deleted: await deleteThread(threadId) });
    }
    return { results };
  }

  /** Run an assistant turn without letting a startup failure become an unhandled rejection. */
  function startRun(thread, text, runId, files) {
    void run(thread, text, runId, files).catch(async (error) => {
      thread.status = "failed";
      thread.updatedAt = now();
      thread.runId = undefined;
      delete thread.toolToken;
      running.delete(thread.id);
      state.assistantActivity.push({
        id: id(),
        threadId: thread.id,
        runId,
        type: "failed",
        text: clean(error?.message ?? String(error), 1000),
        at: now(),
      });
      await save();
      emit("workspace-assistant");
    });
  }

  const sessionHref = (projectId, sessionId) =>
    `/p/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(sessionId)}`;
  const projectName = (projectId) =>
    state.projects.find((p) => p.id === projectId)?.name ?? "Project";
  const lastReply = (s) =>
    (s.messages ?? []).filter((m) => ["agent", "system", "assistant"].includes(m.role)).at(-1)
      ?.text;

  /**
   * What changed across projects since the cursor, as evidence for the host chat.
   * Reads sessions and handoffs; never sends a message to any destination session.
   */
  async function catchup(threadId, { since } = {}) {
    const cutoff = Number(since ?? state.workspaceAssistant?.catchupAt ?? 0) || 0;
    const items = [];
    for (const s of state.sessions) {
      if (isHiddenSession(state, s)) continue;
      const updatedAt = s.updatedAt ?? s.createdAt ?? 0;
      if (updatedAt <= cutoff) continue;
      const label = projectName(s.projectId);
      const href = sessionHref(s.projectId, s.id);
      const source = { label };
      const wasCreatedByHandoff =
        s.handoffId || s.createdBy === "workspace-assistant" || s.source?.kind === "assistant";
      if (wasCreatedByHandoff && (s.createdAt ?? 0) > cutoff) {
        items.push({
          kind: "handoff",
          text: `Started a task in ${label}: ${clean(s.request, 240)}`,
          href,
          at: s.createdAt,
          projectId: s.projectId,
          sessionId: s.id,
          source,
        });
      }
      const pending = [...(s.pendingPermissions ?? [])].filter((p) => p.kind !== "dev_command");
      if (pending.length) {
        items.push({
          kind: "permission",
          text: `Waiting for your answer in ${label}: ${clean(pending[0]?.title ?? "approval", 240)}`,
          href,
          at: updatedAt,
          projectId: s.projectId,
          sessionId: s.id,
          source,
        });
        continue;
      }
      if (s.pendingQuestion) {
        items.push({
          kind: "permission",
          text: `Waiting for your answer in ${label}: ${clean(s.pendingQuestion, 240)}`,
          href,
          at: updatedAt,
          projectId: s.projectId,
          sessionId: s.id,
          source,
        });
        continue;
      }
      const failedCheck = (s.checks ?? []).find((c) => c.status === "failed");
      if (failedCheck) {
        items.push({
          kind: "failed",
          text: `A check failed in ${label}: ${failedCheck.name} — ${clean(failedCheck.detail, 400)}`,
          href,
          at: updatedAt,
          projectId: s.projectId,
          sessionId: s.id,
          source,
        });
        continue;
      }
      if (["blocked", "failed", "error"].includes(s.status)) {
        items.push({
          kind: "failed",
          text: `Turn failed in ${label}: ${clean(lastReply(s) ?? s.request, 400)}`,
          href,
          at: updatedAt,
          projectId: s.projectId,
          sessionId: s.id,
          source,
        });
        continue;
      }
      if (s.status === "stopped") {
        items.push({
          kind: "stopped",
          text: `Stopped in ${label}: ${clean(s.request, 240)}`,
          href,
          at: updatedAt,
          projectId: s.projectId,
          sessionId: s.id,
          source,
        });
        continue;
      }
      if (["ready", "complete"].includes(s.status)) {
        items.push({
          kind: "ready",
          text: `Finished in ${label}: ${clean(s.summary ?? lastReply(s) ?? s.request, 400)}`,
          href,
          at: updatedAt,
          projectId: s.projectId,
          sessionId: s.id,
          source,
        });
        continue;
      }
    }
    for (const record of state.handoffs ?? []) {
      if (record.source?.id !== threadId || record.status !== "replied") continue;
      const at = record.returnedAt ?? record.answeredAt ?? record.updatedAt ?? 0;
      if (at <= cutoff) continue;
      const label = record.targetProjectName ?? projectName(record.targetProjectId);
      const href =
        record.href ??
        (record.targetSessionId && record.targetProjectId
          ? sessionHref(record.targetProjectId, record.targetSessionId)
          : null);
      items.push({
        kind: "reply",
        text: `${label} replied: ${clean(record.answer ?? "", 400)}`,
        href,
        at,
        projectId: record.targetProjectId,
        sessionId: record.targetSessionId,
        source: { label },
      });
    }
    state.workspaceAssistant ??= {};
    const sorted = items.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    // Do not lose evidence when more than a page changed: the next catch-up
    // resumes just before the oldest item returned here.
    const truncated = sorted.length > 30;
    const cursor = truncated ? Math.max(cutoff, (sorted[29]?.at ?? now()) - 1) : now();
    state.workspaceAssistant.catchupAt = cursor;
    await save();
    return { items: sorted.slice(0, 30), cursor };
  }

  const reconcile = async () => {};
  const toolContext = () => ({ state, dispatchAction, runWorkspaceTool });
  const voice = () => ({
    chimeDuringDictation:
      typeof state.voice?.chimeDuringDictation === "boolean"
        ? state.voice.chimeDuringDictation
        : true,
  });
  async function updateVoice(patch = {}) {
    const current = voice();
    if (typeof patch.chimeDuringDictation === "boolean")
      current.chimeDuringDictation = patch.chimeDuringDictation;
    state.voice = current;
    await save();
    emit("workspace-assistant");
    return { voice: current };
  }
  async function callTool(threadId, token, name, args) {
    const thread = state.assistantThreads.find((t) => t.id === threadId);
    if (!thread || !running.has(threadId) || !token || token !== thread.toolToken)
      throw Object.assign(new Error("Workspace tool capability expired."), { status: 403 });
    return runWorkspaceTool(name, args, {
      state,
      pendingPermissions: (sessionId) =>
        state.sessions.find((s) => s.id === sessionId)?.pendingPermissions ?? [],
      dispatchAction: dispatchAction
        ? (action, values) => dispatchAction(thread, action, values)
        : undefined,
    });
  }
  return {
    listThreads,
    listAgents,
    getThread,
    startThread,
    sendMessage,
    stopThread,
    deleteThread,
    deleteThreads,
    updateThread,
    renameThread,
    markRead,
    catchup,
    voice,
    updateVoice,
    toolContext,
    callTool,
    reconcile,
    defaults: () => state.assistantDefaults ?? {},
  };
}
