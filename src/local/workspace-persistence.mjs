import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Preserve append-only session history when a dev-server reload has another in-memory snapshot. */
export function mergeWorkspaceMessages(current, saved) {
  for (const previous of saved.sessions ?? []) {
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

export async function reconcileWorkspaceMessages(file, current) {
  let saved;
  try {
    saved = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  mergeWorkspaceMessages(current, saved);
}

/** Serialize read/merge/write across Vite and SSR module instances sharing this file. */
export async function saveWorkspace(file, current) {
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
    await reconcileWorkspaceMessages(file, current);
    await fs.writeFile(
      tmp,
      JSON.stringify(
        { projects: current.projects, sessions: current.sessions, processes: current.processes },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true });
    await fs.rmdir(lock);
  }
}
