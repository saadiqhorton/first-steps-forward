/** An installed OpenCode can offer models without a configured provider login.
 * Let its CLI decide whether the selected model is available; do not report a
 * sign-in that did not happen. Other agents still require detected sign-in.
 * @param {{id?: string, installed?: boolean, signedIn?: boolean} | null | undefined} agent
 */
export function canAttemptAgent(agent) {
  return Boolean(agent?.installed && (agent.signedIn || agent.id === "opencode"));
}
