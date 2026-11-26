/** Whether the preview WebSocket should be open. */
export function streamWanted({ projectId, resting, place, canvas, visible, recording }) {
  if (projectId == null || resting) return false;
  if (place === "float" || recording) return true;
  return canvas != null && visible;
}
