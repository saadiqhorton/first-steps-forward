import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdeState } from "@/lib/ade/store";

/** Contract: cook/API.md (round 1). */
export type SetupStep = "copy" | "install" | "save";
export type SetupStatus = "none" | "running" | "ready" | "failed";

export interface CustomizeSetup {
  status: SetupStatus;
  step?: SetupStep;
  progress?: { done: number; total: number | null; label: string };
  error?: string;
}

export type ChangeStatus =
  "working" | "checking" | "fixing" | "ready" | "failed" | "needs-you" | "kept" | "removed";

export type CheckStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface ChangeCheck {
  id: string;
  label: string;
  status: CheckStatus;
  durationMs?: number;
  summary?: string;
  output?: string;
}

export interface ChangeFile {
  path: string;
  added: number;
  removed: number;
}

export type PreviewStep = "build" | "start";

export interface ChangePreview {
  status: "stopped" | "starting" | "running" | "failed";
  /** While starting: what runs now; when failed: where it stopped (absent before the first step). */
  step?: PreviewStep;
  /** This start built the change first (the checks' build was missing or out of date). */
  rebuilt?: boolean;
  url?: string;
  port?: number;
  error?: string;
  /** The last lines the build or ADE printed, when it failed. */
  output?: string;
}

export interface Change {
  id: string;
  title: string;
  request: string;
  criteria?: string;
  status: ChangeStatus;
  reason?: string;
  sessionId: string;
  agentId: string;
  createdAt: string;
  updatedAt: string;
  keptAt?: string;
  /** First time the user started Try it for this change. */
  triedAt?: string;
  files: ChangeFile[];
  checks: ChangeCheck[];
  fixAttempts: number;
  preview: ChangePreview;
}

export interface CustomizeSwitch {
  status: "idle" | "pending" | "waiting" | "restarting" | "failed";
  waitingFor?: number;
  error?: string;
  launcher: boolean;
}

export interface CustomizeUpdate {
  from: string;
  to: string;
  status: "applying" | "done" | "needs-you";
  changes: {
    id: string;
    title: string;
    status: "applied" | "applying" | "needs-you" | "dropped";
  }[];
}

export interface CustomizeState {
  available: boolean;
  unavailableReason?: string;
  version: string;
  setup: CustomizeSetup;
  changes: Change[];
  current: { stock: boolean; sha: string | null };
  switch: CustomizeSwitch;
  update: CustomizeUpdate | null;
}

export class CustomizeRequestError extends Error {
  status: number;
  /** The local service has no customize routes (older build) or answered with something else. */
  missing: boolean;
  constructor(message: string, status: number, missing = false) {
    super(message);
    this.status = status;
    this.missing = missing;
  }
}

async function call<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
  const text = await response.text();
  let value: unknown = null;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    // A dev server or old local service answers unknown API paths with HTML.
    throw new CustomizeRequestError(
      response.ok
        ? "The local service sent an answer ADE could not read."
        : `The local service has no customization support (HTTP ${response.status}).`,
      response.status,
      !response.ok,
    );
  }
  if (!response.ok) {
    const error =
      value && typeof value === "object" && "error" in value && typeof value.error === "string"
        ? value.error
        : `Local API returned ${response.status}`;
    throw new CustomizeRequestError(error, response.status, response.status === 404);
  }
  return value as T;
}

export const CUSTOMIZE_KEY = ["customize"] as const;

export const getCustomize = () => call<CustomizeState>("/api/customize");
export const startSetup = () => call<{ setup: CustomizeSetup }>("/api/customize/setup", "POST");
export const createChange = (data: {
  request: string;
  criteria?: string;
  agentId: string;
  model?: string;
  effort?: string;
}) => call<{ change: Change }>("/api/customize/changes", "POST", data);
export const rerunChecks = (id: string) =>
  call<unknown>(`/api/customize/changes/${encodeURIComponent(id)}/checks`, "POST");
export const keepChange = (id: string) =>
  call<{ change: Change }>(`/api/customize/changes/${encodeURIComponent(id)}/keep`, "POST");
export const undoChange = (id: string) =>
  call<unknown>(`/api/customize/changes/${encodeURIComponent(id)}/undo`, "POST");
export const removeChange = (id: string) =>
  call<{ change: Change }>(`/api/customize/changes/${encodeURIComponent(id)}/remove`, "POST");
export const previewChange = (id: string, action: "start" | "stop") =>
  call<{ change: Change }>(`/api/customize/changes/${encodeURIComponent(id)}/preview`, "POST", {
    action,
  });

export function useCustomize() {
  const serviceAvailable = useAdeState((state) => state.serviceAvailable);
  return useQuery({
    queryKey: CUSTOMIZE_KEY,
    queryFn: getCustomize,
    enabled: serviceAvailable,
    // The `customize` SSE event invalidates this; poll slowly only while setup runs.
    refetchInterval: (query) => (query.state.data?.setup.status === "running" ? 3000 : false),
    retry: (count, error) =>
      !(error instanceof CustomizeRequestError && error.missing) && count < 2,
  });
}

/** Any customize mutation; the state refetches when it settles. */
export function useCustomizeAction<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => client.invalidateQueries({ queryKey: CUSTOMIZE_KEY }),
  });
}

export const IN_PROGRESS: ChangeStatus[] = [
  "working",
  "checking",
  "fixing",
  "ready",
  "failed",
  "needs-you",
];
export const BUSY: ChangeStatus[] = ["working", "checking", "fixing"];
export const NEEDS_YOU: ChangeStatus[] = ["ready", "failed", "needs-you"];

export function changeInProgress(state: CustomizeState | undefined): Change | undefined {
  return state?.changes.find((change) => IN_PROGRESS.includes(change.status));
}

export type Tone = "busy" | "attention" | "danger" | "quiet";

export const STATUS_META: Record<ChangeStatus, { label: string; tone: Tone }> = {
  working: { label: "Working", tone: "busy" },
  checking: { label: "Checking", tone: "busy" },
  fixing: { label: "Fixing", tone: "busy" },
  ready: { label: "Ready to try", tone: "attention" },
  failed: { label: "Checks failed", tone: "danger" },
  "needs-you": { label: "Needs you", tone: "attention" },
  kept: { label: "Kept", tone: "quiet" },
  removed: { label: "Removed", tone: "quiet" },
};

export const TONE_CLASS: Record<Tone, { text: string; dot: string; pulse: boolean }> = {
  busy: { text: "text-teal", dot: "bg-teal", pulse: true },
  attention: { text: "text-amber-deep", dot: "bg-amber", pulse: false },
  danger: { text: "text-danger", dot: "bg-danger", pulse: false },
  quiet: { text: "text-dim", dot: "bg-dim", pulse: false },
};

/** Top-bar dot: teal while an agent or checks run, amber when the user has something to do. */
export function customizeDot(state: CustomizeState | undefined): "working" | "attention" | null {
  if (!state) return null;
  if (state.changes.some((change) => BUSY.includes(change.status))) return "working";
  if (
    state.update?.status === "needs-you" ||
    state.changes.some((change) => NEEDS_YOU.includes(change.status))
  )
    return "attention";
  return null;
}
