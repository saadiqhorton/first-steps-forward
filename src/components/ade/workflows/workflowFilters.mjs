/**
 * @typedef {"all" | "builtin" | "yours"} WorkflowFilter
 */

/**
 * @typedef {{
 *   id: string;
 *   name: string;
 *   description?: string;
 *   prompt?: string;
 *   builtIn?: boolean;
 * }} WorkflowLike
 */

/**
 * @param {WorkflowLike[]} workflows
 * @param {WorkflowFilter} filter
 * @param {string} query
 * @returns {WorkflowLike[]}
 */
export function filterWorkflows(workflows, filter, query) {
  const q = query.trim().toLowerCase();
  return workflows.filter((w) => {
    if (filter === "builtin" && !w.builtIn) return false;
    if (filter === "yours" && w.builtIn) return false;
    if (!q) return true;
    return (
      w.name.toLowerCase().includes(q) ||
      (w.description ?? "").toLowerCase().includes(q)
    );
  });
}

/**
 * @param {WorkflowLike[]} workflows
 * @returns {{ builtIn: WorkflowLike[]; yours: WorkflowLike[] }}
 */
export function groupWorkflows(workflows) {
  return {
    builtIn: workflows.filter((w) => w.builtIn),
    yours: workflows.filter((w) => !w.builtIn),
  };
}

const ACCENTS = ["bg-amber/20", "bg-ink/10", "bg-danger/10", "bg-ink/5"];

/**
 * Deterministic ADE-safe accent class from workflow id.
 * @param {string} id
 * @returns {string}
 */
export function workflowAccent(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * (i + 1)) % ACCENTS.length;
  return ACCENTS[h];
}
