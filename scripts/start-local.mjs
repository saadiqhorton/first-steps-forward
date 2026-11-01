// Serves the production build (`npm run build`) on one port: the UI, the
// local API and the agent-browser stream. Loopback unless ADE_HOST opts into a
// LAN/Tailscale address, which then REQUIRES a non-empty ADE_TOKEN: every /api
// request from a non-loopback peer must present it (Authorization: Bearer …,
// or the ade_auth cookie POST /api/auth sets), so an exposed ADE is never
// unauthenticated. Loopback clients (the agent CLIs, local curls) stay exempt
// from the token either way.
import { fileURLToPath } from "node:url";
import { isLoopbackHost, resolveBindHost } from "../src/local/bind-host.mjs";
import { startAdeServer } from "../src/local/server.mjs";

let host;
try {
  host = resolveBindHost();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const server = await startAdeServer({
  host,
  port: Number(process.env.PORT ?? 3000),
  staticDir: fileURLToPath(new URL("../.output/public", import.meta.url)),
});
const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
const url = `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
if (isLoopbackHost(host)) {
  console.log(`ADE is listening on ${url}`);
} else {
  console.log(
    `ADE is listening on ${url} — token required from non-loopback clients (Authorization: Bearer <ADE_TOKEN>). Plain HTTP travels unencrypted; prefer a Tailscale address, or run \`tailscale serve --bg https / http://127.0.0.1:${port}\` for HTTPS.`,
  );
}
