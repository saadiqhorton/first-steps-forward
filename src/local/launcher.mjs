// How this ADE process was started, for Customize ADE's "Restart ADE":
// - under the `ade` supervisor (bin/ade.mjs runs a kept version as a child):
//   ADE_SUPERVISED=1 plus an IPC channel; restarting asks the parent;
// - stock `ade` in one process: bin/ade.mjs registers a hand-off with setLauncher();
// - anything else (`npm run dev`, `npm start`): nothing can restart ADE for the user.

/** The IPC message a supervised ADE sends to be restarted on the current version. */
export const RESTART_MESSAGE = { type: "ade:restart" };

/** @type {import("./customize/switch.mjs").LauncherInfo | null} */
let registered = null;

/** bin/ade.mjs: this process can restart itself on the kept version (or runs `--stock`). */
export function setLauncher(info) {
  registered = info;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ send?: (message: unknown) => boolean }} [proc]
 * @returns {import("./customize/switch.mjs").LauncherInfo}
 */
export function currentLauncher(env = process.env, proc = process) {
  if (registered) return registered;
  if (env.ADE_SUPERVISED === "1" && typeof proc.send === "function")
    return {
      running: env.ADE_RUNNING_SHA || null,
      restart: () => {
        proc.send?.(RESTART_MESSAGE);
      },
    };
  return { running: null, restart: null, command: env.ADE_COMMAND || "ade" };
}
