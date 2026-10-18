import {
  closePictureInPicture,
  openPictureInPicture,
  pictureInPictureKey,
} from "@/lib/ade/browser/pictureInPicture";

/**
 * Open the browser's canvas as a picture-in-picture window, or close it when this project's
 * window is already open. Call from a click handler so the browser allows the request.
 */
export async function togglePictureInPicture(
  projectId: string,
  canvas: HTMLCanvasElement,
): Promise<void> {
  if (pictureInPictureKey() === projectId) {
    closePictureInPicture();
    return;
  }
  await openPictureInPicture({ key: projectId, source: canvas });
}

/** Open a page's address in the person's own browser. Only http(s) addresses are opened. */
export function openExternally(url: string | undefined): void {
  if (!url || !/^https?:\/\//i.test(url)) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
