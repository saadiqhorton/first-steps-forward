import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import pty from "node-pty";

const sessions = new Map();
const MAX_SESSIONS = 4;
const MAX_OUTPUT = 1024 * 1024;
const MAX_BATCH = 64 * 1024;
export const IDLE_MS = 2 * 60 * 1000;

export function terminalSize(cols, rows) {
  const c = Number(cols);
  const r = Number(rows);
  if (!Number.isInteger(c) || !Number.isInteger(r) || c < 20 || c > 400 || r < 5 || r > 150)
    return null;
  return { cols: c, rows: r };
}

export function openTerminal(cwd, size) {
  if (sessions.size >= MAX_SESSIONS)
    throw new Error("Too many open terminals. Close one and try again.");
  const shell =
    process.platform === "win32"
      ? process.env.COMSPEC || "powershell.exe"
      : process.env.SHELL || "/bin/sh";
  const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", ADE_TERMINAL: "1" };
  // ADE may have been started by npm; its prefix can interfere with the user's shell setup.
  delete env.npm_config_prefix;
  delete env.NPM_CONFIG_PREFIX;
  const child = pty.spawn(shell, [], { name: "xterm-256color", ...size, cwd, env });
  const session = {
    id: randomUUID(),
    child,
    output: [],
    nextCursor: 0,
    outputSize: 0,
    lastSeen: Date.now(),
    exited: false,
    exitCode: null,
    waiters: [],
  };
  child.onData((data) => {
    session.output.push({ cursor: ++session.nextCursor, data });
    session.outputSize += data.length;
    while (session.outputSize > MAX_OUTPUT && session.output.length > 1)
      session.outputSize -= session.output.shift().data.length;
    wake(session);
  });
  child.onExit(({ exitCode }) => {
    session.exited = true;
    session.exitCode = exitCode;
    wake(session);
  });
  sessions.set(session.id, session);
  return { id: session.id, shell: shell.split(/[\\/]/).at(-1), cwd, pid: child.pid };
}

function wake(session) {
  const waiters = session.waiters.splice(0);
  for (const waiter of waiters) waiter();
}

function snapshotTerminal(id, cursor = 0) {
  const session = sessions.get(id);
  if (!session) return null;
  session.lastSeen = Date.now();
  const first = session.output[0]?.cursor ?? session.nextCursor + 1;
  const truncated = cursor < first - 1;
  let data = "";
  let nextCursor = Math.max(cursor, first - 1);
  for (const chunk of session.output) {
    if (chunk.cursor <= nextCursor) continue;
    if (data && data.length + chunk.data.length > MAX_BATCH) break;
    data += chunk.data;
    nextCursor = chunk.cursor;
  }
  return {
    data,
    cursor: nextCursor,
    truncated,
    hasMore: nextCursor < session.nextCursor,
    exited: session.exited,
    exitCode: session.exitCode,
  };
}

// xterm shows the PTY echo, not the keystroke. A waiting read returns as soon
// as that echo arrives so typing is not stuck on the client's poll interval.
export function readTerminal(id, cursor = 0, waitMs = 0, signal) {
  const immediate = snapshotTerminal(id, cursor);
  const ready = (value) => value && (value.data || value.truncated || value.exited);
  if (!immediate || waitMs <= 0 || ready(immediate) || signal?.aborted)
    return Promise.resolve(immediate);
  const session = sessions.get(id);
  if (!session) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      const index = session.waiters.indexOf(finish);
      if (index >= 0) session.waiters.splice(index, 1);
      resolve(sessions.has(id) ? snapshotTerminal(id, cursor) : null);
    };
    session.waiters.push(finish);
    const timer = setTimeout(finish, waitMs);
    signal?.addEventListener("abort", finish, { once: true });
    if (!sessions.has(id) || ready(snapshotTerminal(id, cursor))) finish();
  });
}

export function writeTerminal(id, data) {
  const session = sessions.get(id);
  if (!session || session.exited) return false;
  session.lastSeen = Date.now();
  session.child.write(data);
  return true;
}

export function resizeTerminal(id, size) {
  const session = sessions.get(id);
  if (!session || session.exited) return false;
  session.lastSeen = Date.now();
  session.child.resize(size.cols, size.rows);
  return true;
}

// A PTY hangup stops the shell and foreground commands, but a job that ignores
// SIGHUP (for example `nohup command &`) can outlive it. Each PTY has its own
// Unix session, so snapshot its members before closing the PTY and terminate
// those jobs too. Include descendants that created a new session themselves.
function terminalProcessIds(shellPid) {
  if (process.platform === "win32") return [];
  try {
    const rows = execFileSync("ps", ["-eo", "pid=,ppid=,sess="], {
      encoding: "utf8",
      timeout: 1500,
      maxBuffer: 4 * 1024 * 1024,
    });
    const processes = rows.split("\n").map((line) => line.trim().split(/\s+/).map(Number));
    const ids = new Set([shellPid]);
    // A detached descendant may have left the original Unix session.
    for (let pass = 0; pass < processes.length; pass++) {
      let added = false;
      for (const [pid, parentPid] of processes) {
        if (pid > 0 && parentPid > 0 && !ids.has(pid) && ids.has(parentPid)) {
          ids.add(pid);
          added = true;
        }
      }
      if (!added) break;
    }
    return processes
      .filter(
        ([pid, , sessionId]) =>
          pid > 0 &&
          pid !== process.pid &&
          pid !== shellPid &&
          (sessionId === shellPid || ids.has(pid)),
      )
      .map(([pid]) => pid);
  } catch {
    return [];
  }
}

export function closeTerminal(id) {
  const session = sessions.get(id);
  if (!session) return false;
  sessions.delete(id);
  wake(session);
  const processIds = terminalProcessIds(session.child.pid);
  if (!session.exited) session.child.destroy();
  for (const pid of processIds) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // It may have exited during the PTY hangup.
    }
  }
  return true;
}

/** Close sessions whose lastSeen is older than IDLE_MS. `now` is injectable for tests. */
export function reapIdleTerminals(now = Date.now()) {
  for (const [id, session] of sessions) {
    if (now - session.lastSeen > IDLE_MS) closeTerminal(id);
  }
}

// An abandoned browser tab must not leave a shell running indefinitely.
const cleanup = setInterval(() => {
  reapIdleTerminals();
}, 30_000);
cleanup.unref();
