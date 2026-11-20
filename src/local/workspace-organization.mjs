import { isHiddenProject, isHiddenSession } from "./customize/paths.mjs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const ensure = (state) => {
  // Saved workspace files predate some of these maps, and a concurrent writer
  // may save a partial object. Initialize each key on its own so a missing
  // `workflowStarts` never takes down the inbox with "not iterable".
  const organization = (state.workspaceOrganization ??= {});
  organization.reads ??= {};
  organization.snoozes ??= {};
  organization.snoozeTombstones ??= {};
  organization.pinTombstones ??= {};
  organization.projectPins ??= [];
  organization.workflowStarts ??= [];
  organization.projectSettings ??= {};
  organization.unread ??= {};
  return organization;
};
const text = (v, max = 1000) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
const orderPins = (state) => ensure(state).projectPins;

export function createWorkspaceOrganization({
  state,
  save,
  id,
  now,
  turns,
  devApprovals,
  devicePolicy = () => true,
  projectStart,
  emit = () => {},
}) {
  const data = () => ensure(state);
  async function inbox(options = {}) {
    await reconcile();
    const q = text(options.query, 160).toLowerCase();
    const projectId = options.projectId || "";
    const includeSnoozed =
      options.includeSnoozed === true ||
      options.includeSnoozed === "true" ||
      options.includeSnoozed === "1" ||
      !!q;
    const includeCompleted =
      options.includeCompleted === true ||
      options.includeCompleted === "true" ||
      options.includeCompleted === "1" ||
      !!q;
    const statusFilter = text(options.status, 40);
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 50));
    const offset = Math.max(0, Number(options.cursor) || 0);
    const rows = state.sessions.filter(
      (s) =>
        !isHiddenSession(state, s) &&
        (!projectId || s.projectId === projectId) &&
        (!q ||
          `${s.request} ${s.summary ?? ""} ${(s.messages ?? []).map((m) => m.text).join(" ")}`
            .toLowerCase()
            .includes(q)),
    );
    const snoozed = data().snoozes;
    const unreadMarkers = data().unread;
    const groups = {
      pinned: [],
      pending: [],
      failed: [],
      unread: [],
      active: [],
      ready: [],
      snoozed: [],
      completed: [],
    };
    for (const s of rows) {
      // A durable "mark unread" marker wins over any older read cursor, so a
      // stale read saved by another ADE process cannot clear it on merge.
      const unreadAt = unreadMarkers[s.id];
      const row = {
        id: s.id,
        sessionId: s.id,
        projectId: s.projectId,
        request: s.request,
        title: s.request,
        summary: s.summary,
        status: s.status,
        updatedAt: s.updatedAt,
        readAt: unreadAt ? 0 : (data().reads[s.id] ?? 0),
        manualUnread: !!unreadAt,
        snooze: snoozed[s.id],
      };
      if (
        includeSnoozed &&
        row.snooze &&
        !row.snooze.returnedAt &&
        (row.snooze.until === "finished" || row.snooze.until > now())
      )
        groups.snoozed.push(row);
      else if (s.status === "complete") {
        if (includeCompleted) groups.completed.push(row);
      } else if (
        row.snooze &&
        !row.snooze.returnedAt &&
        (row.snooze.until === "finished" || row.snooze.until > now())
      )
        continue;
      else if (s.pendingPermissions?.length || s.pendingQuestion) groups.pending.push(row);
      else if (
        ["failed", "error"].includes(s.status) ||
        s.checks?.some((c) => c.status === "failed")
      )
        groups.failed.push(row);
      else if (
        !!unreadAt ||
        ((s.updatedAt ?? 0) > row.readAt &&
          (s.messages ?? []).some((m) => ["agent", "assistant"].includes(m.role))) ||
        row.snooze?.returnedAt
      )
        groups.unread.push(row);
      else if (turns.isBusy(s)) groups.active.push(row);
      else groups.ready.push(row);
      if (orderPins(state).some((p) => p.sessionId === s.id)) groups.pinned.push(row);
    }
    // ADE can hold one dev-command approval at project scope when there is no
    // session attached to the proposal. It still belongs in the live queue.
    for (const project of state.projects) {
      if (isHiddenProject(project)) continue;
      if (projectId && project.id !== projectId) continue;
      const approval = devApprovals?.unattached?.(project.id);
      if (!approval) continue;
      const summary = String(approval.command ?? approval.summary ?? "Run a development command?");
      if (q && !`${project.name} ${project.path} ${summary}`.toLowerCase().includes(q)) continue;
      groups.pending.push({
        id: `project:${project.id}`,
        sessionId: null,
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        title: "Development command needs approval",
        request: summary,
        status: "awaiting_input",
        updatedAt: approval.createdAt ?? now(),
        href: `/p/${encodeURIComponent(project.id)}/conversations`,
        kind: "project-dev-command",
      });
    }
    for (const key of Object.keys(groups))
      groups[key].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    if (statusFilter && Object.hasOwn(groups, statusFilter))
      for (const key of Object.keys(groups)) if (key !== statusFilter) groups[key] = [];
    const flat = Object.entries(groups).flatMap(([group, items]) =>
      items.map((item) => ({ ...item, group })),
    );
    const page = flat.slice(offset, offset + limit);
    const paged = Object.fromEntries(
      Object.keys(groups).map((k) => [k, page.filter((x) => x.group === k)]),
    );
    return {
      groups: paged,
      totals: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
      nextCursor: offset + limit < flat.length ? String(offset + limit) : null,
    };
  }
  async function markRead(sessionId, readAt = now()) {
    if (!state.sessions.some((s) => s.id === sessionId))
      throw Object.assign(new Error("Session not found."), { status: 404 });
    delete data().unread[sessionId];
    data().reads[sessionId] = Number(readAt) || now();
    if (data().snoozes[sessionId]?.returnedAt) {
      data().snoozeTombstones ??= {};
      data().snoozeTombstones[sessionId] = now();
      delete data().snoozes[sessionId];
    }
    await save();
    emit("workspace:inbox");
    return { readAt: data().reads[sessionId] };
  }
  async function snooze(sessionId, until, preset) {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s) throw Object.assign(new Error("Session not found."), { status: 404 });
    if (until !== "finished") {
      until = Number(until);
      if (!Number.isFinite(until) || until <= now())
        throw Object.assign(new Error("Choose a future wake time."), { status: 400 });
    }
    data().snoozes[sessionId] = { until, preset: preset ?? null, createdAt: now() };
    await save();
    emit("workspace:inbox");
    return { snooze: data().snoozes[sessionId] };
  }
  async function unsnooze(sessionId) {
    data().snoozeTombstones ??= {};
    data().snoozeTombstones[sessionId] = now();
    delete data().snoozes[sessionId];
    await save();
    emit("workspace:inbox");
    return { snoozed: false };
  }
  async function bulk(actions = []) {
    if (!Array.isArray(actions))
      throw Object.assign(new Error("Actions must be a list."), { status: 400 });
    const results = [];
    for (const a of actions.slice(0, 100))
      try {
        const s = state.sessions.find((x) => x.id === a.sessionId);
        if (!s) throw Object.assign(new Error("Session not found."), { status: 404 });
        let result;
        switch (a.action) {
          case "read":
            result = await markRead(s.id);
            break;
          case "unread":
            // A read cursor of 0 alone is not durable: the next cross-process
            // merge takes the max read and restores the old value. The marker
            // is a timestamp that only markRead removes.
            data().unread[s.id] = now();
            await save();
            result = { unread: true };
            break;
          case "pin": {
            const pins = orderPins(state);
            pins.splice(Math.max(0, Math.min(pins.length, Number(a.position) || 0)), 0, {
              sessionId: s.id,
              position: Number(a.position) || 0,
              updatedAt: now(),
            });
            await save();
            result = { pinned: true };
            break;
          }
          case "unpin":
            data().pinTombstones ??= {};
            data().pinTombstones[s.id] = now();
            data().projectPins = data().projectPins.filter((p) => p.sessionId !== s.id);
            await save();
            result = { pinned: false };
            break;
          case "snooze":
            result = await snooze(s.id, a.until, a.preset);
            break;
          case "unsnooze":
            result = await unsnooze(s.id);
            break;
          case "complete":
            if (
              s.pendingPermissions?.length ||
              s.pendingQuestion ||
              devApprovals?.forSession?.(s.id)
            )
              throw Object.assign(
                new Error("Resolve pending questions before completing this session."),
                { status: 409 },
              );
            result = await turns.complete(s);
            break;
          case "reopen":
            result = await turns.reopen(s);
            break;
          default:
            throw Object.assign(new Error("Unknown inbox action."), { status: 400 });
        }
        results.push({ sessionId: s.id, ok: true, result });
      } catch (e) {
        results.push({
          sessionId: a.sessionId,
          ok: false,
          error: e.message,
          status: e.status || 400,
        });
      }
    await save();
    emit("workspace:inbox");
    return { results };
  }
  function frequent() {
    const since = now() - 30 * 86400000,
      counts = new Map();
    for (const item of data().workflowStarts)
      if (item.startedAt >= since) {
        const k = `${item.projectId}\0${item.workflowId}`;
        const x = counts.get(k) ?? {
          projectId: item.projectId,
          workflowId: item.workflowId,
          name: item.name,
          count: 0,
          lastStartedAt: 0,
        };
        x.count++;
        x.lastStartedAt = Math.max(x.lastStartedAt, item.startedAt);
        counts.set(k, x);
      }
    return [...counts.values()]
      .filter((x) => x.count >= 2)
      .sort((a, b) => b.count - a.count || b.lastStartedAt - a.lastStartedAt)
      .slice(0, 4);
  }
  async function launchWorkflow(workflowId, input = {}) {
    if (!devicePolicy(input.req, "start"))
      throw Object.assign(new Error("This device cannot start work."), { status: 403 });
    const project = state.projects.find((p) => p.id === input.projectId);
    if (!project) throw Object.assign(new Error("Project not found."), { status: 404 });
    const wf =
      (state.workflows ?? []).find((w) => w.id === workflowId) ??
      (await import("./workflows.mjs")).BUILT_IN_WORKFLOWS.find((w) => w.id === workflowId);
    if (!wf) throw Object.assign(new Error("Workflow not found."), { status: 404 });
    const request = text(input.request, 8000) || wf.prompt;
    if (!projectStart)
      throw Object.assign(new Error("Project start is unavailable."), { status: 503 });
    const session = await projectStart({
      projectId: project.id,
      request,
      agentId: input.agentId || wf.agentId || project.defaultAgent,
      model: input.model,
      effort: input.effort,
      permission: input.permission || wf.permission,
      workflowId,
      createdBy: "user",
    });
    data().workflowStarts.push({
      projectId: project.id,
      workflowId,
      name: wf.name,
      startedAt: now(),
      sessionId: session.id,
    });
    await save();
    emit("workspace:inbox");
    return { session, workflowId };
  }
  async function discoverProjects(root) {
    const base = await fs.realpath(path.resolve(root || os.homedir()));
    const stat = await fs.stat(base);
    if (!stat.isDirectory()) throw Object.assign(new Error("Not a folder."), { status: 400 });
    const entries = await fs.readdir(base, { withFileTypes: true });
    const projects = [];
    for (const ent of entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .slice(0, 300)) {
      const full = await fs.realpath(path.join(base, ent.name)).catch(() => null);
      if (!full) continue;
      const existing = state.projects.find((p) => p.path === full);
      projects.push({
        path: full,
        name: ent.name,
        alreadyRegistered: !!existing,
        ...(existing ? { projectId: existing.id } : {}),
      });
    }
    return { path: base, projects };
  }
  async function pinProject(projectId, pinned, position = 0) {
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) throw Object.assign(new Error("Project not found."), { status: 404 });
    if (!pinned) {
      data().pinTombstones ??= {};
      data().pinTombstones[projectId] = now();
    }
    data().projectPins = data().projectPins.filter((x) => x.projectId !== projectId);
    if (pinned)
      data().projectPins.splice(Math.max(0, Math.min(data().projectPins.length, position)), 0, {
        projectId,
        position,
        updatedAt: now(),
      });
    await save();
    emit("workspace:projects");
    return { project, pinned };
  }
  function projectSettings(projectId) {
    const p = state.projects.find((x) => x.id === projectId);
    if (!p) throw Object.assign(new Error("Project not found."), { status: 404 });
    const stored = data().projectSettings[projectId] ?? {
      revision: 0,
      instructions: p.workspaceInstructions ?? "",
      color: p.color ?? null,
      icon: p.icon ?? null,
      versions: [],
    };
    return { project: p, ...stored };
  }
  async function updateProjectSettings(projectId, input = {}) {
    const current = projectSettings(projectId);
    if (Number(input.expectedRevision) !== current.revision)
      throw Object.assign(new Error("Project settings changed. Reload and try again."), {
        status: 409,
      });
    const next = { ...current, revision: current.revision + 1 };
    delete next.project;
    if (input.instructions !== undefined) next.instructions = text(input.instructions, 20000);
    if (input.color !== undefined) {
      const c = String(input.color);
      if (!/^#[0-9a-f]{6}$/i.test(c))
        throw Object.assign(new Error("Color must be a six digit hex value."), { status: 400 });
      next.color = c;
    }
    if (input.icon !== undefined) {
      const icon = text(input.icon, 500);
      const emoji =
        icon &&
        /^\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*$/u.test(icon);
      if (
        icon &&
        !emoji &&
        !/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(icon) &&
        !/^https?:\/\//.test(icon)
      )
        throw Object.assign(new Error("Icon must be one emoji or an image data URL or URL."), {
          status: 400,
        });
      next.icon = icon || null;
    }
    next.versions = [
      ...(current.versions ?? []),
      {
        revision: next.revision,
        at: now(),
        instructions: next.instructions,
        color: next.color,
        icon: next.icon,
      },
    ].slice(-50);
    data().projectSettings[projectId] = next;
    const p = state.projects.find((x) => x.id === projectId);
    p.workspaceInstructions = next.instructions;
    p.color = next.color;
    p.icon = next.icon;
    await save();
    emit("workspace:projects");
    return {
      project: p,
      revision: next.revision,
      instructions: next.instructions,
      color: next.color,
      icon: next.icon,
      versions: next.versions,
    };
  }
  async function reconcile() {
    let changed = false;
    for (const [sid, snooze] of Object.entries(data().snoozes)) {
      if (snooze.returnedAt) continue;
      const session = state.sessions.find((x) => x.id === sid);
      const latestUser = (session?.messages ?? []).some(
        (m) => m.role === "user" && (m.at ?? 0) > snooze.createdAt,
      );
      const decision = !!(
        session?.pendingPermissions?.length ||
        session?.pendingQuestion ||
        session?.pendingDevCommand
      );
      const finished = snooze.until === "finished" && session && !turns.isBusy(session);
      if (
        (snooze.until !== "finished" && snooze.until <= now()) ||
        finished ||
        latestUser ||
        decision
      ) {
        snooze.returnedAt = now();
        changed = true;
      }
    }
    if (changed) await save();
    return { changed };
  }
  return {
    inbox,
    markRead,
    snooze,
    unsnooze,
    bulk,
    frequent,
    launchWorkflow,
    discoverProjects,
    pinProject,
    projectSettings,
    updateProjectSettings,
    recordStart(item) {
      data().workflowStarts.push({ ...item });
      return save();
    },
    reconcile,
  };
}
