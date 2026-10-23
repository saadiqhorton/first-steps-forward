// Typed wrappers for the browser preview routes. They follow the request() conventions in
// store.tsx: JSON in and out, and errors carry the HTTP status, the authRequired flag and the
// server's `code` (for example "human_control" on a 409).

export interface BrowserControlState {
  /** Viewer id that holds control, or null while the agent drives. */
  readonly owner: string | null;
  readonly generation: number;
}

export interface BrowserStatus {
  readonly available: boolean;
  /** Why the browser is unavailable, for display. */
  readonly reason?: string;
  /** Loopback WebSocket URL for the stream, with the project and token already in it. */
  readonly streamUrl?: string;
  readonly control: BrowserControlState;
}

export type BrowserControlAction = "take" | "release";

export type BrowserRequestError = Error & {
  status?: number;
  authRequired?: boolean;
  code?: string;
};

async function request<T>(url: string, method = "GET", data?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (data) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(data);
  }
  const response = await fetch(url, init);
  const value = (await response.json()) as {
    error?: string;
    code?: string;
    authRequired?: boolean;
  };
  if (!response.ok) {
    const error: BrowserRequestError = new Error(
      value.error ?? `Local API returned ${response.status}`,
    );
    error.status = response.status;
    error.authRequired = value.authRequired === true;
    if (value.code !== undefined) error.code = value.code;
    throw error;
  }
  return value as T;
}

export const getBrowserStatus = (projectId: string) =>
  request<BrowserStatus>(`/api/projects/${encodeURIComponent(projectId)}/browser`);

/** Take or hand back control of the shared agent browser, as `viewer`. */
export const postBrowserControl = (
  projectId: string,
  action: BrowserControlAction,
  viewer: string,
) =>
  request<BrowserControlState>(
    `/api/projects/${encodeURIComponent(projectId)}/computer/control`,
    "POST",
    { action, viewer },
  );

/**
 * Answers the page's open file picker with files already uploaded to /api/attachments. No
 * attachments closes the picker without a file. Only the viewer in control may answer.
 */
export const postFileChooser = (
  projectId: string,
  chooserId: string,
  attachmentIds: readonly string[],
  viewer: string,
) =>
  request<{ answered: true }>(
    `/api/projects/${encodeURIComponent(projectId)}/browser/file-chooser`,
    "POST",
    { chooserId, attachmentIds, viewer },
  );
