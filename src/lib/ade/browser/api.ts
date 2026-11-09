// Typed wrappers for the browser preview routes. They follow the request() conventions in
// store.tsx: JSON in and out, and errors carry the HTTP status, the authRequired flag and the
// server's `code` (for example "human_control" on a 409).

import { viewportAcceptable } from "@/shared/browser-contract.mjs";
import { request, type RequestError } from "../api";

export interface BrowserControlState {
  /** Viewer id that holds control, or null while the agent drives. */
  readonly owner: string | null;
  readonly generation: number;
}

export interface BrowserStatus {
  readonly available: boolean;
  /** Why the browser is unavailable, for display. */
  readonly reason?: string;
  /** Origin-relative WebSocket path for the stream, with the project and token already in it. */
  readonly streamUrl?: string;
  readonly control: BrowserControlState;
}

export type BrowserControlAction = "take" | "release";

export const withBrowserSession = (url: string, sessionId?: string | null) =>
  sessionId
    ? `${url}${url.includes("?") ? "&" : "?"}session=${encodeURIComponent(sessionId)}`
    : url;

export interface BrowserSettings {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly zoomFactor: number;
  readonly colorScheme: "system" | "light" | "dark";
}

const settingsKey = (projectId: string, tabId: string, conversationId?: string | null) =>
  `ade.browser.settings.${encodeURIComponent(projectId)}.${encodeURIComponent(conversationId ?? "")}.${encodeURIComponent(tabId)}`;

function savedBrowserSettings(
  projectId: string,
  tabId: string,
  conversationId?: string | null,
): BrowserSettings | null {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(settingsKey(projectId, tabId, conversationId)) ?? "null",
    );
    if (!value || typeof value !== "object") return null;
    const candidate = value as BrowserSettings;
    if (
      !candidate.viewport ||
      !viewportAcceptable(candidate.viewport) ||
      !Number.isFinite(candidate.zoomFactor) ||
      candidate.zoomFactor < 0.25 ||
      candidate.zoomFactor > 5 ||
      !["system", "light", "dark"].includes(candidate.colorScheme)
    )
      return null;
    return candidate;
  } catch {
    return null;
  }
}

export const getBrowserSettings = async (
  projectId: string,
  tabId?: string,
  conversationId?: string | null,
) => {
  const current = await request<BrowserSettings>(
    withBrowserSession(
      `/api/projects/${encodeURIComponent(projectId)}/browser/settings${tabId ? `?tab=${encodeURIComponent(tabId)}` : ""}`,
      conversationId,
    ),
  );
  const saved = tabId ? savedBrowserSettings(projectId, tabId, conversationId) : null;
  if (!saved || JSON.stringify(saved) === JSON.stringify(current)) return current;
  return adjustBrowserSettings(projectId, saved, tabId, conversationId);
};

export const adjustBrowserSettings = async (
  projectId: string,
  settings: Partial<BrowserSettings> & { clear?: "cookies" | "cache" },
  tabId?: string,
  conversationId?: string | null,
) => {
  const next = await request<BrowserSettings>(
    withBrowserSession(
      `/api/projects/${encodeURIComponent(projectId)}/browser/settings`,
      conversationId,
    ),
    "POST",
    { ...settings, ...(tabId ? { tabId } : {}) },
  );
  if (tabId) {
    try {
      window.localStorage.setItem(
        settingsKey(projectId, tabId, conversationId),
        JSON.stringify(next),
      );
    } catch {
      /* Storage is optional. */
    }
  }
  return next;
};

