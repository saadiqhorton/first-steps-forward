// node-pty ships prebuilt binaries only for macOS and Windows, so on other
// platforms its install can fail and importing it throws. Only the built-in
// terminal needs it, so the route loads it on demand and reports a failure as
// unavailable rather than failing the whole app.

/**
 * @param {() => Promise<unknown>} [load] imports the terminal module; injected by tests
 * @returns {Promise<unknown>} the terminal module
 * @throws {Error} with the message the terminal routes answer with (503)
 */
export async function loadTerminal(load = () => import("./terminal.mjs")) {
  try {
    return await load();
  } catch (error) {
    const reason = error?.message ?? String(error);
    throw new Error(
      `The built-in terminal is unavailable: node-pty could not be loaded on this platform (${reason}). Everything else in ADE works.`,
    );
  }
}
