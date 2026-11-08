import type { MessageAttachment } from "@/lib/ade/types";

// A small File is used as a composer token; the actual WebM is already on the local server.
const uploadedRecordings = new WeakMap<File, MessageAttachment>();

export function recordingAttachment(file: File): MessageAttachment | undefined {
  return uploadedRecordings.get(file);
}

/** Recreate the lightweight composer token after restoring a saved draft. */
export function restoreRecordingAttachment(attachment: MessageAttachment): File {
  const file = new File([new Uint8Array(1)], attachment.name, { type: attachment.mime });
  uploadedRecordings.set(file, attachment);
  return file;
}

export function recordingAttachmentUrl(file: File): string | undefined {
  const attachment = recordingAttachment(file);
  return attachment ? `/api/attachments/${encodeURIComponent(attachment.id)}` : undefined;
}

async function responseJson<T>(response: Response): Promise<T> {
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `Local API returned ${response.status}`);
  return value;
}

async function recordingFetch(input: string, init: RequestInit, timeout = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Saving the recording timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function createRecordingUpload(onFailure: (error: Error) => void) {
  const { id } = await responseJson<{ id: string }>(
    await recordingFetch("/api/attachments/recording/start", { method: "POST" }),
  );
  const base = `/api/attachments/recording/${encodeURIComponent(id)}`;
  let queue: Promise<void> = Promise.resolve();
  let sequence = 0;
  let queuedBytes = 0;
  let failure: Error | null = null;

  const sendChunk = async (blob: Blob, index: number) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await responseJson(
          await recordingFetch(`${base}/chunk?sequence=${index}`, {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: blob,
          }),
        );
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError;
  };

  return {
    append(blob: Blob) {
      if (!blob.size || failure) return queuedBytes;
      for (let offset = 0; offset < blob.size; offset += 8 * 1024 * 1024) {
        const chunk = blob.slice(offset, offset + 8 * 1024 * 1024);
        const index = sequence++;
        queuedBytes += chunk.size;
        queue = queue
          .then(() => (failure ? undefined : sendChunk(chunk, index)))
          .then(() => {
            queuedBytes -= chunk.size;
          })
          .catch((cause: unknown) => {
            queuedBytes -= chunk.size;
            if (!failure) {
              failure = cause instanceof Error ? cause : new Error("Could not save the recording.");
              onFailure(failure);
            }
          });
      }
      return queuedBytes;
    },
    async finish() {
      await queue;
      if (failure) throw failure;
      let attachment: MessageAttachment | undefined;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          attachment = await responseJson<MessageAttachment>(
            await recordingFetch(`${base}/finish`, { method: "POST" }),
          );
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
      }
      if (!attachment) throw lastError;
      return restoreRecordingAttachment(attachment);
    },
    async discard() {
      await queue;
      await recordingFetch(base, { method: "DELETE" }, 10_000).catch(() => {});
    },
  };
}
