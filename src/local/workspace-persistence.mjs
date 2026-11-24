import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Preserve append-only session history another ADE process saved since this one loaded. */
export function mergeWorkspaceMessages(current, saved) {
  // Deletions win over a stale snapshot: two ADE processes may share ~/.ade, and
  // the one that removed a project must not have it (or its sessions) restored.
  const union = (a = {}, b = {}) => {
    const merged = { ...a };
    for (const [key, at] of Object.entries(b ?? {}))
      merged[key] = Math.max(Number(merged[key]) || 0, Number(at) || 0);
    return merged;
  };
  current.deletedProjects = union(current.deletedProjects, saved?.deletedProjects);
  current.deletedSessions = union(current.deletedSessions, saved?.deletedSessions);
  const deletedProjects = new Set(Object.keys(current.deletedProjects));
  const deletedSessions = new Set(Object.keys(current.deletedSessions));
  const alive = (projectId) => !deletedProjects.has(projectId);
  current.projects = (current.projects ?? []).filter((project) => alive(project.id));
  current.sessions = (current.sessions ?? []).filter(
    (session) => alive(session.projectId) && !deletedSessions.has(session.id),
  );
  for (const previous of saved.sessions ?? []) {
    if (!alive(previous.projectId) || deletedSessions.has(previous.id)) continue;
    let session = current.sessions.find((item) => item.id === previous.id);
    if (!session) {
      // Sessions are only removed by removing their project. Never resurrect a
      // session for a project that has deliberately been removed.
      if (!current.projects.some((project) => project.id === previous.projectId)) continue;
      current.sessions.push(previous);
      continue;
    }
    const ids = new Set((session.messages ?? []).map((message) => message.id));
    const missing = (previous.messages ?? []).filter((message) => !ids.has(message.id));
    const messages = [...(session.messages ?? []), ...missing].sort((a, b) => a.at - b.at);
    if ((previous.updatedAt ?? 0) > (session.updatedAt ?? 0)) {
      // Prefer the newer turn's status and metadata too, not just its text.
      for (const key of Object.keys(session)) if (!(key in previous)) delete session[key];
      Object.assign(session, previous);
    }
    session.messages = messages;
  }
}

/** Merge appendable workspace feature records by stable ID across ADE processes. */
export function mergeWorkspaceRecords(
  current,
  saved,
  namespaces = [
    "assistantThreads",
    "assistantMessages",
    "assistantActivity",
    "handoffs",
    "inboxState",
  ],
) {
  for (const namespace of namespaces) {
    if (!Array.isArray(saved?.[namespace])) continue;
    const live = Array.isArray(current[namespace]) ? current[namespace] : (current[namespace] = []);
    const byId = new Map(live.map((row) => [row.id, row]));
    for (const row of saved[namespace]) {
      const existing = byId.get(row.id);
      if (!existing) {
        live.push(row);
        byId.set(row.id, row);
      } else if ((row.updatedAt ?? row.at ?? 0) > (existing.updatedAt ?? existing.at ?? 0))
        Object.assign(existing, row);
    }
  }
  current.assistantDeleted ??= [];
  current.assistantDeleted = [
    ...new Set([...current.assistantDeleted, ...(saved?.assistantDeleted ?? [])]),
  ];
  const deleted = new Set(current.assistantDeleted);
  for (const namespace of ["assistantThreads", "assistantMessages", "assistantActivity"])
    current[namespace] = (current[namespace] ?? []).filter(
      (row) => !deleted.has(row.id) && !deleted.has(row.threadId),
    );
  const localOrg = current.workspaceOrganization ?? (current.workspaceOrganization = {});
  const diskOrg = saved?.workspaceOrganization ?? {};
  for (const mapName of [
    "reads",
    "unread",
    "snoozes",
    "snoozeTombstones",
    "pinTombstones",
    "projectSettings",
  ]) {
    const localMap = localOrg[mapName] ?? (localOrg[mapName] = {});
    for (const [key, incoming] of Object.entries(diskOrg[mapName] ?? {})) {
      const existing = localMap[key];
      if (existing === undefined) localMap[key] = incoming;
      else if (mapName === "reads" || mapName === "unread")
        localMap[key] = Math.max(Number(existing) || 0, Number(incoming) || 0);
      else if (mapName.endsWith("Tombstones"))
        localMap[key] = Math.max(Number(existing) || 0, Number(incoming) || 0);
      else if (mapName === "projectSettings")
        localMap[key] = (incoming.revision ?? 0) > (existing.revision ?? 0) ? incoming : existing;
      else if (
        (incoming?.at ?? incoming?.createdAt ?? 0) > (existing?.at ?? existing?.createdAt ?? 0)
      )
        localMap[key] = incoming;
    }
  }
  // A durable unread marker only means "unread after this read cursor". When a
  // newer read exists (for example, this process just marked it read) drop a
  // stale marker another process still has.
  for (const key of Object.keys(localOrg.unread ?? {}))
    if ((Number(localOrg.reads?.[key]) || 0) >= (Number(localOrg.unread[key]) || 0))
      delete localOrg.unread[key];
  for (const listName of ["projectPins", "workflowStarts"]) {
    const rows = localOrg[listName] ?? (localOrg[listName] = []);
    const keys = new Set(
      rows.map(
        (row) =>
          row.id ?? `${row.projectId ?? ""}\0${row.sessionId ?? ""}\0${row.workflowId ?? ""}`,
      ),
    );
    for (const row of diskOrg[listName] ?? []) {
      const key =
        row.id ?? `${row.projectId ?? ""}\0${row.sessionId ?? ""}\0${row.workflowId ?? ""}`;
      if (!keys.has(key)) {
        rows.push(row);
        keys.add(key);
      }
    }
  }
  const snoozeDeletes = new Set(Object.keys(localOrg.snoozeTombstones ?? {}));
  localOrg.snoozes = Object.fromEntries(
    Object.entries(localOrg.snoozes ?? {}).filter(
      ([key, value]) =>
        !snoozeDeletes.has(key) || (value?.createdAt ?? 0) > (localOrg.snoozeTombstones[key] ?? 0),
    ),
  );
  const pinDeletes = localOrg.pinTombstones ?? {};
  localOrg.projectPins = (localOrg.projectPins ?? []).filter(
    (row) => (row.updatedAt ?? 0) > (pinDeletes[row.projectId ?? row.sessionId] ?? 0),
  );
  for (const namespace of ["voice"]) {
    const previous = saved?.[namespace];
    if (!previous || typeof previous !== "object" || Array.isArray(previous)) continue;
    current[namespace] ??= {};
    for (const [key, value] of Object.entries(previous)) {
      if (current[namespace][key] === undefined) current[namespace][key] = value;
      else if (Array.isArray(value) && Array.isArray(current[namespace][key])) {
        const rows = current[namespace][key];
        const byId = new Map(rows.map((row) => [row?.id ?? row?.sessionId ?? row?.projectId, row]));
        for (const row of value) {
          const keyId = row?.id ?? row?.sessionId ?? row?.projectId;
          if (keyId && !byId.has(keyId)) rows.push(row);
        }
      } else if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        current[namespace][key] &&
        typeof current[namespace][key] === "object" &&
        !Array.isArray(current[namespace][key])
      ) {
        for (const [subkey, subvalue] of Object.entries(value))
          if (current[namespace][key][subkey] === undefined)
            current[namespace][key][subkey] = subvalue;
      }
    }
  }
}

