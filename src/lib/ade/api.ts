import type { ProjectDocument, Workflow } from "./types";

export type RequestError = Error & { status?: number; authRequired?: boolean; code?: string };

export async function request<T>(
  url: string,
  method = "GET",
  data?: unknown,
  init?: Omit<RequestInit, "method" | "body" | "headers">,
): Promise<T> {
  const requestInit: RequestInit = { method, ...init };
  if (data) {
    requestInit.headers = { "content-type": "application/json" };
    requestInit.body = JSON.stringify(data);
  }
  const response = await fetch(url, requestInit);
  const value = (await response.json()) as {
    error?: string;
    authRequired?: boolean;
    code?: string;
  };
  if (!response.ok) {
    const error: RequestError = new Error(value.error ?? `Local API returned ${response.status}`);
    error.status = response.status;
    error.authRequired = value.authRequired === true;
    if (value.code !== undefined) error.code = value.code;
    throw error;
  }
  return value as T;
}

export async function listWorkflows(): Promise<Workflow[]> {
  const data = await request<{ workflows: Workflow[] }>("/api/workflows");
  return data.workflows;
}

export async function listDocuments(projectId: string): Promise<ProjectDocument[]> {
  const data = await request<{ documents: ProjectDocument[] }>(
    `/api/editor/${projectId}/documents`,
  );
  return data.documents;
}
