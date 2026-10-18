// Adapted from T3 Code (https://github.com/pingdotgg/t3code): apps/web/src/browser/serverPictureInPicture.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
//
// Pop-out for the browser preview. The source canvas is captured directly, so the floating
// window shows exactly what the surface paints, with no second stream. Read-only: the video
// never receives input.

interface WebKitVideo {
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
}

interface ActivePictureInPicture {
  readonly key: string;
  readonly stop: () => void;
}

// Module-level so the floating window survives unmounts of the surface that started it.
let active: ActivePictureInPicture | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

/** Subscribe to open and close changes. Returns the unsubscribe function. */
export function subscribePictureInPicture(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Key of the open floating window (the project id), or null. For useSyncExternalStore. */
export function pictureInPictureKey(): string | null {
  return active?.key ?? null;
}

export function supportsPictureInPicture(): boolean {
  if (typeof document === "undefined") return false;
  if (typeof HTMLCanvasElement.prototype.captureStream !== "function") return false;
  const video = HTMLVideoElement.prototype as HTMLVideoElement & WebKitVideo;
  return (
    (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === "function") ||
    typeof video.webkitSetPresentationMode === "function"
  );
}

/** Close the floating window, if one is open. */
export function closePictureInPicture(): void {
  const current = active;
  active = null;
  current?.stop();
  emit();
}

/**
 * Pop the canvas out into a floating window. Call from a user gesture: the browser only allows
 * requestPictureInPicture during user activation. Opening replaces any window already open.
 * `onLeave` runs when the person closes the floating window, not when this module closes it.
 */
export async function openPictureInPicture(input: {
  readonly key: string;
  readonly source: HTMLCanvasElement;
  readonly onLeave?: () => void;
}): Promise<void> {
  closePictureInPicture();
  const stream = input.source.captureStream();
  const video = document.createElement("video") as HTMLVideoElement & WebKitVideo;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  // Safari only floats a video that is in the document.
  video.style.cssText =
    "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.append(video);

  const leave = () => {
    if (active !== current) return;
    closePictureInPicture();
    input.onLeave?.();
  };
  const onPresentationMode = () => {
    if (video.webkitPresentationMode !== "picture-in-picture") leave();
  };
  const current: ActivePictureInPicture = {
    key: input.key,
    stop: () => {
      video.removeEventListener("leavepictureinpicture", leave);
      video.removeEventListener("webkitpresentationmodechanged", onPresentationMode);
      if (document.pictureInPictureElement === video) {
        void document.exitPictureInPicture().catch(() => undefined);
      } else if (video.webkitPresentationMode === "picture-in-picture") {
        video.webkitSetPresentationMode?.("inline");
      }
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
      video.remove();
    },
  };
  active = current;
  emit();

  try {
    await video.play();
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise((resolve) => {
        video.addEventListener("loadedmetadata", resolve, { once: true });
      });
    }
    if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === "function") {
      video.addEventListener("leavepictureinpicture", leave);
      await video.requestPictureInPicture();
    } else {
      video.addEventListener("webkitpresentationmodechanged", onPresentationMode);
      video.webkitSetPresentationMode?.("picture-in-picture");
    }
  } catch (error) {
    if (active === current) closePictureInPicture();
    throw error;
  }
}
