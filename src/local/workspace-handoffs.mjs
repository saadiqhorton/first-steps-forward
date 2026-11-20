// Cross-project handoffs: a durable record of one request sent from the
// workspace assistant (or one project's session) to another project, and the
// reply that came back from the turn which consumed it.
//
// The record is the source of truth across restarts and reconnects. A delivery
// key makes a retried request idempotent, and the target message/turn marks
// which reply belongs to this request. A pre-existing turn finishing in the
// same session can never satisfy a handoff.
import { isHiddenProject } from "./customize/paths.mjs";
import { randomUUID } from "node:crypto";

const TERMINAL = new Set(["replied", "declined", "cancelled", "missing_target", "interrupted"]);
const OPEN = new Set(["approval_pending", "queued", "delivered"]);
const clean = (value, max = 8000) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const RANK = { plan: 0, read: 0, build: 1 };

/** Where a request came from, described so a project agent can act with its ceiling. */
function describeSource(state, source) {
  if (!source || typeof source !== "object") return null;
  if (source.kind === "assistant") {
    const thread = state.assistantThreads?.find((item) => item.id === source.id);
    if (!thread) return null;
    return {
      kind: "assistant",
      id: thread.id,
      label: `Workspace chat “${thread.title || "New chat"}”`,
      permission: "plan",
    };
  }
  if (source.kind === "session") {
    const session = state.sessions.find((item) => item.id === source.id);
    if (!session) return null;
    const project = state.projects.find((item) => item.id === session.projectId);
    return {
      kind: "session",
      id: session.id,
      projectId: session.projectId,
      label: project ? `${project.name} session` : "Project session",
      permission: session.permission ?? "build",
    };
  }
  return null;
}

/** -1 when `target` is less privileged, 1 when more, 0 when equal, null when not comparable. */
function comparePermission(target, source) {
  if (target === source) return 0;
  const a = RANK[target];
  const b = RANK[source];
  return a === undefined || b === undefined ? null : Math.sign(a - b);
}

/**
 * @param {object} options
 * @param {any} options.state shared ADE workspace state
 * @param {() => Promise<void>} options.save host persistence (locked, cross-process)
 * @param {(input: object) => Promise<any>} options.projectStart validated project launch
 * @param {(session: any, text: string, meta: object) => Promise<any>} options.sendToSession
 * @param {(session: any) => boolean} options.isBusy
 * @param {(name: string, args: object, source: object) => Promise<any>} [options.sessionAction]
 * @param {() => string | null} [options.getAppAddress]
 */
