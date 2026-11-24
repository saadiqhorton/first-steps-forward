import type { Permission } from "@/lib/ade/types";

export type WorkspaceSelection = {
  agentId: string;
  model: string;
  effort: string;
  speed: string;
  permission: Permission;
};

/** The thread fields the mapping reads. The service may send any permission string. */
export type ThreadFields = {
  agentId?: string | undefined;
  model?: string | undefined;
  effort?: string | undefined;
  permission?: string | undefined;
};

export function threadSelection(thread: ThreadFields): WorkspaceSelection;
export function selectionMode(selection: { permission?: string | undefined }): "chat" | "work";
