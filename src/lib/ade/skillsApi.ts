import { request } from "./api";
import type { SkillFileKind } from "@/shared/skill-format.mjs";

export type SkillScope = "ade" | "detected";

export type SkillFile = {
  path: string;
  kind: SkillFileKind;
  bytes: number;
  /** Whether the file is text the workspace can edit. */
  text?: boolean;
  /** Whether the file is an image a browser can show. */
  image?: boolean;
};

export type SkillMetadata = Record<string, string>;

export type Skill = {
  id: string;
  folder: string;
  name: string;
  description: string;
  rootId: string;
  scope: SkillScope;
  editable: boolean;
  location: string;
  path: string;
  files: SkillFile[];
  warnings: string[];
  license: string;
  compatibility: string;
  allowedTools: string;
  metadata: SkillMetadata;
  body: string;
  updatedAt: number;
};

export type SkillFileContent = {
  path: string;
  content: string;
  version: string;
};

const ROOT_IDS = {
  adeProject: "ade-project",
  adeUser: "ade-user",
  detectedProject: "detected-project",
  detectedUser: "detected-user",
} as const;

/** The folders ADE writes to. Everything else is read-only. */
export const ADE_SKILL_ROOTS = [ROOT_IDS.adeProject, ROOT_IDS.adeUser];

export const SKILL_ROOT_LABELS: Record<string, string> = {
  [ROOT_IDS.adeProject]: "This project",
  [ROOT_IDS.adeUser]: "My ADE",
  [ROOT_IDS.detectedProject]: "Found in the project",
  [ROOT_IDS.detectedUser]: "Found in your home",
};

export async function listSkills(projectId: string): Promise<Skill[]> {
  const data = await request<{ skills: Skill[] }>(`/api/skills/${projectId}`);
  return data.skills;
}

/** The URL for a bundled file's bytes, so images and PDFs can be shown. */
export function skillAssetUrl(
  projectId: string,
  rootId: string,
  skill: string,
  path: string,
): string {
  const params = new URLSearchParams({ root: rootId, skill, path });
  return `/api/skills/${projectId}/raw?${params}`;
}

export async function readSkillFile(
  projectId: string,
  rootId: string,
  skill: string,
  path: string,
): Promise<SkillFileContent> {
  const params = new URLSearchParams({ root: rootId, skill, path });
  return request<SkillFileContent>(`/api/skills/${projectId}/file?${params}`);
}

export async function writeSkillFile(
  projectId: string,
  rootId: string,
  skill: string,
  path: string,
  content: string,
  version: string,
): Promise<{ path: string; version: string }> {
  return request<{ path: string; version: string }>(`/api/skills/${projectId}/file`, "POST", {
    rootId,
    skill,
    path,
    content,
    version,
  });
}

export async function createSkillFile(
  projectId: string,
  rootId: string,
  skill: string,
  path: string,
): Promise<{ path: string; version: string }> {
  return request<{ path: string; version: string }>(
    `/api/skills/${projectId}/file/create`,
    "POST",
    {
      rootId,
      skill,
      path,
    },
  );
}

export async function deleteSkillFile(
  projectId: string,
  rootId: string,
  skill: string,
  path: string,
): Promise<{ ok: boolean; path: string }> {
  return request<{ ok: boolean; path: string }>(`/api/skills/${projectId}/file/delete`, "POST", {
    rootId,
    skill,
    path,
  });
}

export async function saveSkill(
  projectId: string,
  input: {
    rootId: string;
    folder?: string;
    name: string;
    description: string;
    body?: string;
    license?: string;
    compatibility?: string;
    allowedTools?: string;
    metadata?: SkillMetadata;
  },
): Promise<Skill> {
  return request<Skill>(`/api/skills/${projectId}/skill`, "POST", input);
}

export async function deleteSkill(
  projectId: string,
  rootId: string,
  skill: string,
): Promise<{ ok: boolean; folder: string }> {
  return request<{ ok: boolean; folder: string }>(`/api/skills/${projectId}/skill/delete`, "POST", {
    rootId,
    skill,
  });
}

export async function copySkill(
  projectId: string,
  rootId: string,
  sourceRootId: string,
  skill: string,
): Promise<Skill> {
  return request<Skill>(`/api/skills/${projectId}/skill/copy`, "POST", {
    rootId,
    sourceRootId,
    skill,
  });
}

/** Copy a skill into another of ADE's own folders. */
export async function moveSkill(
  projectId: string,
  rootId: string,
  sourceRootId: string,
  skill: string,
): Promise<Skill> {
  return request<Skill>(`/api/skills/${projectId}/skill/move`, "POST", {
    rootId,
    sourceRootId,
    skill,
  });
}

/** Read a package in the browser and hand it to the local API. */
export async function importSkillPackage(
  projectId: string,
  rootId: string,
  file: File,
): Promise<Skill[]> {
  const data = request<{ skills: Skill[] }>(`/api/skills/${projectId}/import`, "POST", {
    rootId,
    data: await encodePackage(file),
  });
  return (await data).skills;
}

export type StagedSkill = {
  folder: string;
  name: string;
  description: string;
  files: SkillFile[];
  warnings: string[];
};

/** Read a package without writing anything, so the user sees what is inside. */
export async function previewSkillPackage(projectId: string, file: File): Promise<StagedSkill[]> {
  const data = request<{ skills: StagedSkill[] }>(
    `/api/skills/${projectId}/import/preview`,
    "POST",
    { data: await encodePackage(file) },
  );
  return (await data).skills;
}

async function encodePackage(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export type GithubRepo = {
  owner: string;
  name: string;
  ref: string;
  url: string;
  description: string;
  private: boolean;
};

export type GithubSkillCandidate = {
  folder: string;
  reason: string;
  status: "ready" | "warning" | "invalid";
  name: string;
  suggestedFolder: string;
  description: string;
  license: string;
  counts: Record<string, number>;
  bytes: number;
  fileCount: number;
  warnings: string[];
  errors: string[];
};

/** Find every skill in a repository and check each one against the format. */
export async function findSkillsOnGithub(
  projectId: string,
  url: string,
): Promise<{ repo: GithubRepo; skills: GithubSkillCandidate[] }> {
  return request<{ repo: GithubRepo; skills: GithubSkillCandidate[] }>(
    `/api/skills/${projectId}/github`,
    "POST",
    { url },
  );
}

/** Download the chosen skills into one of ADE's own folders. */
export async function importSkillsFromGithub(
  projectId: string,
  input: { url: string; folders: string[]; rootId: string },
): Promise<Skill[]> {
  const data = await request<{ skills: Skill[] }>(
    `/api/skills/${projectId}/github/import`,
    "POST",
    input,
  );
  return data.skills;
}
