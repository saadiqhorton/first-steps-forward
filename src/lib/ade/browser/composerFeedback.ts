import {
  loadFeedbackDraft,
  persistFeedbackFile,
  restoreFeedbackFile,
  saveFeedbackDraft,
  saveFeedbackDrafts,
} from "./feedbackPersistence";
import { warnUser } from "@/components/ade/NoticeDialog";

/** Browser feedback waits here until its conversation composer is mounted. */
interface BrowserFeedbackDraft {
  readonly text: string;
  readonly files: readonly File[];
}

export const MAX_BROWSER_RECORDING_BYTES = 1024 * 1024 * 1024;
export const isBrowserRecording = (file: File): boolean =>
  file.name === "browser-recording.webm" && file.type === "video/webm";

const pending = new Map<string, BrowserFeedbackDraft[]>();
const listeners = new Set<() => void>();
type StoredFeedback = { text: string; files: ReturnType<typeof persistFeedbackFile>[] };
const loading = new Map<string, Promise<void>>();
const failed = new Set<string>();
const transfers = new Map<
  string,
  { taken: BrowserFeedbackDraft[]; done: Promise<void>; resolve: () => void }
>();
let warned = false;
function warnStorage(error: unknown) {
  console.warn("Could not store browser feedback:", error);
  if (warned) return;
  warned = true;
  void warnUser(
    "Browser feedback remains available in this window, but could not be saved for reload.",
  );
}

function saveQueue(scope: string) {
  if (failed.has(scope)) return Promise.resolve();
  const queueKey = `composer-feedback-queue:${scope}`;
  const value = storedQueue(scope);
  return saveFeedbackDraft(queueKey, value.length ? value : undefined).catch((error) => {
    warnStorage(error);
  });
}

function storedQueue(scope: string): StoredFeedback[] {
  return (pending.get(scope) ?? []).map((draft) => ({
    text: draft.text,
    files: draft.files.map(persistFeedbackFile),
  }));
}

export function ensureBrowserFeedbackLoaded(scope: string): Promise<void> {
  const existing = loading.get(scope);
  if (existing) return existing;
  const work = loadFeedbackDraft<StoredFeedback[]>(`composer-feedback-queue:${scope}`)
    .then((saved) => {
      const restored = (saved ?? []).map((draft) => ({
        text: draft.text,
        files: draft.files.map(restoreFeedbackFile),
      }));
      if (restored.length) pending.set(scope, [...restored, ...(pending.get(scope) ?? [])]);
    })
    .catch((error) => {
      failed.add(scope);
      warnStorage(error);
    })
    .then(() => {
      for (const listener of listeners) listener();
    });
  loading.set(scope, work);
  return work;
}

export async function addBrowserFeedback(
  sessionId: string,
  draft: BrowserFeedbackDraft,
): Promise<void> {
  await ensureBrowserFeedbackLoaded(sessionId);
  while (transfers.has(sessionId)) await transfers.get(sessionId)!.done;
  pending.set(sessionId, [...(pending.get(sessionId) ?? []), draft]);
  await saveQueue(sessionId);
  for (const listener of listeners) listener();
}

export function takeBrowserFeedback(
  sessionId: string,
  count: number,
  deferPersistence = false,
): readonly BrowserFeedbackDraft[] {
  if (transfers.has(sessionId)) return [];
  const drafts = pending.get(sessionId) ?? [];
  const taken = drafts.slice(0, count);
  const remaining = drafts.slice(count);
  if (remaining.length) pending.set(sessionId, remaining);
  else pending.delete(sessionId);
  if (deferPersistence && taken.length) {
    let resolve!: () => void;
    const done = new Promise<void>((finish) => {
      resolve = finish;
    });
    transfers.set(sessionId, { taken, done, resolve });
  } else void saveQueue(sessionId);
  return taken;
}

/**
 * Save the composer draft and drop its transferred feedback from the queue in one
 * transaction, so an interruption between the two writes cannot restore a duplicate.
 */ export function saveComposerDraft(scope: string, value: unknown): Promise<void> {
  const draftKey = `composer:${scope}`;
  const transfer = transfers.get(scope);
  if (!transfer) return saveFeedbackDraft(draftKey, value);
  const queue = storedQueue(scope);
  const entries: (readonly [string, unknown])[] = [[draftKey, value]];
  // A scope whose saved queue could not be read keeps that queue: rewriting it from
  // memory alone would delete feedback this window never saw.
  if (!failed.has(scope))
    entries.push([`composer-feedback-queue:${scope}`, queue.length ? queue : undefined]);
  return saveFeedbackDrafts(entries).then(() => {
    if (transfers.get(scope) === transfer) transfers.delete(scope);
    transfer.resolve();
  });
}

/** Keep the old queue on disk until the composer has saved the transferred files. */
export async function finishBrowserFeedbackTransfer(
  sessionId: string,
  saved: boolean,
  restoreInMemory = false,
): Promise<void> {
  const transfer = transfers.get(sessionId);
  if (!transfer) return;
  if (saved) await saveQueue(sessionId);
  else {
    if (restoreInMemory)
      pending.set(sessionId, [...transfer.taken, ...(pending.get(sessionId) ?? [])]);
    else failed.add(sessionId);
  }
  if (transfers.get(sessionId) === transfer) transfers.delete(sessionId);
  transfer.resolve();
  for (const listener of listeners) listener();
}

export function peekBrowserFeedback(sessionId: string): readonly BrowserFeedbackDraft[] {
  if (transfers.has(sessionId)) return [];
  return pending.get(sessionId) ?? [];
}

export function subscribeBrowserFeedback(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
