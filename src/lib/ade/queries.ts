import { queryOptions } from "@tanstack/react-query";
import { listEditorEntries, listEditorPreviews, loadEditorFile } from "@/lib/ade/editorApi";
import { listDocuments, listWorkflows } from "@/lib/ade/api";
import { listProcesses, loadProcessOutput } from "@/lib/ade/processesApi";
import { listSkills, readSkillFile } from "@/lib/ade/skillsApi";
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

/**
 * Sizes, media kinds and first lines for the files directly inside `directory`. Previews are
 * decoration, so a failure falls straight back to plain page icons instead of holding blank
 * tiles through retries.
 */
export const entryPreviewsQuery = (projectId: string, directory = "") =>
  queryOptions({
    queryKey: ["entry-previews", projectId, directory],
    queryFn: async () => (await listEditorPreviews(projectId, directory)).previews,
    staleTime: SECTION_STALE_MS,
    retry: false,
  });

export const skillsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["skills", projectId],
    queryFn: () => listSkills(projectId),
    staleTime: SECTION_STALE_MS,
  });

export const skillFileQuery = (projectId: string, rootId: string, skill: string, path: string) =>
  queryOptions({
    queryKey: ["skill-file", projectId, rootId, skill, path],
    queryFn: () => readSkillFile(projectId, rootId, skill, path),
    staleTime: SECTION_STALE_MS,
    enabled: Boolean(path),
  });

/** The project's processes, refreshed while the page is open: a server can exit at any time. */
export const processesQuery = (projectId: string) =>
  queryOptions({
    queryKey: ["processes", projectId] as const,
    queryFn: () => listProcesses(projectId),
    staleTime: 0,
    refetchInterval: 2_000,
  });

/** One process's output. Polling keeps "follow latest" honest without a stream. */
export const processOutputQuery = (processId: string | null) =>
  queryOptions({
    queryKey: ["process-output", processId] as const,
    queryFn: () => loadProcessOutput(processId ?? "", 0),
    enabled: !!processId,
    staleTime: 0,
    refetchInterval: 1_200,
  });
