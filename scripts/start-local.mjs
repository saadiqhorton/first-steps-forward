// Serves the production build (`npm run build`) on one port: the UI, the
// local API and the agent-browser stream. Loopback unless ADE_HOST opts into a
// LAN/Tailscale address, which then REQUIRES a non-empty ADE_TOKEN: every /api
// request from a non-loopback peer must present it (Authorization: Bearer …,
// or the ade_auth cookie POST /api/auth sets), so an exposed ADE is never
// unauthenticated. Loopback clients (the agent CLIs, local curls) stay exempt
// from the token either way.
import { fileURLToPath } from "node:url";
import { launchAde } from "../src/local/launch.mjs";
import { DEFAULT_PORT } from "../src/shared/runtime-contract.mjs";

try {
  await launchAde({
    port: Number(process.env.PORT ?? DEFAULT_PORT),
    staticDir: fileURLToPath(new URL("../.output/public", import.meta.url)),
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
