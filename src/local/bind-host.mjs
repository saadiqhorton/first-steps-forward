const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * The address ADE binds, in dev/preview (vite.config.ts) and production
 * (scripts/start-local.mjs): loopback unless ADE_HOST opts into another
 * interface, and then only with a non-empty ADE_TOKEN, so an exposed ADE is
 * never unauthenticated.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function resolveBindHost(env = process.env) {
  const host = (env.ADE_HOST ?? "").trim() || "127.0.0.1";
  if (!isLoopbackHost(host) && !(env.ADE_TOKEN ?? "").trim()) {
    throw new Error(
      "ADE refuses to listen on a non-loopback address without an access token.\n" +
        "Set ADE_TOKEN (e.g. `openssl rand -hex 16`) and start again, or unset ADE_HOST to stay loopback-only.",
    );
  }
  return host;
}

/** @param {string} host */
export function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}
