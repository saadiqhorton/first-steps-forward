import type { SkillDocument, SkillDocumentField, SkillMetadata } from "./skillFormat.mjs";

export declare const SKILL_FILE: string;

export type SkillFileKind = "instructions" | "reference" | "script" | "asset" | "agent" | "other";

export type SkillDocumentField = { key: string; value: string };

export type SkillMetadata = Record<string, string>;

export type SkillDocument = {
  fields: SkillDocumentField[];
  metadata: SkillMetadata;
  body: string;
  hasFrontmatter: boolean;
  kind: SkillFileKind;
};

export declare const SKILL_FILE_KINDS: Record<SkillFileKind, string>;

export declare const SKILL_KIND_ORDER: SkillFileKind[];

export declare function skillFileKind(path: string): SkillFileKind;

export declare function isTextFile(path: string): boolean;

export declare function isImageFile(path: string): boolean;

export declare function fileContentType(path: string): string;

export declare function validateSkillName(name: string): string | null;

export declare function validateSkillDescription(description: string): string | null;

export declare function skillNameMismatch(folder: string, name: string): string | null;

export declare function parseSkillDocument(text: string): {
  fields: SkillDocumentField[];
  metadata: SkillMetadata;
  body: string;
  hasFrontmatter: boolean;
};

export declare function serializeSkillDocument(document: {
  fields?: SkillDocumentField[];
  metadata?: SkillMetadata;
  body?: string;
}): string;

export declare function skillField(
  document: { fields?: SkillDocumentField[] },
  key: string,
): string;

export declare function buildSkillDocument(input: {
  name?: string;
  description?: string;
  body?: string;
  license?: string;
  compatibility?: string;
  metadata?: SkillMetadata;
  allowedTools?: string;
  extra?: Record<string, string>;
}): string;

export declare function skillLocation(rootPath: string, projectPath: string, home: string): string;
