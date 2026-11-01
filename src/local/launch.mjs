import { isLoopbackHost, resolveBindHost } from "./bind-host.mjs";
import { startAdeServer } from "./server.mjs";

/**
 * Starts the production server for `scripts/start-local.mjs` and `bin/ade.mjs`:
 * loopback unless ADE_HOST opts into another interface, which then REQUIRES a
 * non-empty ADE_TOKEN (see bind-host.mjs). Prints how to reach it.
 * @param {{ staticDir: string, port?: number, host?: string, env?: NodeJS.ProcessEnv, log?: (line: string) => void }} options
 *   `host` overrides ADE_HOST and is written back to `env.ADE_HOST`; the token rule applies either way.
 * @returns {Promise<{ server: import("node:http").Server, url: string }>}
 * @throws {Error} when the bind rule refuses the host
 */
export async function launchAde({
  staticDir,
  port = 3100,
  host: requested,
  env = process.env,
  log = console.log,
}) {
  const host = resolveBindHost(requested === undefined ? env : { ...env, ADE_HOST: requested });
  // The request guard reads ADE_HOST, so a host given on the command line must reach it too.
  if (requested !== undefined) env.ADE_HOST = host;
  const server = await startAdeServer({ host, port, staticDir });
  const { port: bound } = /** @type {import("node:net").AddressInfo} */ (server.address());
  const url = `http://${host.includes(":") ? `[${host}]` : host}:${bound}`;
  if (isLoopbackHost(host)) {
    log(`ADE is listening on ${url}`);
  } else {
    log(
      `ADE is listening on ${url} — token required from non-loopback clients (Authorization: Bearer <ADE_TOKEN>). Plain HTTP travels unencrypted; prefer a Tailscale address, or run \`tailscale serve --bg https / http://127.0.0.1:${bound}\` for HTTPS.`,
    );
  }
  return { server, url };
}
