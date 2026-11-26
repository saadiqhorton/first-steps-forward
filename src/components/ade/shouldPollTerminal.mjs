/** Whether HostTerminalPane should run its long-poll loop. */
export function shouldPollTerminal({ visible, status }) {
  return visible && status !== "exited" && status !== "error";
}
