// Agent computers: each project's headless Chrome on this machine, which the coding agent drives
// through ADE's computer_* and browser_* tools and the user watches through the browser stream.
// Chrome is T3's pinned headless shell (browser-install.mjs), launched over a pipe by
// browser-contexts.mjs, so no port is opened and it exits with ADE. Status, start and stop are
// per project; the first agent tool call starts the computer itself.
import { DEFAULT_VIEWPORT } from "../shared/browser-contract.mjs";

export const SCREEN = DEFAULT_VIEWPORT;

/** HTTP status for a coded browser or computer error. Uncoded errors are bad input (400). */
export const COMPUTER_ERROR_STATUS = {
  human_control: 409,
  browser_closed: 503,
  dialog_pending: 409,
  stale_ref: 409,
  no_file_chooser: 409,
  cdp_unavailable: 503,
  browser_installing: 503,
  browser_install_failed: 503,
  browser_unsupported: 503,
  browser_libraries_missing: 503,
  browser_sandbox_blocked: 503,
  browser_root: 503,
  invalid_url: 400,
  timeout: 504,
  unknown_action: 400,
};

const failurePhase = (error) => ({
  status: error?.code === "browser_unsupported" ? "unavailable" : "error",
  detail: error?.message ?? String(error),
  ...(error?.setupCommand ? { setupCommand: error.setupCommand } : {}),
});

/**
 * @param {{
 *   installer: { executable: (options?: { wait?: number }) => Promise<string>, status: () => { state: string, detail?: string, progress?: object } },
 *   hub: { get: (projectId: string) => Promise<any>, peek: (projectId: string) => any, close: (projectId: string) => Promise<void> },
 * }} options
 */
export function createComputerManager({ installer, hub }) {
  const phases = new Map();
  const pending = new Map();
  const explicitlyStopped = new Set();
  // Invalidate starts that are still installing or opening when a stop is requested.
  const generations = new Map();

  function status(projectId) {
    const base = { projectId, screen: SCREEN };
    if (hub.peek(projectId)) return { ...base, status: "running" };
    if (explicitlyStopped.has(projectId)) return { ...base, status: "stopped" };
    const install = installer.status();
    if (install.state === "unsupported")
      return { ...base, status: "unavailable", detail: install.detail };
    if (install.state === "installing")
      return {
        ...base,
        status: "installing",
        detail: "Downloading ADE's headless browser. This happens once.",
        progress: install.progress,
      };
    const phase = phases.get(projectId);
    if (phase) return { ...base, ...phase };
    return { ...base, status: "stopped" };
  }

  /** Starts the project's browser, waiting out a first install however long it takes. */
  function start(projectId) {
    if (pending.has(projectId)) return pending.get(projectId);
    explicitlyStopped.delete(projectId);
    const generation = generations.get(projectId) ?? 0;
    const stillCurrent = () => (generations.get(projectId) ?? 0) === generation;
    phases.set(projectId, { status: "starting", detail: "Starting the browser." });
    const promise = (async () => {
      await installer.executable({ wait: Infinity });
      if (!stillCurrent())
        throw Object.assign(new Error("The browser was stopped."), { code: "browser_closed" });
      await hub.get(projectId);
      if (!stillCurrent())
        throw Object.assign(new Error("The browser was stopped."), { code: "browser_closed" });
    })()
      .then(
        () => {
          if (stillCurrent()) phases.delete(projectId);
        },
        (error) => {
          if (stillCurrent()) phases.set(projectId, failurePhase(error));
          throw error;
        },
      )
      .finally(() => {
        if (pending.get(projectId) === promise) pending.delete(projectId);
      });
    pending.set(projectId, promise);
    return promise;
  }

  async function stop(projectId) {
    explicitlyStopped.add(projectId);
    generations.set(projectId, (generations.get(projectId) ?? 0) + 1);
    pending.delete(projectId);
    phases.delete(projectId);
    await hub.close(projectId);
  }

  /**
   * Runs one computer_* action, starting the browser first if needed. An install in progress
   * answers with its progress after a bounded wait instead, so the agent can retry.
   * @returns {Promise<{ status: number, payload: object }>}
   */
  async function action(projectId, body) {
    explicitlyStopped.delete(projectId);
    let session;
    try {
      session = await hub.get(projectId);
      phases.delete(projectId);
    } catch (error) {
      if (error?.code !== "browser_installing") phases.set(projectId, failurePhase(error));
      return failure(error);
    }
    try {
      return {
        status: 200,
        payload: { ok: true, ...(await session.runComputerAction(body ?? {})) },
      };
    } catch (error) {
      return failure(error);
    }
  }

  function failure(error) {
    const code = error?.code;
    return {
      status: COMPUTER_ERROR_STATUS[code] ?? 400,
      payload: { error: error?.message ?? String(error), ...(code ? { code } : {}) },
    };
  }

  return { status, start, stop, action };
}
