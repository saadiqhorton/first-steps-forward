import type { ProjectDocument, Workflow } from "./types";

export type RequestError = Error & { status?: number; authRequired?: boolean };

export async function request<T>(url: string, method = "GET", data?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (data) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(data);
  }
  const response = await fetch(url, init);
  const value = (await response.json()) as { error?: string; authRequired?: boolean };
  if (!response.ok) {
    const error: RequestError = new Error(value.error ?? `Local API returned ${response.status}`);
    error.status = response.status;
    error.authRequired = value.authRequired === true;
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
