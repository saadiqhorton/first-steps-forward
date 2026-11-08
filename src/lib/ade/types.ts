/** Agent ids come from the server's adapter files; any id it serves is valid. */
export type AgentId = string;
export type Permission = "build" | "plan";

export interface Agent {
  id: AgentId;
  name: string;
  short: string;
  tools: string;
  installed: boolean;
  version?: string;
  signedIn: boolean;
  account?: string;
  providers?: string[];
  authMethod: string;
  authNote: string;
  /** How the user signs in: a terminal `command`, or a `device` flow ADE starts itself. */
  signIn: { note: string; command?: string; device?: boolean; waiting?: string };
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
  /** The dev command the user approved for a project without a package.json dev script. */
  devCommand?: ApprovedDevCommand;
  /** A proposed dev command waiting on the user that no session holds (shown in the right pane). */
  pendingDevCommand?: DevCommandRequest;
}

/** A dev command the user approved once; ADE runs it whenever the agent starts the dev server. */
export interface ApprovedDevCommand {
  command: string;
  /** Folder relative to the project root; "." is the root. */
  cwd: string;
  /** Only for apps that always listen on a fixed port. */
  port?: number;
  approvedAt: number;
}

/** ADE's own question when an agent proposes a dev command: "Run this dev command?" */
export interface DevCommandRequest {
  id: string;
  kind: "dev_command";
  command: string;
  cwd: string;
  port?: number;
  requestedAt: number;
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
  output?: string[];
  startedAt?: number;
  updatedAt?: number;
  /** "approved": the project's approved dev command, not a package.json dev script. */
  source?: "approved";
  /** Where an approved command runs, relative to the project root. */
  cwd?: string;
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
  /** The profile used by this conversation; named profiles share logins across conversations. */
  profile: string;
  profiles: { id: string; name: string }[];
}
/** An ACP agent's question, waiting on the user; the turn pauses until it is answered. */
export interface PendingPermission {
  id: string;
  /** Agent-supplied, shown as text only. */
  title: string;
  /** ACP tool kind: read, edit, delete, move, search, execute, think, fetch, switch_mode, other. */
  kind: string;
  /** The command, file paths, or URL the request is about, when the agent said. */
  detail?: string;
  options: {
    optionId: string;
    name: string;
    kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
  }[];
  at: number;
}
export interface AgentModelsResult {
  available: boolean;
  models?: AgentModel[];
  /** Listing provenance: "live" (CLI's own cached catalog), "bundled", or "acp" (reported by the agent in its last session). */
  source?: string;
  /** The quota-free CLI command the list came from, for honest disclosure. */
  command?: string;
  reason?: string;
  hint?: string;
  cached?: boolean;
  /** Agent-specific caveat about this listing, in the agent's own words. */
  note?: string;
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
  /** A provider was selected, but its first turn is waiting for a user message. */
  agentStartFresh?: boolean;
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
  /** Questions waiting on the user: an ACP agent's permission requests, and dev command proposals. */
  pendingPermissions?: (PendingPermission | DevCommandRequest)[];
}

export type SessionSummary = Pick<
  Session,
  | "id"
  | "projectId"
  | "agentId"
  | "createdBy"
  | "request"
  | "criteria"
  | "status"
  | "summary"
  | "createdAt"
  | "updatedAt"
  | "completedAt"
  | "model"
  | "failureKind"
  | "pendingPermissions"
> & { lastUserMessageAt?: number };

export interface AdeState {
  hydrated: boolean;
  serviceAvailable: boolean;
  now: number;
  activeProjectId: string;
  projects: Project[];
  processes: LocalProcess[];
  sessions: SessionSummary[];
  agents: Agent[];
  /** ADE is exposed beyond loopback and this browser has not proven the token yet. */
  authRequired: boolean;
}
