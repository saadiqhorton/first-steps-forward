/**
 * Per-turn option capabilities for effort, speed, and permission.
 * Values are validated against OPTION_VALUE so they can never read as flags.
 */
export const PERMISSIONS = ["build", "plan"];
export const OPTION_VALUE = /^[a-z][a-z0-9_-]{0,31}$/;

/**
 * Requests that look destructive or external are refused before any agent
 * runs. Workflows' prompts are sent as the session request, so a workflow
 * prompt must not match this (see src/local/workflows.test.mjs).
 */
export const UNSUPPORTED_RISK =
  /\b(?:deploy(?:ment)?|publish|release (?:to )?prod(?:uction)?|production (?:deployment|database)|git push|push (?:to )?(?:origin|remote|github|gitlab)|open (?:a )?pull request|create (?:a )?pull request|drop database|wipe (?:all )?(?:data|files)|delete all|send (?:an? )?email|charge (?:a )?(?:credit )?card)\b/i;

/**
 * What an agent offers for one model: efforts and speeds come from the
 * model's listing row; permission choices come from the adapter.
 * @param {{ permissions?: string[], permissionLabels?: Record<string, string>, permissionNotes?: Record<string, string>, notes?: { effort?: string, speed?: string } } | undefined} agent
 * @param {{ efforts?: string[], speeds?: string[] } | undefined} model
 */
export function optionCapabilities(agent, model) {
  const efforts = Array.isArray(model?.efforts) ? [...model.efforts] : [];
  const speeds = Array.isArray(model?.speeds) ? [...model.speeds] : [];
  const notes = agent?.permissionNotes ?? { build: "", plan: "" };

  let effortNote = "";
  if (!model) effortNote = "Pick a model to choose effort.";
  else if (efforts.length && agent?.notes?.effort) effortNote = agent.notes.effort;

  const speedNote = agent?.notes?.speed ?? "";

  return {
    efforts,
    speeds,
    permissions: [...(agent?.permissions ?? PERMISSIONS)],
    effortNote,
    speedNote,
    permissionLabels: {
      build: "Build",
      plan: "Plan",
      manual: "Manual",
      auto: "Auto",
      deny: "Deny",
      approve: "Approve for me",
      full: "Full access",
      "dont-ask": "Don't ask",
      bypass: "Bypass permissions",
      ...agent?.permissionLabels,
    },
    permissionNotes: { ...notes },
  };
}

export function validateOptions(agent, options = {}, model) {
  const caps = optionCapabilities(agent, model);
  const value = {};

  for (const key of ["effort", "speed", "permission"]) {
    const raw = options[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw !== "string" || !OPTION_VALUE.test(raw)) {
      return { ok: false, error: `Invalid ${key} value.` };
    }
    const allowed =
      key === "effort" ? caps.efforts : key === "speed" ? caps.speeds : caps.permissions;
    if (!allowed.includes(raw)) {
      return {
        ok: false,
        error:
          key === "speed" && caps.speedNote && !caps.speeds.length
            ? caps.speedNote
            : `${key} "${raw}" is not available for this agent/model.`,
      };
    }
    value[key] = raw;
  }

  return { ok: true, value };
}
