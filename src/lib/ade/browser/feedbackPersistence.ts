import type { MessageAttachment } from "@/lib/ade/types";
import { recordingAttachment, restoreRecordingAttachment } from "./recordingUpload";

interface StoredFile {
  name: string;
  type: string;
  lastModified: number;
  blob?: Blob;
  recording?: MessageAttachment;
}

/** Store only the existing server attachment reference for a streamed recording. */
export function persistFeedbackFile(file: File): StoredFile {
  const recording = recordingAttachment(file);
  return recording
    ? { name: file.name, type: file.type, lastModified: file.lastModified, recording }
    : { name: file.name, type: file.type, lastModified: file.lastModified, blob: file };
}

export function restoreFeedbackFile(stored: StoredFile): File {
  if (stored.recording) return restoreRecordingAttachment(stored.recording);
  if (!(stored.blob instanceof Blob)) throw new Error("A saved feedback attachment is missing.");
  return new File([stored.blob], stored.name, {
    type: stored.type,
    lastModified: stored.lastModified,
  });
}

let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open("ade-feedback-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open draft storage."));
    request.onblocked = () => reject(new Error("Draft storage is blocked by another window."));
  });
  void database.catch(() => {
    database = undefined;
  });
  return database;
}

const writes = new Map<string, Promise<void>>();

export async function loadFeedbackDraft<T>(key: string): Promise<T | undefined> {
  await writes.get(key)?.catch(() => {});
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", "readonly");
    const request = transaction.objectStore("drafts").get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

/** Serialize writes to each key so an older snapshot cannot overwrite a newer one. */
export function saveFeedbackDraft(key: string, value: unknown | undefined): Promise<void> {
  return saveFeedbackDrafts([[key, value]]);
}

/** Commit related draft changes together, ordered with all writes to either key. */
export function saveFeedbackDrafts(
  entries: readonly (readonly [string, unknown | undefined])[],
): Promise<void> {
  const keys = [...new Set(entries.map(([key]) => key))];
  const previous = [
    ...new Set(keys.map((key) => writes.get(key)).filter((work) => work !== undefined)),
  ];
  const work = Promise.all(previous.map((pending) => pending.catch(() => {}))).then(async () => {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("drafts", "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Draft storage was interrupted."));
      try {
        const store = transaction.objectStore("drafts");
        for (const [key, value] of entries) {
          if (value === undefined) store.delete(key);
          else store.put(value, key);
        }
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  });
  for (const key of keys) writes.set(key, work);
  void work
    .finally(() => {
      for (const key of keys) if (writes.get(key) === work) writes.delete(key);
    })
    .catch(() => {});
  return work;
}
