export type AgentId = "codex" | "opencode" | "pi";
export type Permission = "build" | "plan";

export interface Agent {
  id: AgentId;
  name: string;
  short: string;
  installed: boolean;
  version?: string;
  signedIn: boolean;
  account?: string;
  providers?: string[];
  authMethod: string;
  authNote: string;
  carriesConversation: boolean;
  installHint: string;
  installMethod?: "npm" | "other" | "missing";
  installPath?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  harness?: { install: string; update: string };
}

export interface Project {
  id: string;
  name: string;
  path: string;
  branch: string;
  ahead: number;
  uncommittedFiles: string[];
  missing?: boolean;
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
  status: "running" | "starting" | "stopped";
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
  /** True when this file was already dirty before the agent's first turn. */
  preExisting?: boolean;
}
export interface MessageAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "file";
}
export interface Message {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  at: number;
  attachments?: MessageAttachment[];
}
export interface AgentModel {
  id: string;
  label?: string;
  meta?: string;
  efforts?: string[];
  defaultEffort?: string;
  speeds?: string[];
}
export interface OptionCapabilities {
  efforts: string[];
  speeds: string[];
  permissions: Permission[];
  effortNote: string;
  speedNote: string;
  permissionNotes: Record<Permission, string>;
}
export interface HarnessJob {
  agentId: AgentId;
  kind: "install" | "update";
  status: "idle" | "running" | "succeeded" | "failed";
  command: string;
  output: string[];
  exitCode?: number;
  startedAt?: number;
  finishedAt?: number;
}
export interface Workflow {
  id: string;
  name: string;
  description: string;
  prompt: string;
  agentId?: AgentId;
  permission?: Permission;
  builtIn?: boolean;
}
export interface ProjectDocument {
  path: string;
  name: string;
  modifiedAt: number;
  size: number;
}
/** A project's agent computer: headless Chrome on this machine that the agent drives, user watches. */
export interface AgentComputer {
  projectId: string;
  status: "unavailable" | "stopped" | "installing" | "starting" | "running" | "error";
  detail?: string;
  /** Download progress while ADE installs its headless browser (once per machine). */
  progress?: { downloadedBytes: number; totalBytes: number; unpacking: boolean };
  /** A host command that fixes the error, e.g. `npm run browser:setup`. */
  setupCommand?: string;
  screen: { width: number; height: number };
  /** "default" keeps the project's logins and storage between runs; "incognito" starts clean. */
  profile: "default" | "incognito";
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
  /** Historical non-Git task whose file count cannot be reconstructed. */
  changeCountUnavailable?: boolean;
  checks: Check[];
  summary?: string;
  logs: string[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  agentSessionId?: string;
  model?: string;
  effort?: string;
  speed?: string;
  permission?: Permission;
  /** Files dirty before the agent's first turn — shown as pre-existing. */
  baselineFiles?: string[];
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
    devServer?: string;
    otherServices?: string;
    agentComputer?: { available: boolean; screen?: string; tools?: string; note: string };
    dirtyWorktree: boolean;
    uncommittedFiles?: string[];
  };
  queuedMessages?: string[];
  /** Prompt to run as soon as the current CLI process exits. */
  steerNow?: string;
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
  /** ADE is exposed beyond loopback and this browser has not proven the token yet. */
  authRequired: boolean;
}
