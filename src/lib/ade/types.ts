export type AgentId = "codex" | "opencode" | "pi";

export interface Agent {
  id: AgentId;
  name: string;
  short: string;
  installed: boolean;
  version?: string;
  signedIn: boolean;
  account?: string;
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

export type ProcessStatus = "running" | "stopped";

export interface LocalProcess {
  id: string;
  projectId: string;
  name: string;
  command: string;
  port: number;
  status: ProcessStatus;
  output: string[];
  startedAt?: number;
}

export type SessionStatus =
  | "working"
  | "needs_input"
  | "awaiting_approval"
  | "verifying"
  | "ready"
  | "complete"
  | "stopped"
  | "blocked";

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

export interface Question {
  text: string;
  options: string[];
}

export interface Approval {
  action: string;
  target: string;
  scope: string;
  risk: "external" | "destructive" | "cost";
  rollback: string;
}

export type Step =
  | { kind: "say"; text: string; delay: number }
  | { kind: "ask"; question: Question; delay: number }
  | { kind: "edit"; files: FileChange[]; delay: number }
  | { kind: "verify"; checks: Check[]; delay: number }
  | { kind: "approve"; approval: Approval; delay: number }
  | { kind: "ready"; summary: string; delay: number };

export interface Session {
  id: string;
  projectId: string;
  agentId: AgentId;
  createdBy: AgentId;
  request: string;
  criteria: string;
  status: SessionStatus;
  messages: Message[];
  question?: Question;
  approval?: Approval;
  changes: FileChange[];
  checks: Check[];
  summary?: string;
  logs: string[];
  script: Step[];
  step: number;
  nextAt: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface AdeState {
  hydrated: boolean;
  now: number;
  activeProjectId: string;
  projects: Project[];
  processes: LocalProcess[];
  sessions: Session[];
  agents: Agent[];
}
