// Local ADE binds loopback unless ADE_HOST opts into a LAN/Tailscale address.
// A non-loopback bind REQUIRES a non-empty ADE_TOKEN: every /api request from
// a non-loopback peer must present it (Authorization: Bearer …, or the
// ade_auth cookie POST /api/auth sets), so an exposed ADE is never
// unauthenticated. Loopback clients (the agent CLIs, local curls) stay
// exempt from the token either way.
const host = (process.env.ADE_HOST ?? "").trim() || "127.0.0.1";
const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
process.env.HOST = host;
process.env.NITRO_HOST = host;
process.env.NITRO_PORT ??= process.env.PORT ?? "3000";
if (!loopback.has(host.toLowerCase())) {
  if (!(process.env.ADE_TOKEN ?? "").trim()) {
    console.error(
      "ADE refuses to listen on a non-loopback address without an access token.\n" +
        "Set ADE_TOKEN (e.g. `openssl rand -hex 16`) and start again, or unset ADE_HOST to stay loopback-only.",
    );
    process.exit(1);
  }
  console.log(
    `ADE is listening on http://${host}:${process.env.NITRO_PORT} — token required from non-loopback clients (Authorization: Bearer <ADE_TOKEN>). Plain HTTP travels unencrypted; prefer a Tailscale address, or run \`tailscale serve --bg https / http://127.0.0.1:${process.env.NITRO_PORT}\` for HTTPS.`,
  );
}
await import("../.output/server/index.mjs");
