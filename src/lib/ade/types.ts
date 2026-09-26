export type AgentId = "codex" | "opencode" | "pi";

export interface Agent {
  id: AgentId;
  name: string;
  short: string;
  installed: boolean;
  version?: string;
  signedIn: boolean;
  account?: string;
  provider?: string;
  authMethod: string;
  authNote: string;
  carriesConversation: boolean;
  installHint: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  branch: string;
  ahead: number;
  uncommittedFiles: string[];
  defaultAgent: AgentId;
  addedAt: number;
}

export interface LocalProcess {
  id: string;
  projectId: string;
  name: string;
  command: string;
  bin?: string;
  args?: string[];
  port: number;
  status: "running" | "stopped";
  output: string[];
  startedAt?: number;
  updatedAt?: number;
}

export type SessionStatus = "working" | "verifying" | "ready" | "complete" | "stopped" | "blocked";
export type CheckStatus = "passed" | "failed" | "skipped" | "not_run";
export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}
export interface FileChange {
  path: string;
  added: number;
  removed: number;
  hunk: string[];
}
export interface Message {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  at: number;
}
export interface AgentModel {
  id: string;
  label?: string;
  meta?: string;
}
export interface AgentModelsResult {
  available: boolean;
  models?: AgentModel[];
  /** Listing provenance: "live" (CLI's own cached catalog) or "bundled". */
  source?: string;
  /** The quota-free CLI command the list came from, for honest disclosure. */
  command?: string;
  reason?: string;
  hint?: string;
  cached?: boolean;
}

export interface Session {
  id: string;
  projectId: string;
  agentId: AgentId;
  createdBy: AgentId;
  request: string;
  criteria: string;
  status: SessionStatus;
  messages: Message[];
  changes: FileChange[];
  checks: Check[];
  summary?: string;
  logs: string[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  agentSessionId?: string;
  model?: string;
  failureKind?:
    | "provider_quota"
    | "model_not_found"
    | "provider_unavailable"
    | "auth_expired"
    | "context_overflow"
    | "process";
  manifest?: {
    createdAt: number;
    project: { id: string; name: string; path: string; branch: string };
    task: string;
    acceptanceCriteria?: string;
    agent: { id: string; account: string | null; model?: string };
    constraints: string[];
    relevantFiles: string[];
    tools: string;
    dirtyWorktree: boolean;
  };
  queuedMessages?: string[];
}

export interface AdeState {
  hydrated: boolean;
  serviceAvailable: boolean;
  now: number;
  activeProjectId: string;
  projects: Project[];
  processes: LocalProcess[];
  sessions: Session[];
  agents: Agent[];
}
