import { request } from "./api";

export type WorkspaceInboxItem = {
  id: string;
  sessionId: string | null;
  projectId: string;
  title: string;
  /** The session request, or the proposed command for a project dev-command row. */
  request?: string;
  status: string;
  updatedAt: number;
  unread?: boolean;
  manualUnread?: boolean;
  pinned?: boolean;
  group?: string;
  summary?: string;
  projectName?: string;
  projectPath?: string;
  href?: string;
  kind?: string;
  readAt?: number;
  snooze?: {
    until: number | "finished";
    preset?: string | null;
    createdAt: number;
    returnedAt?: number;
  };
};
export type InboxResponse = {
  groups: Record<string, WorkspaceInboxItem[]>;
  totals: Record<string, number>;
  nextCursor?: string | null;
};
export type AssistantThread = {
  id: string;
  title?: string;
  status: "idle" | "thinking" | "awaiting_input" | "failed";
  agentId?: string;
  model?: string;
  effort?: string;
  updatedAt: number;
  readAt?: number;
  unread?: boolean;
  preview?: string;
};
export type AssistantMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  at: number;
  runId?: string;
  kind?: string;
  handoffId?: string;
  href?: string;
  source?: unknown;
  attachments?: { id: string; name: string; mime: string; size: number; kind: string }[];
};
export type AssistantDetail = {
  thread: AssistantThread;
  messages: AssistantMessage[];
  activity?: unknown[];
  cursor?: string;
};
export type HandoffSource = {
  kind: "assistant" | "session";
  id: string;
  label?: string;
  permission?: string;
  projectId?: string;
};
export type HandoffStatus =
  | "approval_pending"
  | "queued"
  | "delivered"
  | "replied"
  | "interrupted"
  | "missing_target"
  | "declined"
  | "failed"
  | "cancelled"
  | "retried";
export type Handoff = {
  id: string;
  status: HandoffStatus;
  source: HandoffSource;
  targetProjectId?: string;
  targetProjectName?: string;
  targetSessionId?: string;
  request?: string;
  permission?: string;
  answer?: string;
  error?: string;
  href?: string;
  targetName?: string;
  approval?: {
    required: boolean;
    decision: "approved" | "declined" | null;
    reason?: "permission" | "chain" | null;
  };
  createdAt?: number;
  updatedAt?: number;
  attempt?: number;
  previousId?: string;
};

export const getInbox = (query = "") =>
  request<InboxResponse>(`/api/workspace/inbox${query ? `?${query}` : ""}`);
export type ProjectSettings = {
  project: { id: string; name: string; path: string };
  revision: number;
  instructions: string;
  color: string | null;
  icon: string | null;
  versions: { revision: number; at: number }[];
};
export const getProjectSettings = (projectId: string) =>
  request<ProjectSettings>(`/api/workspace/projects/${encodeURIComponent(projectId)}/settings`);
export const updateProjectSettings = (
  projectId: string,
  data: { expectedRevision: number; instructions?: string; color?: string; icon?: string },
) =>
  request<ProjectSettings>(
    `/api/workspace/projects/${encodeURIComponent(projectId)}/settings`,
    "PATCH",
    data,
  );
export const getAssistant = () =>
  request<{
    threads: AssistantThread[];
    agents: {
      id: string;
      name: string;
      installed?: boolean;
      models?: { id: string; label?: string; efforts?: string[] }[];
    }[];
    defaults?: Record<string, unknown>;
  }>("/api/workspace/assistant");
export const getAssistantThreads = (query = "") =>
  request<{ threads: AssistantThread[]; nextCursor?: string | null }>(
    `/api/workspace/assistant/threads${query ? `?${query}` : ""}`,
  );
export const getAssistantThread = (id: string) =>
  request<AssistantDetail>(`/api/workspace/assistant/threads/${encodeURIComponent(id)}`);
export const startAssistantThread = (data: {
  text?: string;
  agentId?: string;
  model?: string;
  effort?: string;
  attachmentIds?: string[];
}) =>
  request<{ thread: AssistantThread; runId?: string }>(
    "/api/workspace/assistant/threads",
    "POST",
    data,
  );