/** What each in-memory workspace last wrote: that exact file needs no reading back. */
const lastWrites = new WeakMap();

async function fileSignature(file) {
  try {
    const stat = await fs.stat(file, { bigint: true });
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function reconcileWorkspaceMessages(file, current) {
  let saved;
  try {
    saved = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  mergeWorkspaceMessages(current, saved);
  mergeWorkspaceRecords(current, saved);
}

/**
 * Serialize read/merge/write across ADE processes sharing this file: a dev and a
 * production ADE (or a dev server mid-restart) may run against the same ~/.ade.
 */
export async function saveWorkspace(file, current, options = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  let acquired = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      await fs.mkdir(lock, { mode: 0o700 });
      acquired = true;
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      // An interrupted process may leave a lock. Remove it only after it has
      // been idle for a minute; normal writes take milliseconds.
      try {
        if (Date.now() - (await fs.stat(lock)).mtimeMs > 60_000) await fs.rmdir(lock);
      } catch (staleError) {
        if (staleError.code !== "ENOENT") throw staleError;
      }
      await wait(25);
    }
  }
  if (!acquired) throw new Error("ADE workspace is busy; could not safely save it.");
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    // Dev-command asks are memory-only (see dev-command.mjs). Reconcile can wipe
    // them when a newer disk snapshot lacks the field. Re-apply from the live
    // approvals map after reconcile so a concurrent save started before answer()
    // cannot resurrect a settled ask from a stale session snapshot.
    const pendingBefore = new Map(
      current.sessions
        .filter((session) => session.pendingDevCommand)
        .map((session) => [session.id, session.pendingDevCommand]),
    );
    // Reading and parsing a large workspace blocks the server, so it is done
    // only when another process wrote the file since this one did. Merging
    // with nothing still applies this process's own deletions.
    const signature = await fileSignature(file);
    if (signature !== null && lastWrites.get(current) === signature) {
      mergeWorkspaceMessages(current, {});
      mergeWorkspaceRecords(current, {});
    } else await reconcileWorkspaceMessages(file, current);
    const pendingDevCommands =
      typeof options.livePendingDevCommands === "function"
        ? options.livePendingDevCommands()
        : pendingBefore;
    for (const session of current.sessions) delete session.pendingDevCommand;
    for (const [id, request] of pendingDevCommands) {
      const session = current.sessions.find((item) => item.id === id);
      if (session) session.pendingDevCommand = request;
    }
    await fs.writeFile(
      tmp,
      JSON.stringify({
        projects: current.projects,
        sessions: current.sessions.map(
          ({ logs, pendingDevCommand: _pending, ...session }) => session,
        ),
        deletedProjects: current.deletedProjects ?? {},
        deletedSessions: current.deletedSessions ?? {},
        processes: current.processes,
        workflows: current.workflows ?? [],
        assistantThreads: current.assistantThreads ?? [],
        assistantMessages: current.assistantMessages ?? [],
        assistantActivity: current.assistantActivity ?? [],
        assistantDeleted: current.assistantDeleted ?? [],
        handoffs: current.handoffs ?? [],
        inboxState: current.inboxState ?? [],
        workspaceOrganization: current.workspaceOrganization ?? {},
        voice: current.voice ?? {},
        workspaceAssistant: current.workspaceAssistant ?? {},
      }),
      { mode: 0o600 },
    );
    await fs.rename(tmp, file);
    const written = await fileSignature(file);
    if (written) lastWrites.set(current, written);
  } finally {
    await fs.rm(tmp, { force: true });
    await fs.rmdir(lock);
  }
}