export function createWorkspaceHandoffs({
  state,
  save,
  id = () => randomUUID(),
  now = Date.now,
  emit = () => {},
  projectStart,
  sendToSession,
  isBusy = () => false,
  sessionAction,
  getAppAddress = () => null,
  refuseRisk = () => false,
}) {
  /** One-turn capabilities for project sessions; a token only works while its turn runs. */
  const tokens = new Map();
  const records = () => (state.handoffs ??= []);

  const projectOf = (projectId) => state.projects.find((item) => item.id === projectId) ?? null;
  const visibleProject = (projectId) => {
    const project = projectOf(projectId);
    return project && !isHiddenProject(project) ? project : null;
  };
  const sessionOf = (sessionId) => state.sessions.find((item) => item.id === sessionId) ?? null;
  const targetLabel = (record) =>
    record.targetProjectName || projectOf(record.targetProjectId)?.name || "Project";
  const href = (record) =>
    record.targetSessionId && record.targetProjectId
      ? `/p/${encodeURIComponent(record.targetProjectId)}/conversations/${encodeURIComponent(record.targetSessionId)}`
      : null;
  const originHref = (source) => {
    if (source.kind === "assistant") return `/workspace/assistant/${encodeURIComponent(source.id)}`;
    if (source.kind === "session") {
      const session = sessionOf(source.id);
      if (session)
        return `/p/${encodeURIComponent(session.projectId)}/conversations/${encodeURIComponent(session.id)}`;
    }
    return null;
  };

  function recordOut(record) {
    return {
      ...record,
      targetName: targetLabel(record),
      href: href(record),
    };
  }

  /** Session answers are correlated by the turn that started after this request was consumed. */
  function answered(session, record) {
    const deliveredAt = record.deliveredAt ?? record.createdAt;
    const replies = (session.messages ?? []).filter(
      (message) =>
        ["agent", "assistant"].includes(message.role) &&
        (message.at ?? 0) >= deliveredAt &&
        message.id !== record.targetMessageId,
    );
    return replies.at(-1) ?? null;
  }

  async function returnAnswer(record, answer) {
    if (record.returnedAt) return;
    const source = record.source;
    const text = `${targetLabel(record)} replied:\n\n${clean(answer.text, 4000)}`;
    if (source.kind === "assistant") {
      const thread = state.assistantThreads?.find((item) => item.id === source.id);
      if (thread) {
        state.assistantMessages ??= [];
        state.assistantMessages.push({
          id: id(),
          threadId: thread.id,
          role: "assistant",
          kind: "handoff",
          handoffId: record.id,
          text,
          at: now(),
          href: href(record),
          source: { kind: "handoff", id: record.id, projectId: record.targetProjectId },
        });
        thread.updatedAt = now();
        thread.status = "idle";
      }
    } else if (source.kind === "session") {
      const origin = sessionOf(source.id);
      if (origin) {
        origin.messages ??= [];
        origin.messages.push({
          id: id(),
          role: "system",
          kind: "handoff",
          handoffId: record.id,
          text,
          at: now(),
          href: href(record),
        });
        origin.updatedAt = now();
      }
    }
    record.returnedAt = now();
  }

  async function settle(record) {
    if (!OPEN.has(record.status) && record.status !== "approval_pending") return record;
    if (record.status === "approval_pending") return record;
    const session = sessionOf(record.targetSessionId);
    if (!session) {
      record.status = "missing_target";
      record.error = "The destination session is gone.";
      record.updatedAt = now();
      return record;
    }
    // A queued follow-up is not the answer until the target actually runs it.
    if (record.pendingQueue) {
      const depth = (session.queuedMessages ?? []).length;
      if (depth < (record.queueDepth ?? Infinity)) {
        record.pendingQueue = false;
        // Replies belong to the turn that consumed the queue, and that turn's
        // start is recorded even when its reply already exists by the time the
        // UI polls. Using reconcile time here would drop a fast reply.
        record.deliveredAt = Number(session.turnStartedAt) || now();
        record.status = "delivered";
      } else if (["failed", "error", "stopped", "complete"].includes(session.status)) {
        // The queue was dropped or the session ended without consuming it.
        record.status = "interrupted";
        record.error = "The destination stopped before reading this request.";
        record.updatedAt = now();
        return record;
      } else {
        // Between turns the queue is briefly idle; it is still the next work.
        record.status = "queued";
        record.updatedAt = now();
        return record;
      }
    }
    if (isBusy(session)) {
      record.status = "delivered";
      record.updatedAt = now();
      return record;
    }
    const answer = answered(session, record);
    if (answer) {
      record.status = "replied";
      record.answer = clean(answer.text, 4000);
      record.answerMessageId = answer.id;
      record.answeredAt = answer.at ?? now();
      record.updatedAt = now();
      await returnAnswer(record, answer);
      return record;
    }
    if (["failed", "error", "stopped", "complete", "ready"].includes(session.status)) {
      const last = (session.messages ?? [])
        .filter((m) => ["agent", "system"].includes(m.role))
        .at(-1);
      record.status = session.status === "complete" ? "interrupted" : "interrupted";
      record.error =
        session.failureKind === "stopped"
          ? "The destination stopped before replying."
          : last?.text
            ? clean(last.text, 1200)
            : "The destination finished without a reply.";
      record.updatedAt = now();
      return record;
    }
    return record;
  }

  async function reconcile() {
    let changed = false;
    for (const record of records()) {
      if (!OPEN.has(record.status)) continue;
      if (
        record.source.kind === "assistant" &&
        !state.assistantThreads?.some((t) => t.id === record.source.id)
      ) {
        // Deleting an assistant chat leaves delivered work alone but cancels drafts.
        if (record.status === "approval_pending") {
          record.status = "cancelled";
          record.updatedAt = now();
          changed = true;
        }
        continue;
      }
      const before = `${record.status}:${record.answer ?? ""}:${record.returnedAt ?? 0}`;
      await settle(record);
      if (`${record.status}:${record.answer ?? ""}:${record.returnedAt ?? 0}` !== before)
        changed = true;
    }
    if (changed) {
      await save();
      emit("workspace:handoffs");
    }
    return { changed };
  }

  async function deliver(record) {
    const source = record.source;
    if (record.existingSession) {
      const target = record.targetSessionId ? sessionOf(record.targetSessionId) : null;
      if (!target)
        throw Object.assign(new Error("The destination session is gone."), { status: 404 });
      const depth = (target.queuedMessages ?? []).length;
      const busy = isBusy(target);
      const message = await sendToSession(target, `[From ${source.label}]\n\n${record.request}`, {
        handoffId: record.id,
        source: { kind: source.kind, id: source.id, label: source.label, href: originHref(source) },
      });
      record.targetSessionId = target.id;
      record.targetProjectId = target.projectId;
      record.targetMessageId = message?.id ?? (target.messages ?? []).at(-1)?.id ?? null;
      record.queueDepth = busy ? depth + 1 : null;
      record.pendingQueue = busy;
      record.deliveredAt = busy ? null : (message?.at ?? now());
      record.status = busy ? "queued" : "delivered";
      record.updatedAt = now();
      return record;
    }
    // A new session is one complete turn in the destination project.
    const session = await projectStart({
      projectId: record.targetProjectId,
      request: record.request,
      permission: record.permission,
      createdBy: source.kind === "assistant" ? "workspace-assistant" : source.id,
      source: { kind: source.kind, id: source.id, label: source.label },
      handoffId: record.id,
    });
    record.targetSessionId = session.id;
    record.targetMessageId = session.messages?.[0]?.id ?? null;
    // The first reply of the new session is this request's answer even if it
    // started emitting before this call returned.
    record.deliveredAt = session.createdAt ?? session.messages?.[0]?.at ?? now();
    record.status = "delivered";
    record.updatedAt = now();
    return record;
  }

  async function createForTarget(
    source,
    target,
    deliveryKey,
    { confirmed = false, attempt = 1 } = {},
  ) {
    const project = target.projectId ? visibleProject(target.projectId) : null;
    const existing = records().find(
      (record) =>
        record.deliveryKey === deliveryKey &&
        (target.sessionId
          ? record.targetSessionId === target.sessionId
          : record.targetProjectId === target.projectId),
    );
    if (existing) return { record: existing, duplicate: true };

    const request = clean(target.request);
    if (request.length < 2)
      throw Object.assign(new Error("Describe the request in at least two characters."), {
        status: 400,
      });
    if (refuseRisk(request))
      throw Object.assign(new Error("This request needs ADE's explicit project approval flow."), {
        status: 403,
      });
    const targetSession = target.sessionId ? sessionOf(target.sessionId) : null;
    if (target.sessionId && !targetSession)
      throw Object.assign(new Error("The destination session is gone."), { status: 404 });
    const targetProject = project ?? (targetSession ? projectOf(targetSession.projectId) : null);
    if (!targetProject)
      throw Object.assign(new Error("Select a registered project to receive this request."), {
        status: 400,
      });

    const targetPermission = targetSession
      ? (targetSession.permission ?? "build")
      : (target.permission ?? (source.kind === "session" ? source.permission : "build"));
    // A child session inherits the initiator's permission ceiling.
    const permission =
      source.kind === "session" && comparePermission(targetPermission, source.permission) === 1
        ? source.permission
        : targetPermission;
    const rise = comparePermission(permission, source.permission);
    const origin = source.kind === "session" ? sessionOf(source.id) : null;
    const messagesSinceUser = origin
      ? (origin.messages ?? []).filter(
          (message) => (message.at ?? 0) > (origin.lastUserMessageAt ?? 0),
        ).length
      : 0;
    const chainLimited = messagesSinceUser >= 20;
    const needsApproval = !confirmed && (chainLimited || rise === 1 || rise === null);

    const record = {
      id: id(),
      deliveryKey,
      source: {
        kind: source.kind,
        id: source.id,
        label: source.label,
        permission: source.permission,
      },
      targetProjectId: targetProject.id,
      targetProjectName: targetProject.name,
      targetSessionId: targetSession?.id ?? null,
      existingSession: !!targetSession,
      request,
      permission,
      status: needsApproval ? "approval_pending" : "queued",
      approval: {
        required: needsApproval,
        decision: needsApproval ? null : "approved",
        reason: chainLimited ? "chain" : rise === 1 || rise === null ? "permission" : null,
      },
      attempt,
      previousId: null,
      createdAt: now(),
      updatedAt: now(),
    };
    records().push(record);
    if (needsApproval) return { record, duplicate: false };
    try {
      await deliver(record);
    } catch (error) {
      record.status = "failed";
      record.error = error.message ?? String(error);
      record.updatedAt = now();
    }
    return { record, duplicate: false };
  }

  /**
   * Send one request to one or more destinations. A retried delivery key is
   * idempotent; each target keeps its own outcome.
   */
  async function dispatch(input = {}) {
    const source = describeSource(state, input.source);
    if (!source)
      throw Object.assign(new Error("Start from a workspace chat or an open project session."), {
        status: 400,
      });
    const targets = Array.isArray(input.targets) ? input.targets.slice(0, 5) : [];
    if (!targets.length)
      throw Object.assign(new Error("Choose at least one destination."), { status: 400 });
    const deliveryKey = clean(input.deliveryKey, 160) || id();
    const results = [];
    for (const target of targets) {
      try {
        const { record } = await createForTarget(source, target, deliveryKey, {
          confirmed: input.confirmed === true,
        });
        results.push(recordOut(record));
      } catch (error) {
        results.push({
          id: id(),
          status: "failed",
          error: error.message ?? String(error),
          source,
          targetProjectId: target.projectId ?? null,
          targetSessionId: target.sessionId ?? null,
          request: clean(target.request),
          createdAt: now(),
          updatedAt: now(),
        });
      }
    }
    await save();
    emit("workspace:handoffs");
    return { handoffs: results };
  }

  async function decide(handoffId, input = {}) {
    const record = records().find((item) => item.id === handoffId);
    if (!record) throw Object.assign(new Error("Handoff not found."), { status: 404 });
    if (record.status !== "approval_pending")
      throw Object.assign(new Error("This handoff is not waiting for approval."), { status: 409 });
    if (input.request !== undefined) record.request = clean(input.request);
    if (input.decision === "decline") {
      record.status = "declined";
      record.approval.decision = "declined";
      record.updatedAt = now();
    } else if (input.decision === "send") {
      record.approval.decision = "approved";
      record.status = "queued";
      record.updatedAt = now();
      try {
        await deliver(record);
      } catch (error) {
        record.status = "failed";
        record.error = error.message ?? String(error);
      }
    } else throw Object.assign(new Error("Choose send or decline."), { status: 400 });
    await save();
    emit("workspace:handoffs");
    return { handoff: recordOut(record) };
  }

  /** A deliberate retry gets a fresh attempt linked to the first. */
  async function retry(handoffId) {
    await reconcile();
    const previous = records().find((item) => item.id === handoffId);
    if (!previous) throw Object.assign(new Error("Handoff not found."), { status: 404 });
    if (!["failed", "interrupted", "missing_target"].includes(previous.status))
      throw Object.assign(new Error("Only a failed or interrupted handoff can be retried."), {
        status: 409,
      });
    const sameSession =
      previous.existingSession && previous.targetSessionId && sessionOf(previous.targetSessionId);
    const { record } = await createForTarget(
      previous.source,
      {
        projectId: previous.targetProjectId,
        sessionId: sameSession ? previous.targetSessionId : undefined,
        request: previous.request,
        permission: previous.permission,
      },
      // Stable per source handoff: a double-clicked or retried HTTP request
      // matches the first retry instead of starting a second turn.
      `${previous.deliveryKey}:retry:${previous.id}`,
      { confirmed: true, attempt: (previous.attempt ?? 1) + 1 },
    );
    record.previousId = previous.id;
    previous.status = "retried";
    previous.updatedAt = now();
    await save();
    emit("workspace:handoffs");
    return { handoff: recordOut(record) };
  }

  async function list(options = {}) {
    await reconcile();
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 40));
    return {
      handoffs: records()
        .filter((record) => !options.sourceThreadId || record.source.id === options.sourceThreadId)
        .filter(
          (record) => !options.sourceSessionId || record.source.id === options.sourceSessionId,
        )
        .filter((record) => !options.status || record.status === options.status)
        .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
        .slice(0, limit)
        .map(recordOut),
    };
  }

  /** Capability for one project turn: its tools act as that session, never wider. */
  function sessionCapability(session) {
    const address = getAppAddress();
    if (!address) return undefined;
    const token = `${id()}${id()}`;
    tokens.set(token, { sessionId: session.id, createdAt: now() });
    if (tokens.size > 200) {
      const cutoff = now() - 6 * 60 * 60 * 1000;
      for (const [key, value] of tokens) if (value.createdAt < cutoff) tokens.delete(key);
    }
    return {
      url: `${address}/api/workspace/assistant/tool-call`,
      token,
      threadId: session.id,
      node: process.execPath,
    };
  }

  async function callSessionTool(threadId, token, name, args = {}) {
    const entry = token ? tokens.get(token) : null;
    const session = entry ? sessionOf(entry.sessionId) : null;
    if (!entry || !session || entry.sessionId !== threadId || !isBusy(session))
      throw Object.assign(new Error("Workspace tool capability expired."), { status: 403 });
    const source = describeSource(state, { kind: "session", id: session.id });
    const { runWorkspaceTool } = await import("./workspace-tools.mjs");
    return runWorkspaceTool(name, args, {
      state,
      source,
      pendingPermissions: (sessionId) => sessionOf(sessionId)?.pendingPermissions ?? [],
      dispatchAction: async (action, values) => {
        if (action === "workspace_start_project" || action === "workspace_message_session") {
          const target =
            action === "workspace_start_project"
              ? {
                  projectId: values.projectId,
                  request: values.request,
                  permission: values.permission,
                }
              : { sessionId: values.sessionId, request: values.text };
          const result = await dispatch({ source: inputSource(source), targets: [target] });
          const handoff = result.handoffs[0];
          return {
            handoffId: handoff.id,
            status: handoff.status,
            sessionId: handoff.targetSessionId,
            projectId: handoff.targetProjectId,
            href: handoff.href,
            ...(handoff.status === "approval_pending"
              ? { note: "The owner must confirm this request in the workspace before it is sent." }
              : {}),
          };
        }
        if (!sessionAction) throw new Error("This workspace action is unavailable.");
        return sessionAction(action, values, source);
      },
    });
  }

  return {
    dispatch,
    decide,
    retry,
    list,
    reconcile,
    sessionCapability,
    callSessionTool,
    cancelForSource: async (sourceId) => {
      let changed = false;
      for (const record of records())
        if (record.source.id === sourceId && record.status === "approval_pending") {
          record.status = "cancelled";
          record.updatedAt = now();
          changed = true;
        }
      if (changed) await save();
      return { changed };
    },
  };
}

/** Normalize a resolved source back into the shape `dispatch` accepts. */
function inputSource(source) {
  return { kind: source.kind, id: source.id };
}