export const sendAssistantMessage = (
  id: string,
  data: { text: string; attachmentIds?: string[]; presentation?: unknown },
) =>
  request<{ message: AssistantMessage; runId: string }>(
    `/api/workspace/assistant/threads/${encodeURIComponent(id)}/messages`,
    "POST",
    data,
  );
export const stopAssistantThread = (id: string) =>
  request<{ stopped: boolean }>(
    `/api/workspace/assistant/threads/${encodeURIComponent(id)}/stop`,
    "POST",
  );
export const patchAssistantThread = (
  id: string,
  data: {
    title?: string;
    readAt?: number;
    unread?: boolean;
    agentId?: string;
    model?: string;
    effort?: string;
  },
) =>
  request<{ thread: AssistantThread }>(
    `/api/workspace/assistant/threads/${encodeURIComponent(id)}`,
    "PATCH",
    data,
  );
export const deleteAssistantThread = (id: string) =>
  request<{ deleted: boolean }>(
    `/api/workspace/assistant/threads/${encodeURIComponent(id)}`,
    "DELETE",
  );
export const deleteAssistantThreads = (ids: string[]) =>
  request<{ results: { id: string; deleted: boolean; error?: string }[] }>(
    "/api/workspace/assistant/threads/bulk-delete",
    "POST",
    { ids },
  );
export const catchupAssistantThread = (id: string, since?: string) =>
  request<{
    items: { text: string; source?: { label?: string; href?: string } }[];
    cursor: string;
  }>(`/api/workspace/assistant/threads/${encodeURIComponent(id)}/catchup`, "POST", { since });
export const getHandoffs = (sourceThreadId?: string) =>
  request<{ handoffs: Handoff[] }>(
    `/api/workspace/handoffs${sourceThreadId ? `?sourceThreadId=${encodeURIComponent(sourceThreadId)}` : ""}`,
  );
export const dispatchHandoff = (data: {
  source: { kind: "assistant" | "session"; id: string };
  targets: { projectId?: string; sessionId?: string; request: string; permission?: string }[];
  deliveryKey: string;
  confirmed?: boolean;
}) => request<{ handoffs: Handoff[] }>("/api/workspace/handoffs", "POST", data);
export const decideHandoff = (id: string, decision: "send" | "decline", requestText?: string) =>
  request<{ handoff: Handoff }>(
    `/api/workspace/handoffs/${encodeURIComponent(id)}/decision`,
    "POST",
    { decision, request: requestText },
  );
export const retryHandoff = (id: string) =>
  request<{ handoff: Handoff }>(`/api/workspace/handoffs/${encodeURIComponent(id)}/retry`, "POST");
export const getFrequentWorkflows = () =>
  request<{
    items: {
      projectId: string;
      workflowId: string;
      name: string;
      count: number;
      lastStartedAt: number;
    }[];
  }>("/api/workspace/workflows/frequent");
export const launchWorkflow = (workflowId: string, projectId: string) =>
  request<{ session: { id: string }; workflowId: string }>(
    `/api/workspace/workflows/${encodeURIComponent(workflowId)}/launch`,
    "POST",
    { projectId },
  );
export const markSessionRead = (id: string) =>
  request<{ readAt: number }>(`/api/workspace/sessions/${encodeURIComponent(id)}/read`, "POST", {});
export type InboxActionResult = {
  sessionId: string;
  ok: boolean;
  error?: string;
  status?: number;
  result?: unknown;
};
export const inboxBulk = (
  actions: {
    sessionId: string;
    action: string;
    until?: number | "finished";
    position?: number;
    preset?: string;
  }[],
) => request<{ results: InboxActionResult[] }>("/api/workspace/inbox/bulk", "POST", { actions });
export type VoiceSettings = {
  muted: boolean;
  speakReplies: boolean;
  chimeDuringDictation: boolean;
};
export const getVoiceSettings = () => request<{ voice: VoiceSettings }>("/api/workspace/voice");
export const updateVoiceSettings = (voice: Partial<VoiceSettings>) =>
  request<{ voice: VoiceSettings }>("/api/workspace/voice", "PATCH", voice);
