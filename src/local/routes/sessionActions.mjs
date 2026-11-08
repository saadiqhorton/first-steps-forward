import { adapters } from "../adapters/index.mjs";
import { getDiff } from "../project-git.mjs";
import { addMessage } from "../session-turns.mjs";
import { MODEL_ID } from "../models.mjs";
import { resolveAttachments } from "../attachments.mjs";
import { body } from "../http.mjs";

/** `/api/sessions/:id/*`: logs, follow-ups and actions, the diff, and model or option changes. */
export async function sessionActions(ctx) {
  const {
    req,
    res,
    url,
    parts,
    DATA_DIR,
    sessionLogs,
    state,
    turns,
    now,
    UNSUPPORTED_RISK,
    save,
    resolveSessionOptions,
    devApprovals,
    json,
  } = ctx;
  if (
    req.method === "GET" &&
    parts[0] === "sessions" &&
    parts.length === 3 &&
    parts[2] === "logs"
  ) {
    const session = state.sessions.find((item) => item.id === parts[1]);
    if (!session) return json(res, 404, { error: "Session not found." });
    const rawAfter = url.searchParams.get("after") ?? "0";
    const after = Number(rawAfter);
    if (!Number.isSafeInteger(after) || after < 0)
      return json(res, 400, { error: "Invalid log cursor." });
    await sessionLogs.flush(session.id);
    return json(res, 200, await sessionLogs.read(session.id, after));
  }
  if (req.method === "POST" && parts[0] === "sessions" && parts.length === 3) {
    const s = state.sessions.find((x) => x.id === parts[1]);
    if (!s) {
      const known = [
        "messages",
        "switch-agent",
        "stop",
        "permission",
        "complete",
        "reopen",
        "checks",
      ];
      if (known.includes(parts[2])) return json(res, 404, { error: "Session not found." });
    } else if (parts[2] === "messages") {
      const data = await body(req);
      if (data.when === "drop") return json(res, 200, await turns.drop(s));
      if (data.when === "release") return json(res, 200, await turns.release(s));
      const text = String(data.text ?? "").trim();
      if (!text) return json(res, 400, { error: "Message cannot be empty." });
      if (UNSUPPORTED_RISK.test(text))
        return json(res, 403, {
          error:
            "ADE cannot mediate this destructive or external action's approval flow yet; the message was not sent.",
        });
      if (s.status === "complete")
        return json(res, 409, { error: "Reopen this session before sending a message." });
      const attachmentIds = Array.isArray(data.attachmentIds) ? data.attachmentIds : [];
      let files = [];
      try {
        files = attachmentIds.length
          ? await resolveAttachments(DATA_DIR, attachmentIds, { includeBytes: false })
          : [];
      } catch (error) {
        if (error?.status) return json(res, error.status, { error: error.message });
        throw error;
      }
      // "now" stops the current turn (or checks) and runs this message as
      // soon as it has stopped; otherwise it waits for the turn to end.
      const when = data.when === "now" ? "now" : "later";
      return json(res, 200, await turns.send(s, { text, files }, when));
    } else if (parts[2] === "switch-agent") {
      const data = await body(req);
      if (s.status === "complete")
        return json(res, 409, { error: "Reopen this session before switching agents." });
      if (turns.isBusy(s))
        return json(res, 409, {
          error: "Stop or wait for the current CLI turn to finish before switching agents.",
        });
      const agentId = String(data.agentId ?? "");
      if (!adapters[agentId])
        return json(res, 400, {
          error: `Unknown agent. Available: ${Object.keys(adapters).join(", ")}.`,
        });
      const model = String(data.model ?? "").trim();
      if (model && !MODEL_ID.test(model))
        return json(res, 400, {
          error:
            "Model ids must start with a letter or digit and may then contain letters, digits, and . _ / : [ ] - + (max 256 characters), so they can never read as a CLI flag. Nothing was changed.",
        });
      const optionInput = {};
      const cleared = new Set();
      for (const key of ["effort", "speed", "permission"]) {
        const raw = data[key];
        if (raw === undefined || raw === null || raw === "") cleared.add(key);
        else optionInput[key] = raw;
      }
      const optionCheck = await resolveSessionOptions(agentId, model || undefined, optionInput);
      if (!optionCheck.ok) return json(res, 400, { error: optionCheck.error });
      const switched = await turns.switchAgent(s, agentId, {
        model: model || undefined,
        options: optionCheck.value,
        cleared,
      });
      return json(res, 200, { ...switched, carriesConversation: false });
    } else if (parts[2] === "stop") {
      return json(res, 200, await turns.stop(s));
    } else if (parts[2] === "permission") {
      const data = await body(req);
      const asked = (s.pendingPermissions ?? []).find((p) => p.id === data.requestId);
      // ADE's own "Run this dev command?" question: Allow stores the project's dev command.
      if (asked?.kind === "dev_command") {
        if (!["allow", "deny"].includes(data.optionId))
          return json(res, 400, { error: 'Answer "allow" or "deny".' });
        const project = state.projects.find((p) => p.id === s.projectId);
        if (!project) return json(res, 404, { error: "Project not found." });
        await devApprovals.answer(project, asked.id, data.optionId === "allow");
        return json(res, 200, s);
      }
      return json(res, 200, await turns.answer(s, data.requestId, data.optionId));
    } else if (parts[2] === "complete") {
      const completed = await turns.complete(s);
      // A completed session no longer asks anything.
      if (completed.pendingPermissions) {
        devApprovals.cancelForSession(completed);
        await save();
      }
      return json(res, 200, completed);
    } else if (parts[2] === "reopen") {
      return json(res, 200, await turns.reopen(s));
    } else if (parts[2] === "checks") {
      return json(res, 200, await turns.runChecks(s));
    }
  }
  if (req.method === "GET" && parts[0] === "sessions" && parts[2] === "diff") {
    const s = state.sessions.find((x) => x.id === parts[1]);
    const p = state.projects.find((x) => x.id === s?.projectId);
    if (!p) return json(res, 404, { error: "Session not found." });
    return json(res, 200, await getDiff(p));
  }
  if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "model") {
    const s = state.sessions.find((x) => x.id === parts[1]);
    if (!s) return json(res, 404, { error: "Session not found." });
    const data = await body(req);
    // Same sanitize as session creation. "" or null clears back to the
    // agent's own configured default (an absent field means default).
    const model = String(data.model ?? "").trim();
    if (model && !MODEL_ID.test(model))
      return json(res, 400, {
        error:
          "Model ids must start with a letter or digit and may then contain letters, digits, and . _ / : [ ] - + (max 256 characters), so they can never read as a CLI flag. Nothing was changed.",
      });
    if (s.status === "complete")
      return json(res, 409, { error: "Reopen this session before changing its model." });
    // OpenCode's proven set-override pattern: only rewrite when the value
    // actually differs; applying at the next turn is inherent because
    // each turn reads session.model when it starts the CLI.
    const previousModel = s.model ?? null;
    const changed = previousModel !== (model || null);
    if (changed) {
      if (model) s.model = model;
      else delete s.model;
      addMessage(
        s,
        "system",
        model
          ? `Model set to "${model}". It applies from the next CLI turn; a turn already running keeps its current model. The current conversation continues — per-CLI semantics of changing models mid-conversation are not verified; the CLI may treat context differently under the new model.`
          : `Model cleared; the next turn uses ${s.agentId}'s configured default. A turn already running keeps its current model.`,
      );
      s.updatedAt = now();
      await save();
    }
    // Accepted even while a turn runs: it takes effect on the next turn.
    // The response reports both the old and new effective values.
    return json(res, 200, { ...s, model: s.model ?? null, previousModel });
  }
  if (req.method === "POST" && parts[0] === "sessions" && parts[2] === "options") {
    const s = state.sessions.find((x) => x.id === parts[1]);
    if (!s) return json(res, 404, { error: "Session not found." });
    const data = await body(req);
    if (s.status === "complete")
      return json(res, 409, {
        error: "Reopen this session before changing its model or options.",
      });
    const modelProvided = Object.prototype.hasOwnProperty.call(data, "model");
    let nextModel = s.model;
    if (modelProvided) {
      const model = String(data.model ?? "").trim();
      if (model && !MODEL_ID.test(model))
        return json(res, 400, {
          error:
            "Model ids must start with a letter or digit and may then contain letters, digits, and . _ / : [ ] - + (max 256 characters), so they can never read as a CLI flag. Nothing was changed.",
        });
      nextModel = model || undefined;
    }
    const cleared = new Set();
    const optionInput = {};
    for (const key of ["effort", "speed", "permission"]) {
      if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
      const raw = data[key];
      if (raw === undefined || raw === null || raw === "") cleared.add(key);
      else optionInput[key] = raw;
    }
    const optionCheck = await resolveSessionOptions(s.agentId, nextModel, optionInput);
    if (!optionCheck.ok) return json(res, 400, { error: optionCheck.error });
    const previousModel = s.model ?? null;
    let changed = false;
    if (modelProvided && previousModel !== (nextModel ?? null)) {
      if (nextModel) s.model = nextModel;
      else delete s.model;
      changed = true;
      addMessage(
        s,
        "system",
        nextModel
          ? `Model set to "${nextModel}". It applies from the next CLI turn; a turn already running keeps its current model. The current conversation continues — per-CLI semantics of changing models mid-conversation are not verified; the CLI may treat context differently under the new model.`
          : `Model cleared; the next turn uses ${s.agentId}'s configured default. A turn already running keeps its current model.`,
      );
    }
    const before = {
      effort: s.effort,
      speed: s.speed,
      permission: s.permission,
    };
    syncOptionFields(s, optionCheck.value, cleared);
    if (
      before.effort !== s.effort ||
      before.speed !== s.speed ||
      before.permission !== s.permission
    ) {
      changed = true;
      const bits = [];
      if (optionCheck.value.effort || cleared.has("effort"))
        bits.push(
          cleared.has("effort") ? "effort cleared" : `effort "${optionCheck.value.effort}"`,
        );
      if (optionCheck.value.speed || cleared.has("speed"))
        bits.push(cleared.has("speed") ? "speed cleared" : `speed "${optionCheck.value.speed}"`);
      if (optionCheck.value.permission || cleared.has("permission"))
        bits.push(
          cleared.has("permission")
            ? "permission cleared"
            : `permission "${optionCheck.value.permission}"`,
        );
      if (bits.length)
        addMessage(
          s,
          "system",
          `Options updated (${bits.join(", ")}). They apply from the next CLI turn; a turn already running keeps its current options.`,
        );
    }
    if (changed) {
      s.updatedAt = now();
      await save();
    }
    return json(res, 200, {
      ...s,
      model: s.model ?? null,
      previousModel,
    });
  }
  return ctx.handled || res.writableEnded;
}

function syncOptionFields(session, value, cleared) {
  for (const key of ["effort", "speed", "permission"]) {
    if (cleared.has(key)) delete session[key];
    else if (value[key] !== undefined) session[key] = value[key];
  }
}
