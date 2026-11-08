export function feedbackBatchSize<T extends { size: number }>(
  drafts: readonly { readonly files: readonly T[] }[],
  existingCount: number,
  existingBytes: number,
  limits: { files: number; fileBytes: number; turnBytes: number; recordingBytes: number },
  isRecording: (file: T) => boolean,
): number;
