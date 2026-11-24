// A real operating-system picture-in-picture window for the browser preview, as T3's
// "pop out" preview has. Uses the Document Picture-in-Picture API; the preview canvas is
// captured into a video element inside that window, so it keeps showing live frames.

/** @typedef {{ requestWindow: (options: { width: number, height: number }) => Promise<Window> }} PipApi */
/** @typedef {{ window: Window, close: () => void }} ActiveWindow */

/** @type {ActiveWindow | null} */
let active = null;

function api() {
  if (typeof window === "undefined") return null;
  /** @type {PipApi | undefined} */
  const value = /** @type {{ documentPictureInPicture?: PipApi }} */ (
    /** @type {unknown} */ (window)
  ).documentPictureInPicture;
  return value && typeof value.requestWindow === "function" ? value : null;
}

export function supportsBrowserPictureInPicture() {
  return (
    api() !== null &&
    typeof HTMLCanvasElement.prototype.captureStream === "function" &&
    typeof HTMLVideoElement.prototype.requestPictureInPicture === "function"
  );
}

/** Whether the preview is showing in its own window, which stays visible when the tab does not. */
export function browserPictureInPictureOpen() {
  return active !== null;
}

export function closeBrowserPictureInPicture() {
  const current = active;
  active = null;
  current?.close();
}

/**
 * Open from a user gesture, so the browser allows the new window.
 * @param {HTMLCanvasElement} source
 * @param {string} [title]
 */
export async function openBrowserPictureInPicture(source, title = "ADE browser") {
  closeBrowserPictureInPicture();
  const pip = api();
  if (!pip) throw new Error("This browser cannot open a picture-in-picture window.");
  if (typeof source.captureStream !== "function")
    throw new Error("The preview cannot be captured in this browser.");
  const rect = source.getBoundingClientRect();
  const width = Math.max(240, Math.min(1280, Math.round(rect.width) || 640));
  const height = Math.max(160, Math.min(1280, Math.round(rect.height) || 400));
  const popup = await pip.requestWindow({ width, height });
  popup.document.title = title;
  const style = popup.document.createElement("style");
  style.textContent =
    "html,body{margin:0;height:100%;background:#111;overflow:hidden}" +
    "video{width:100%;height:100%;object-fit:contain;display:block;background:#111}";
  popup.document.head.append(style);
  const video = popup.document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  const stream = source.captureStream();
  video.srcObject = stream;
  popup.document.body.append(video);
  const close = () => {
    if (active?.window === popup) active = null;
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
    video.remove();
    if (!popup.closed) popup.close();
  };
  active = { window: popup, close };
  popup.addEventListener("pagehide", close, { once: true });
  await video.play().catch(() => undefined);
}
