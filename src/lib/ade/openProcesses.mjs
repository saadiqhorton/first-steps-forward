// Opening the right pane's Processes tab from anywhere: the conversation's inline
// chips announce it here, and the shell brings the tab forward.

export const PROCESSES_OPEN_EVENT = "ade:processes-open";

/** Ask the shell to show the Processes tab in the right pane. */
export function requestProcessesOpen() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PROCESSES_OPEN_EVENT));
}
