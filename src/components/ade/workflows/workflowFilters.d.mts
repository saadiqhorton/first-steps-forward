export type WorkflowFilter = "all" | "builtin" | "yours";

export type WorkflowLike = {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
  builtIn?: boolean;
};

export function filterWorkflows(
  workflows: WorkflowLike[],
  filter: WorkflowFilter,
  query: string,
): WorkflowLike[];

export function groupWorkflows(workflows: WorkflowLike[]): {
  builtIn: WorkflowLike[];
  yours: WorkflowLike[];
};

export function workflowAccent(id: string): string;
