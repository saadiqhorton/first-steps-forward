/** Select the longest prefix that fits without splitting an individual capture. */
export function feedbackBatchSize(drafts, existingCount, existingBytes, limits, isRecording) {
  let count = 0;
  let fileCount = existingCount;
  let bytes = existingBytes;
  for (const draft of drafts) {
    let draftBytes = 0;
    for (const file of draft.files) {
      const recording = isRecording(file);
      if (file.size > (recording ? limits.recordingBytes : limits.fileBytes)) return count;
      if (!recording) draftBytes += file.size;
    }
    if (fileCount + draft.files.length > limits.files || bytes + draftBytes > limits.turnBytes)
      break;
    fileCount += draft.files.length;
    bytes += draftBytes;
    count++;
  }
  return count;
}