export interface InspectedBrowserElement {
  readonly pageUrl: string;
  readonly pageTitle: string | null;
  readonly tagName: string;
  readonly selector: string | null;
  readonly htmlPreview: string;
  readonly styles: string;
  readonly componentName: string | null;
  readonly source: {
    readonly fileName: string;
    readonly lineNumber: number | null;
    readonly columnNumber: number | null;
  } | null;
  readonly stack?: readonly {
    readonly functionName: string | null;
    readonly fileName: string | null;
    readonly lineNumber: number | null;
    readonly columnNumber: number | null;
  }[];
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export const inspectBrowserElement = (
  projectId: string,
  x: number,
  y: number,
  tabId?: string,
  includeContext = true,
  conversationId?: string | null,
) =>
  request<{ element: InspectedBrowserElement | null }>(
    withBrowserSession(
      `/api/projects/${encodeURIComponent(projectId)}/browser/inspect-element`,
      conversationId,
    ),
    "POST",
    { x, y, ...(tabId ? { tabId } : {}), ...(includeContext ? {} : { includeContext: false }) },
  );

export const inspectBrowserRegion = (
  projectId: string,
  rect: { x: number; y: number; width: number; height: number },
  tabId?: string,
  conversationId?: string | null,
) =>
  request<{ elements: InspectedBrowserElement[] }>(
    withBrowserSession(
      `/api/projects/${encodeURIComponent(projectId)}/browser/inspect-region`,
      conversationId,
    ),
    "POST",
    { rect, ...(tabId ? { tabId } : {}) },
  );

export const getBrowserAnnotationRects = (
  projectId: string,
  selectors: readonly string[],
  tabId?: string,
  conversationId?: string | null,
) =>
  request<{ rects: (InspectedBrowserElement["rect"] | null)[] }>(
    withBrowserSession(
      `/api/projects/${encodeURIComponent(projectId)}/browser/annotation-rects`,
      conversationId,
    ),
    "POST",
    { selectors, ...(tabId ? { tabId } : {}) },
  );

export interface BrowserAnnotationStyleChange {
  readonly selector: string;
  readonly property: string;
  readonly value: string;
  readonly previousValue: string;
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export const applyBrowserAnnotationStyle = (
  projectId: string,
  sessionId: string,
  selector: string,
  property: string,
  value: string,
  tabId?: string,
  conversationId?: string | null,
) =>
  request<{ result: BrowserAnnotationStyleChange }>(
    withBrowserSession(
      `/api/projects/${encodeURIComponent(projectId)}/browser/annotation-style`,
      conversationId,
    ),
    "POST",
    { action: "apply", sessionId, selector, property, value, ...(tabId ? { tabId } : {}) },
  );

export const restoreBrowserAnnotationStyles = (
  projectId: string,
  sessionId: string,
  selector?: string,
  conversationId?: string | null,
) =>
  request<{ result: null }>(
    withBrowserSession(
      `/api/projects/${encodeURIComponent(projectId)}/browser/annotation-style`,
      conversationId,
    ),
    "POST",
    { action: "restore", sessionId, ...(selector ? { selector } : {}) },
  );

export type BrowserRequestError = RequestError;

export const getBrowserStatus = (projectId: string, conversationId?: string | null) =>
  request<BrowserStatus>(
    withBrowserSession(`/api/projects/${encodeURIComponent(projectId)}/browser`, conversationId),
  );

export interface BrowserLocalServer {
  readonly port: number;
  readonly host: string;
  readonly url: string;
  readonly title: string;
  readonly status: number;
  readonly processName?: string;
  readonly pid?: number;
}

/** Web servers already listening on this machine, offered by the preview's empty state. */
export const getBrowserLocalServers = async (
  projectId: string,
  conversationId?: string | null,
): Promise<readonly BrowserLocalServer[]> => {
  const { servers } = await request<{ servers: BrowserLocalServer[] }>(
    withBrowserSession(
      `/api/projects/${encodeURIComponent(projectId)}/browser/local-servers`,
      conversationId,
    ),
  );
  return (Array.isArray(servers) ? servers : []).filter(
    (server) =>
      Number.isInteger(server?.port) &&
      server.port > 0 &&
      server.port < 65536 &&
      typeof server.url === "string" &&
      /^https?:\/\//i.test(server.url),
  );
};

export const getBrowserDevtools = (
  projectId: string,
  tabId?: string | null,
  conversationId?: string | null,
) =>
  request<{ socketPath: string }>(
    withBrowserSession(
      `/api/projects/${encodeURIComponent(projectId)}/browser/devtools${tabId ? `?tab=${encodeURIComponent(tabId)}` : ""}`,
      conversationId,
    ),
  );

/** Take or hand back control of the shared agent browser, as `viewer`. */
export const postBrowserControl = (
  projectId: string,
  action: BrowserControlAction,
  viewer: string,
  conversationId?: string | null,
) =>
  request<BrowserControlState>(
    withBrowserSession(
      `/api/projects/${encodeURIComponent(projectId)}/computer/control`,
      conversationId,
    ),
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
  conversationId?: string | null,
) =>
  request<{ answered: true }>(
    withBrowserSession(
      `/api/projects/${encodeURIComponent(projectId)}/browser/file-chooser`,
      conversationId,
    ),
    "POST",
    { chooserId, attachmentIds, viewer },
  );
