import { queryOptions } from "@tanstack/react-query";
import { listEditorEntries, loadEditorFile } from "@/components/ade/editorApi";
import { listDocuments, listWorkflows } from "@/lib/ade/store";
import type { ProjectDocument } from "@/lib/ade/types";

/**
 * Cached data for the project section tabs. Revisiting a tab renders the last
 * result immediately and refreshes in the background instead of flashing a
 * loading state on every mount.
 */
const SECTION_STALE_MS = 5_000;

export const workflowsQuery = () =>
  queryOptions({
    queryKey: ["workflows"],
    queryFn: listWorkflows,
    staleTime: SECTION_STALE_MS,
  });

export const documentsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["documents", projectId],
    queryFn: () => listDocuments(projectId),
    staleTime: SECTION_STALE_MS,
  });

export const documentPreviewsQuery = (projectId: string, documents: ProjectDocument[]) =>
  queryOptions({
    queryKey: [
      "document-previews",
      projectId,
      documents.map((doc) => `${doc.path}:${doc.modifiedAt}`),
    ],
    queryFn: async () => {
      const entries = await Promise.all(
        documents.map(async (doc) => {
          try {
            const file = await loadEditorFile(projectId, doc.path);
            return [doc.path, file.content.split("\n").slice(0, 6).join("\n")] as const;
          } catch {
            return [doc.path, ""] as const;
          }
        }),
      );
      return Object.fromEntries(entries) as Record<string, string>;
    },
    staleTime: SECTION_STALE_MS,
    enabled: documents.length > 0,
  });

export const fileQuery = (projectId: string, path: string) =>
  queryOptions({
    queryKey: ["file", projectId, path],
    queryFn: () => loadEditorFile(projectId, path),
    staleTime: SECTION_STALE_MS,
  });

export const entriesQuery = (projectId: string, directory = "") =>
  queryOptions({
    queryKey: ["entries", projectId, directory],
    queryFn: async () => (await listEditorEntries(projectId, directory)).entries,
    staleTime: SECTION_STALE_MS,
  });
