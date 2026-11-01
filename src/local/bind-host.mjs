const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * The address a dev/preview server binds: loopback unless ADE_HOST opts into
 * another interface, and then only with a non-empty ADE_TOKEN (same rule as
 * scripts/start-local.mjs, so an exposed ADE is never unauthenticated).
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function resolveBindHost(env = process.env) {
  const host = (env.ADE_HOST ?? "").trim() || "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host.toLowerCase()) && !(env.ADE_TOKEN ?? "").trim()) {
    throw new Error(
      "ADE refuses to listen on a non-loopback address without an access token.\n" +
        "Set ADE_TOKEN (e.g. `openssl rand -hex 16`) and start again, or unset ADE_HOST to stay loopback-only.",
    );
  }
  return host;
}
