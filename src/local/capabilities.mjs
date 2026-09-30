/**
 * Per-turn option capabilities for effort, speed, and permission.
 * Values are validated against OPTION_VALUE so they can never read as flags.
 */
export const PERMISSIONS = ["build", "plan"];
export const OPTION_VALUE = /^[a-z][a-z0-9_-]{0,31}$/;

const PERMISSION_NOTES = {
  codex: {
    build: "Codex workspace-write sandbox: can edit files in this project.",
    plan: "Codex read-only sandbox: reads and answers, cannot edit files.",
  },
  opencode: {
    build: "Make changes using your configured OpenCode permissions.",
    plan: "OpenCode plan agent: file edits and shell commands need approval, which ADE's non-interactive runs decline.",
  },
  pi: {
    build: "Pi tools: read, edit, write, grep, find, ls (no shell).",
    plan: "Pi read-only tools: read, grep, find, ls.",
  },
};

export function optionCapabilities(agentId, model) {
  const efforts = Array.isArray(model?.efforts) ? [...model.efforts] : [];
  const speeds = Array.isArray(model?.speeds) ? [...model.speeds] : [];
  const notes = PERMISSION_NOTES[agentId] ?? { build: "", plan: "" };

  let effortNote = "";
  if (!model) effortNote = "Pick a model to choose effort.";
  else if (agentId === "pi" && efforts.length) {
    effortNote = "Pi clamps the level to what the model supports.";
  }

  let speedNote = "";
  if (agentId === "opencode") speedNote = "OpenCode has no speed setting.";

  return {
    efforts,
    speeds,
    permissions: [...PERMISSIONS],
    effortNote,
    speedNote,
    permissionNotes: { build: notes.build, plan: notes.plan },
  };
}

export function validateOptions(agentId, options = {}, model) {
  const caps = optionCapabilities(agentId, model);
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
          key === "speed" && agentId === "opencode"
            ? "OpenCode has no speed setting."
            : `${key} "${raw}" is not available for this agent/model.`,
      };
    }
    value[key] = raw;
  }

  return { ok: true, value };
}
