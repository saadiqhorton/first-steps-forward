/** Pure helpers for browser dictation (Web Speech API). No speech model, no server. */

export const NO_RECOGNITION =
  "This browser has no built-in speech recognition. Use Chrome, Edge or Safari.";
export const NOT_SECURE =
  "Dictation needs a secure link. Open ADE on this computer, or use its HTTPS (Tailscale) link.";
export const MIC_FALLBACK_NOTICE =
  "Your chosen microphone isn't connected, so dictation is using the system default.";

/** Whether dictation can run here. A secure context is checked first: it gates both APIs. */
export function dictationSupport({ hasRecognition, isSecureContext, hasMediaDevices }) {
  if (!isSecureContext) return { ok: false, reason: NOT_SECURE };
  if (!hasRecognition) return { ok: false, reason: NO_RECOGNITION };
  return { ok: true, canPickMic: !!hasMediaDevices };
}

const MESSAGES = {
  "not-allowed":
    "Microphone access is blocked for this site. Allow it in the browser's site settings, then try again.",
  NotAllowedError:
    "Microphone access is blocked for this site. Allow it in the browser's site settings, then try again.",
  SecurityError:
    "Microphone access is blocked for this site. Allow it in the browser's site settings, then try again.",
  "service-not-allowed":
    "The browser's speech service is turned off or not allowed here. Check the browser's speech and privacy settings.",
  "audio-capture": "No microphone found. Connect one and try again.",
  NotFoundError: "No microphone found. Connect one and try again.",
  OverconstrainedError: "No microphone found. Connect one and try again.",
  NotReadableError:
    "The microphone is in use by another app or blocked by the system. Close the other app and try again.",
  network:
    "This browser couldn't reach its speech service. Embedded browsers often don't have one; try Chrome, Edge or Safari.",
  "language-not-supported": "The browser's speech service doesn't support your browser language.",
  "track-ended": "The microphone was disconnected, so dictation stopped.",
};

/**
 * User-facing message for a SpeechRecognition error code or getUserMedia DOMException name.
 * Returns null for codes that are not failures worth showing (aborted, no-speech).
 */
export function errorMessage(code) {
  if (code === "aborted" || code === "no-speech") return null;
  if (typeof code === "string" && Object.hasOwn(MESSAGES, code)) return MESSAGES[code];
  return `Dictation stopped: ${code || "unknown error"}.`;
}

// Engines prefix later results with a space ("hello", " world"), so a joined interim can
// carry doubled spaces; collapse them inside each piece.
const pieces = (list) =>
  list
    .map((part) =>
      String(part ?? "")
        .replace(/[ \t]{2,}/g, " ")
        .trim(),
    )
    .filter((part) => part.length > 0);

/** Insert dictated text between `before` and `after` with single, sensible spacing. */
export function composeDictation({ before, after, finals, interim = "" }) {
  const dictated = pieces([...(finals ?? []), interim]).join(" ");
  if (!dictated) return { text: before + after, caret: before.length };
  const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const trail = after.length > 0 && !/^[\s.,;:!?)\]}]/.test(after) ? " " : "";
  const head = before + lead + dictated;
  return { text: head + trail + after, caret: head.length };
}

const PSEUDO_DEVICE_IDS = new Set(["", "default", "communications"]);

/**
 * Real microphones from enumerateDevices(). The browser's "default"/"communications" aliases
 * are covered by "System default". Labels stay empty until mic permission is granted once.
 */
export function listMics(devices) {
  const inputs = (devices ?? []).filter((device) => device.kind === "audioinput");
  const labelsHidden = inputs.length === 0 || inputs.some((device) => !device.label);
  const mics = inputs
    .filter((device) => !PSEUDO_DEVICE_IDS.has(device.deviceId))
    // Numbered among real mics only, so the aliases do not leave gaps.
    .map((device, index) => ({
      id: device.deviceId,
      label: device.label || `Microphone ${index + 1}`,
    }));
  return { mics, labelsHidden };
}

/**
 * Which deviceId to request ("" = system default) and whether the saved mic is missing.
 * Before permission the browser hides device ids, so a saved id cannot be verified yet:
 * it is tried as-is and getUserMedia reports if it is gone.
 */
export function resolveMic(mics, savedId, verified = true) {
  if (!savedId) return { deviceId: "", missing: false };
  if (!verified || mics.some((mic) => mic.id === savedId)) {
    return { deviceId: savedId, missing: false };
  }
  return { deviceId: "", missing: true };
}

const TRACK_BRANDS = new Set(["Chromium", "Google Chrome", "Microsoft Edge"]);

/** Chrome/Edge 135+ accept a MediaStreamTrack in SpeechRecognition.start(); others use their default mic. */
export function micRoutingSupported(brands, mobile = false) {
  // Phones route audio to the connected headset themselves, and a second capture of the same
  // mic beside the speech engine is untested there, so phones use the engine's own capture.
  if (mobile) return false;
  return (brands ?? []).some(
    (entry) => TRACK_BRANDS.has(entry.brand) && Number.parseInt(entry.version, 10) >= 135,
  );
}
