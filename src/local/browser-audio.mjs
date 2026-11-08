// Per-tab sound state for ADE's explicitly configured full-Chromium mode. Chrome's tabs API
// controls the actual WebContents, including media elements, WebAudio, and cross-origin frames.
// The worker has no externally connectable extension interface.
export const AUDIO_EXTENSION_ID = "ikpnhjcnkphpkcgmhlmlgofdeajaodhp";
const WORKER_URL = `chrome-extension://${AUDIO_EXTENSION_ID}/worker.js`;
const WORKER_SCOPE = `chrome-extension://${AUDIO_EXTENSION_ID}/`;
// Chromium may restart an idle MV3 worker between the wake and the call; retry those races.
const WORKER_ATTEMPTS = 3;
const WORKER_RETRY_MS = 50;
const knownContexts = new WeakSet();
const enabledSessions = new WeakSet();

export function browserAudioAvailable(context) {
  if (context.serviceWorkers?.().some((worker) => worker.url() === WORKER_URL)) {
    knownContexts.add(context);
    return true;
  }
  return knownContexts.has(context);
}

async function findWorker(context) {
  let worker = context.serviceWorkers?.().find((candidate) => candidate.url() === WORKER_URL);
  if (!worker) {
    worker = await context
      .waitForEvent("serviceworker", {
        predicate: (candidate) => candidate.url() === WORKER_URL,
        timeout: 2000,
      })
      .catch(() => null);
  }
  return worker ?? null;
}

/** Return null when this context cannot load the private audio extension. */
export async function tabAudioState(context, cdp, muted) {
  if (!browserAudioAvailable(context)) return null;
  // Playwright can keep a stale worker handle after Chromium stops an idle MV3 worker.
  // Wake its registered scope before evaluating, without navigating the user's page.
  if (!enabledSessions.has(cdp)) {
    await cdp.send("ServiceWorker.enable");
    enabledSessions.add(cdp);
  }
  const { targetInfo } = await cdp.send("Target.getTargetInfo");
  if (!targetInfo?.targetId) return null;
  for (let attempt = 0; attempt < WORKER_ATTEMPTS; attempt += 1) {
    // A worker that is already running rejects "start"; that is fine, it is awake.
    await cdp.send("ServiceWorker.startWorker", { scopeURL: WORKER_SCOPE }).catch(() => {});
    const worker = await findWorker(context);
    if (!worker) continue;
    try {
      return await worker.evaluate(
        async ({ targetId, muted }) => {
          const target = (await chrome.debugger.getTargets()).find(
            (candidate) => candidate.id === targetId && candidate.type === "page",
          );
          if (!target || typeof target.tabId !== "number") return null;
          if (typeof muted === "boolean") await chrome.tabs.update(target.tabId, { muted });
          const tab = await chrome.tabs.get(target.tabId);
          if (typeof tab.mutedInfo?.muted !== "boolean") return null;
          return { muted: tab.mutedInfo.muted, audible: tab.audible === true };
        },
        { targetId: targetInfo.targetId, muted },
      );
    } catch (error) {
      // "Service worker restarted": wake it again and retry with a fresh handle.
      if (attempt === WORKER_ATTEMPTS - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, WORKER_RETRY_MS));
    }
  }
  return null;
}
