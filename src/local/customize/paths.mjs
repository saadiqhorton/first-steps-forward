import path from "node:path";

export const SELF_PROJECT_ID = "ade-self";
/** The hidden project the agent re-applies kept changes in while ADE updates. */
export const SELF_UPDATE_PROJECT_ID = "ade-self-update";

/** Files a customization may not change (functionality only, never the design system). */
export const LOCKED_PATHS = [
  "src/tokens.css",
  "src/styles.css",
  "design/",
  "src/components/ui/",
  "src/components/arc/",
];

export const lockedPath = (file) =>
  LOCKED_PATHS.some((locked) => (locked.endsWith("/") ? file.startsWith(locked) : file === locked));

/** Everything customization keeps lives under `<dataDir>/self`. */
export function selfPaths(dataDir) {
  const root = path.join(dataDir, "self");
  return {
    root,
    state: path.join(root, "state.json"),
    current: path.join(root, "current.json"),
    source: path.join(root, "source"),
    partial: path.join(root, "source.partial"),
    builds: path.join(root, "builds"),
    update: path.join(root, "update"),
    updateWork: path.join(root, "update", "work"),
    homes: path.join(root, "homes"),
    backups: path.join(root, "backups"),
    workspace: path.join(dataDir, "workspace.json"),
  };
}

/** A project record is hidden from every user-facing project list. */
export const isHiddenProject = (project) => project?.hidden === true;

export const hiddenProjectIds = (state) =>
  new Set((state.projects ?? []).filter(isHiddenProject).map((project) => project.id));

/** Sessions that belong to a hidden project (the private ADE copy). */
export const isHiddenSession = (state, session) =>
  (state.projects ?? []).some(
    (project) => project.id === session.projectId && isHiddenProject(project),
  );
