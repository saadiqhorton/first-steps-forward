import { randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import path from "node:path";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TURN_BYTES = 20 * 1024 * 1024;
export const MAX_FILES = 8;
export const MAX_RECORDING_BYTES = 1024 * 1024 * 1024;
export const MAX_RECORDING_CHUNK_BYTES = 32 * 1024 * 1024;
export const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

export function attachmentKind(mime) {
  return IMAGE_MIMES.has(String(mime || "").toLowerCase()) ? "image" : "file";
}

export function sanitizeFilename(name) {
  let base = path.basename(String(name ?? ""));
  base = base.replace(/\0/g, "").replace(/[/\\]/g, "");
  if (!base.trim()) base = "file";
  if (base.length > 200) base = base.slice(0, 200);
  return base;
}

export function decodeBase64(contentBase64) {
  if (typeof contentBase64 !== "string" || !contentBase64.trim()) {
    throw { status: 400, message: "Attachment content is required." };
  }
  try {
    return Buffer.from(contentBase64, "base64");
  } catch {
    throw { status: 400, message: "Attachment content is not valid base64." };
  }
}

export async function saveAttachment(dataDir, { name, mime, bytes }) {
  if (!bytes?.length) throw { status: 400, message: "Empty files cannot be attached." };
  if (bytes.length > MAX_FILE_BYTES) {
    throw { status: 400, message: "Each file must be 10 MB or smaller." };
  }
  const id = randomUUID();
  const dir = path.join(dataDir, "attachments", id);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const filePath = path.join(dir, "file");
  await fsp.writeFile(filePath, bytes, { mode: 0o600 });
  const meta = {
    id,
    name: sanitizeFilename(name),
    mime: String(mime || "application/octet-stream"),
    size: bytes.length,
    kind: attachmentKind(mime),
  };
  await fsp.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta), { mode: 0o600 });
  return meta;
}

/** Streams a browser recording to disk without loading the whole video into server memory. */
export async function saveRecording(dataDir, source) {
  const id = randomUUID();
  const dir = path.join(dataDir, "attachments", id);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const handle = await fsp.open(path.join(dir, "file"), "w", 0o600);
  let size = 0;
  try {
    for await (const chunk of source) {
      size += chunk.length;
      if (size > MAX_RECORDING_BYTES)
        throw { status: 400, message: "The browser recording exceeds 1 GB." };
      await handle.writeFile(chunk);
    }
    if (!size) throw { status: 400, message: "Empty files cannot be attached." };
    await handle.close();
    const meta = {
      id,
      name: "browser-recording.webm",
      mime: "video/webm",
      size,
      kind: "file",
      recording: true,
    };
    await fsp.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta), { mode: 0o600 });
    return meta;
  } catch (error) {
    await handle.close().catch(() => {});
    await fsp.rm(dir, { recursive: true, force: true });
    throw error;
  }
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

// In-progress recordings have no attachment metadata and cannot be read or sent until finalized.
// Each chunk is numbered, making a retry after a lost response safe.
const recordingUploads = new Map();
const RECORDING_IDLE_MS = 60 * 60 * 1000;
function touchRecording(upload) {
  clearTimeout(upload.timer);
  upload.timer = setTimeout(() => {
    if (recordingUploads.get(upload.id) !== upload) return;
    recordingUploads.delete(upload.id);
    void upload.queue
      .finally(() => fsp.rm(upload.dir, { recursive: true, force: true }))
      .catch(() => {});
  }, RECORDING_IDLE_MS);
  upload.timer.unref?.();
}

export async function startRecordingUpload(dataDir) {
  const id = randomUUID();
  const dir = path.join(dataDir, "recordings-in-progress", id);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  await fsp.writeFile(path.join(dir, "file"), "", { mode: 0o600 });
  const upload = { id, dir, dataDir, next: 0, size: 0, queue: Promise.resolve(), timer: null };
  recordingUploads.set(id, upload);
  touchRecording(upload);
  return { id };
}

function recordingUpload(id) {
  const upload = recordingUploads.get(String(id ?? ""));
  if (!upload) throw { status: 404, message: "Recording upload not found." };
  touchRecording(upload);
  return upload;
}

