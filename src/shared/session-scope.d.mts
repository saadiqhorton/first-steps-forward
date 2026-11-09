export function sessionPairKey(projectId: string, sessionId: string): string;
export function browserScope(projectId: string, sessionId?: string | null): string;
export function browserScopeParts(key: string): {
  projectId: string;
  sessionId: string | null;
};
