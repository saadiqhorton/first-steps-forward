export function createDiffInterestController(
  post: (projectId: string, diff: boolean) => Promise<void>,
): {
  watch(projectId: string): () => void;
  idle(): Promise<void>;
};
