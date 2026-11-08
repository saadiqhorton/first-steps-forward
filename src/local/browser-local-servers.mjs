// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/server/src/preview/PortScanner.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
//
// Finds web servers already listening on this machine so the preview's empty state can offer
// them, as T3 does. Only loopback-reachable HTTP listeners are reported: a port that does not
// answer HTTP with a page is not a preview server (databases, SSH and the like stay out).

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CACHE_TTL_MS = 3_000;
const PROBE_TIMEOUT_MS = 1_000;
const READ_LIMIT_BYTES = 64 * 1024;
const MAX_SERVERS = 20;
// Privileged ports are system services, not the project's dev servers.
const MIN_PORT = 1024;
// Process names that are never a preview server even when they answer HTTP.
const IGNORED_PROCESSES = new Set([
  "cupsd",
  "systemd",
  "sshd",
  "avahi-daemon",
  "dnsmasq",
  "samba",
  "rpcbind",
]);

const isLoopbackHost = (host) => {
  const value = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    value === "" ||
    value === "*" ||
    value === "::" ||
    value === "::1" ||
    value === "0.0.0.0" ||
    value === "localhost" ||
    value.startsWith("127.")
  );
};

/** `ss -ltnpH`: `LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=123,fd=18))`. */
export function parseSsListeners(output) {
  const found = [];
  for (const line of output.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4 || fields[0] !== "LISTEN") continue;
    const address = fields[3] ?? "";
    const match = /^(.+):(\d+)$/.exec(address);
    if (!match || !isLoopbackHost(match[1])) continue;
    const users = /users:\(\("([^"]+)",pid=(\d+)/.exec(line);
    found.push({
      port: Number(match[2]),
      processName: users?.[1],
      pid: users ? Number(users[2]) : undefined,
    });
  }
  return found;
}

/**
 * `lsof -nP -iTCP -sTCP:LISTEN -F pcn` prints a `p`id line, a `c`ommand line, then an
 * `n`ame line per socket.
 */
export function parseLsofListeners(output) {
  const found = [];
  let pid;
  let processName;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("c")) processName = line.slice(1);
    else if (line.startsWith("n")) {
      const match = /^(.+):(\d+)$/.exec(line.slice(1));
      if (!match || !isLoopbackHost(match[1])) continue;
      found.push({ port: Number(match[2]), processName, pid });
    }
  }
  return found;
}

/** `netstat -ano -p TCP`: `TCP 127.0.0.1:5173 0.0.0.0:0 LISTENING 1234`. */
export function parseNetstatListeners(output) {
  const found = [];
  for (const line of output.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4 || fields[0].toUpperCase() !== "TCP") continue;
    if (!fields.includes("LISTENING")) continue;
    const match = /^(.+):(\d+)$/.exec(fields[1] ?? "");
    if (!match || !isLoopbackHost(match[1])) continue;
    found.push({ port: Number(match[2]), pid: Number(fields.at(-1)) });
  }
  return found;
}

async function readCapped(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (total < READ_LIMIT_BYTES) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      const part = value.subarray(0, READ_LIMIT_BYTES - total);
      chunks.push(part);
      total += part.length;
    }
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString("utf8");
}

/** The page title of a local server, or null when the port is not serving an HTML page. */
export async function probeLocalServer(port, { fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/`, {
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // A 404 or a redirect loop is not a previewable app; follow redirects once instead.
    if (response.status !== 200) return null;
    const type = response.headers.get("content-type") ?? "";
    if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type)) return null;
    const text = await readCapped(response);
    if (!text.trim()) return null;
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1]?.trim() ?? "";
    return { port, title: title.replace(/\s+/g, " ").slice(0, 120), status: response.status };
  } catch {
    return null;
  }
}

async function listenersFor(platform, run) {
  if (platform === "win32") {
    const { stdout } = await run("netstat", ["-ano", "-p", "TCP"]);
    return parseNetstatListeners(stdout);
  }
  if (platform === "darwin") {
    const { stdout } = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]);
    return parseLsofListeners(stdout);
  }
  try {
    const { stdout } = await run("ss", ["-ltnpH"]);
    return parseSsListeners(stdout);
  } catch {
    // `ss` is not on every distribution; lsof is the fallback.
    const { stdout } = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]);
    return parseLsofListeners(stdout);
  }
}

/**
 * @param {{
 *   platform?: NodeJS.Platform,
 *   run?: (file: string, args: string[]) => Promise<{ stdout: string }>,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 * }} [options]
 */
export function createLocalServerDiscovery({
  platform = process.platform,
  run = execFileAsync,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  let cached = { at: 0, servers: [], key: "" };
  let pending = null;
  let pendingKey = "";

  async function scan(excludePorts = []) {
    const excluded = new Set(excludePorts.filter((port) => Number.isFinite(port)));
    const key = [...excluded].sort((a, b) => a - b).join(",");
    if (cached.key === key && now() - cached.at < CACHE_TTL_MS) return cached.servers;
    if (pending && pendingKey === key) return pending;
    pendingKey = key;
    pending = (async () => {
      const ports = new Map();
      for (const listener of await listenersFor(platform, run).catch(() => [])) {
        if (listener.port < MIN_PORT || excluded.has(listener.port)) continue;
        if (listener.processName && IGNORED_PROCESSES.has(listener.processName)) continue;
        ports.set(listener.port, listener);
      }
      const probed = await Promise.all(
        [...ports.values()].map(async (listener) => {
          const page = await probeLocalServer(listener.port, { fetchImpl });
          if (!page) return null;
          return {
            port: listener.port,
            host: "127.0.0.1",
            url: `http://127.0.0.1:${listener.port}/`,
            title: page.title,
            status: page.status,
            ...(listener.processName ? { processName: listener.processName } : {}),
            ...(Number.isFinite(listener.pid) ? { pid: listener.pid } : {}),
          };
        }),
      );
      const servers = probed
        .filter(Boolean)
        .sort((a, b) => a.port - b.port)
        .slice(0, MAX_SERVERS);
      cached = { at: now(), servers, key };
      return servers;
    })().finally(() => {
      pending = null;
    });
    return pending;
  }

  return { scan };
}

/** One scan's result shared by every project, since listeners belong to the machine. */
export const localServerDiscovery = createLocalServerDiscovery();
