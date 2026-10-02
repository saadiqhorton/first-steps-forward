import { randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import path from "node:path";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TURN_BYTES = 20 * 1024 * 1024;
export const MAX_FILES = 8;
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

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function readAttachment(dataDir, id) {
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
  let bytes;
  try {
    bytes = await fsp.readFile(path.join(dir, "file"));
  } catch {
    throw { status: 404, message: "Attachment not found." };
  }
  return {
    ...meta,
    bytes,
    absPath: path.join(dataDir, "attachments", id, "file"),
  };
}

export async function resolveAttachments(dataDir, ids) {
  const unique = [...new Set(ids.map((x) => String(x ?? "").trim()).filter(Boolean))];
  if (unique.length > MAX_FILES) {
    throw { status: 400, message: `At most ${MAX_FILES} files can be attached per message.` };
  }
  const results = [];
  let total = 0;
  for (const attachmentId of unique) {
    const file = await readAttachment(dataDir, attachmentId);
    total += file.size;
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
