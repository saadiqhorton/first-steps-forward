import { realpathSync } from "node:fs";
import path from "node:path";

/** Two project folders are the same folder, following symlinks when possible. */
export function samePath(a, b) {
  if (!a || !b) return false;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

/** True when this project is the ADE checkout the server itself runs from. */
export function isAdeProjectPath(projectPath, appRoot) {
  return samePath(projectPath, appRoot);
}

/**
 * Other ADE instances on loopback, as unmanaged rows. A candidate must serve an HTML
 * page titled ADE and answer `/api/bootstrap` with this workspace's project, so an
 * unrelated app on another port is never called ADE.
 * @param {{
 *   scan: (excludePorts: number[]) => Promise<Array<{url?: string, port?: number, title?: string}>>,
 *   excludePorts?: number[],
 *   projectPath?: string,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 * }} options
 */
export async function findUnmanagedAdeInstances({
  scan,
  excludePorts = [],
  projectPath,
  fetchImpl = fetch,
  timeoutMs = 900,
}) {
  const servers = await scan(excludePorts).catch(() => []);
  const found = [];
  for (const server of servers) {
    if (!server?.url || !/ADE/i.test(server.title ?? "")) continue;
    try {
      const response = await fetchImpl(`${server.url}api/bootstrap`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) continue;
      const data = await response.json();
      if (!Array.isArray(data.projects) || !Array.isArray(data.agents)) continue;
      if (
        projectPath &&
        !data.projects.some((item) => item?.path && samePath(item.path, projectPath))
      )
        continue;
      if (found.some((item) => item.port === server.port)) continue;
      found.push({ address: server.url, port: server.port });
    } catch {
      /* not this one */
    }
  }
  return found.sort((a, b) => a.port - b.port).slice(0, 5);
}
