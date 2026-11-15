import { request } from "./api";

/** A process ADE manages, as the Processes UI reads it. */
export interface ProcessRecord {
  id: string;
  projectId: string;
  name: string;
  command: string;
  status: "running" | "starting" | "stopping" | "unverified" | "failed" | "stopped";
  port: number;
  address: string | null;
  addresses: string[];
  source: "package_script" | "approved_command";
  cwd: string;
  sessionId: string | null;
  startedAt: number | null;
  updatedAt: number | null;
  stoppedAt: number | null;
  verifiedAt: number | null;
  stopError: string | null;
  lineCount: number;
}

export interface ProcessLine {
  n: number;
  text: string;
}

export interface ProcessOutput {
  lines: ProcessLine[];
  next: number;
  total: number;
  reset: boolean;
  source: "log";
}

/** ADE itself, shown only while the open project is the ADE checkout. */
export interface AdeSelf {
  app: { address: string | null; port: number } | null;
  unmanaged: { address: string; port: number }[];
}

export interface ProcessList {
  processes: ProcessRecord[];
  ade: AdeSelf | null;
}

export interface ProcessDetails {
  process: ProcessRecord;
  output: ProcessOutput;
}

export function listProcesses(projectId: string): Promise<ProcessList> {
  return request<ProcessList>(`/api/projects/${encodeURIComponent(projectId)}/processes`);
}

export function loadProcess(processId: string): Promise<ProcessDetails> {
  return request<ProcessDetails>(`/api/processes/${encodeURIComponent(processId)}`);
}

export function loadProcessOutput(processId: string, after = 0): Promise<ProcessOutput> {
  return request<ProcessOutput>(
    `/api/processes/${encodeURIComponent(processId)}/output?after=${after}`,
  );
}

export function stopProcess(processId: string): Promise<{ id: string }> {
  return request(`/api/processes/${encodeURIComponent(processId)}/stop`, "POST");
}

export function startProcess(processId: string): Promise<ProcessRecord> {
  return request(`/api/processes/${encodeURIComponent(processId)}/start`, "POST");
}

/** Mark a process ADE could not confirm as good. */
export function acknowledgeProcess(processId: string): Promise<ProcessRecord> {
  return request<{ process: ProcessRecord }>(
    `/api/processes/${encodeURIComponent(processId)}/ack`,
    "POST",
  ).then((data) => data.process);
}

export function stopAllProcesses(
  projectId: string,
): Promise<{ stopped: string[]; failed: { id: string; name: string; error: string }[] }> {
  return request(`/api/projects/${encodeURIComponent(projectId)}/processes/stop-all`, "POST");
}