export async function appendRecordingChunk(id, sequence, source) {
  const upload = recordingUpload(id);
  if (!Number.isSafeInteger(sequence) || sequence < 0)
    throw { status: 400, message: "Invalid recording chunk number." };
  const chunks = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.length;
    if (size > MAX_RECORDING_CHUNK_BYTES)
      throw { status: 413, message: "Recording chunk is too large." };
    chunks.push(chunk);
  }
  if (!size) throw { status: 400, message: "Recording chunk is empty." };
  const work = upload.queue.then(async () => {
    if (recordingUploads.get(upload.id) !== upload)
      throw { status: 404, message: "Recording upload expired." };
    if (sequence < upload.next) return;
    if (sequence !== upload.next)
      throw { status: 409, message: "Recording chunks are out of order." };
    if (upload.invalid) throw { status: 500, message: "The recording upload is damaged." };
    if (upload.size + size > MAX_RECORDING_BYTES)
      throw { status: 413, message: "The browser recording exceeds 1 GB." };
    const file = path.join(upload.dir, "file");
    try {
      await fsp.appendFile(file, Buffer.concat(chunks, size));
    } catch (error) {
      // appendFile can fail after writing part of a chunk. Roll it back before a retry.
      try {
        await fsp.truncate(file, upload.size);
      } catch {
        upload.invalid = true;
      }
      throw error;
    }
    upload.size += size;
    upload.next++;
  });
  upload.queue = work.catch(() => {});
  await work;
  return { ok: true };
}

export async function finishRecordingUpload(dataDir, id) {
  let upload;
  try {
    upload = recordingUpload(id);
  } catch (error) {
    // The finish response can be lost after the file was committed. Retrying must not lose it.
    const saved = await readAttachmentMeta(dataDir, id).catch(() => null);
    if (saved?.recording) {
      const { absPath, ...meta } = saved;
      return meta;
    }
    throw error;
  }
  const work = upload.queue.then(async () => {
    if (recordingUploads.get(upload.id) !== upload)
      throw { status: 404, message: "Recording upload expired." };
    if (upload.invalid) throw { status: 500, message: "The recording upload is damaged." };
    if (!upload.size) throw { status: 400, message: "Empty files cannot be attached." };
    const meta = {
      id: upload.id,
      name: "browser-recording.webm",
      mime: "video/webm",
      size: upload.size,
      kind: "file",
      recording: true,
    };
    await fsp.writeFile(path.join(upload.dir, "meta.json"), JSON.stringify(meta), { mode: 0o600 });
    const attachmentsDir = path.join(upload.dataDir, "attachments");
    await fsp.mkdir(attachmentsDir, { recursive: true, mode: 0o700 });
    await fsp.rename(upload.dir, path.join(attachmentsDir, upload.id));
    recordingUploads.delete(upload.id);
    clearTimeout(upload.timer);
    return meta;
  });
  upload.queue = work.catch(() => {});
  return work;
}

export async function discardRecordingUpload(id) {
  const upload = recordingUpload(id);
  recordingUploads.delete(upload.id);
  clearTimeout(upload.timer);
  await upload.queue;
  await fsp.rm(upload.dir, { recursive: true, force: true });
}

export async function readAttachmentMeta(dataDir, id) {
  if (!UUID_RE.test(String(id ?? ""))) {
    throw { status: 400, message: "Invalid attachment id." };
  }
  const dir = path.join(dataDir, "attachments", id);
  let metaRaw;
  try {
    metaRaw = await fsp.readFile(path.join(dir, "meta.json"), "utf8");
  } catch {
    throw { status: 404, message: "Attachment not found." };
  }
  let meta;
  try {
    meta = JSON.parse(metaRaw);
  } catch {
    throw { status: 404, message: "Attachment not found." };
  }
  const absPath = path.join(dir, "file");
  try {
    await fsp.access(absPath);
  } catch {
    throw { status: 404, message: "Attachment not found." };
  }
  return { ...meta, absPath };
}

export async function readAttachment(dataDir, id) {
  const meta = await readAttachmentMeta(dataDir, id);
  return { ...meta, bytes: await fsp.readFile(meta.absPath) };
}

export async function resolveAttachments(dataDir, ids, { includeBytes = true } = {}) {
  const unique = [...new Set(ids.map((x) => String(x ?? "").trim()).filter(Boolean))];
  if (unique.length > MAX_FILES) {
    throw { status: 400, message: `At most ${MAX_FILES} files can be attached per message.` };
  }
  const results = [];
  let total = 0;
  for (const attachmentId of unique) {
    const file = includeBytes
      ? await readAttachment(dataDir, attachmentId)
      : await readAttachmentMeta(dataDir, attachmentId);
    if (!file.recording) total += file.size;
    if (total > MAX_TURN_BYTES) {
      throw { status: 400, message: "Attached files must total 20 MB or less per message." };
    }
    results.push(file);
  }
  return results;
}

export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n === 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1_000_000) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

export function formatAttachmentPrompt(attachments) {
  if (!attachments?.length) return "";
  const lines = attachments.map(
    (a) => `- ${a.name} (${a.mime}, ${formatSize(a.size)}): ${a.absPath}`,
  );
  return (
    "\n\nThe user attached these files for this turn. They are stored by ADE outside the project. Read them as needed. Do not copy them into the repository unless the user asked.\n\n" +
    lines.join("\n")
  );
}
