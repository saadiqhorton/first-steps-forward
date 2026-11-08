import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  saveAttachment,
  readAttachment,
  resolveAttachments,
  formatAttachmentPrompt,
  sanitizeFilename,
  decodeBase64,
  MAX_FILE_BYTES,
  MAX_TURN_BYTES,
  MAX_FILES,
  saveRecording,
} from "./attachments.mjs";

test("save and read roundtrip", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ade-att-"));
  try {
    const bytes = Buffer.from("hello attachment");
    const meta = await saveAttachment(dataDir, {
      name: "notes.txt",
      mime: "text/plain",
      bytes,
    });
    assert.equal(meta.name, "notes.txt");
    assert.equal(meta.kind, "file");
    const read = await readAttachment(dataDir, meta.id);
    assert.equal(read.bytes.toString(), "hello attachment");
    assert.ok(read.absPath.includes(meta.id));
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("recordings stream to disk and can be resolved for an agent without loading video bytes", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ade-recording-"));
  try {
    const chunk = Buffer.alloc(1024 * 1024, 7);
    const meta = await saveRecording(
      dataDir,
      Readable.from(Array.from({ length: 11 }, () => chunk)),
    );
    assert.equal(meta.size, 11 * 1024 * 1024);
    assert.equal(meta.mime, "video/webm");
    const [resolved] = await resolveAttachments(dataDir, [meta.id], { includeBytes: false });
    assert.equal(resolved.absPath.endsWith(`${meta.id}/file`), true);
    assert.equal(resolved.bytes, undefined);
    const read = await readAttachment(dataDir, meta.id);
    assert.equal(read.bytes.length, meta.size);
    assert.equal(read.bytes[read.bytes.length - 1], 7);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("rejects empty files", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ade-att-"));
  try {
    await assert.rejects(
      () => saveAttachment(dataDir, { name: "x", mime: "text/plain", bytes: Buffer.alloc(0) }),
      (e) => e.status === 400,
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("rejects oversize files", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ade-att-"));
  try {
    await assert.rejects(
      () =>
        saveAttachment(dataDir, {
          name: "big.bin",
          mime: "application/octet-stream",
          bytes: Buffer.alloc(MAX_FILE_BYTES + 1),
        }),
      (e) => e.status === 400,
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("rejects bad attachment id", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ade-att-"));
  try {
    await assert.rejects(
      () => readAttachment(dataDir, "../etc/passwd"),
      (e) => e.status === 400,
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("sanitizeFilename strips path segments", () => {
  assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
  assert.equal(sanitizeFilename(""), "file");
});

test("resolveAttachments enforces count and total size", async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "ade-att-"));
  try {
    const ids = [];
    for (let i = 0; i < MAX_FILES + 1; i++) {
      const meta = await saveAttachment(dataDir, {
        name: `a${i}.txt`,
        mime: "text/plain",
        bytes: Buffer.from("a"),
      });
      ids.push(meta.id);
    }
    await assert.rejects(
      () => resolveAttachments(dataDir, ids),
      (e) => e.status === 400,
    );

    const chunk = 7 * 1024 * 1024;
    const one = await saveAttachment(dataDir, {
      name: "1.bin",
      mime: "application/octet-stream",
      bytes: Buffer.alloc(chunk),
    });
    const two = await saveAttachment(dataDir, {
      name: "2.bin",
      mime: "application/octet-stream",
      bytes: Buffer.alloc(chunk),
    });
    const three = await saveAttachment(dataDir, {
      name: "3.bin",
      mime: "application/octet-stream",
      bytes: Buffer.alloc(chunk),
    });
    await assert.rejects(
      () => resolveAttachments(dataDir, [one.id, two.id, three.id]),
      (e) => e.status === 400,
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("formatAttachmentPrompt includes absPath and empty for none", async () => {
  assert.equal(formatAttachmentPrompt([]), "");
  const prompt = formatAttachmentPrompt([
    {
      name: "shot.png",
      mime: "image/png",
      size: 2048,
      absPath: "/home/u/.ade/attachments/id/file",
    },
  ]);
  assert.match(prompt, /shot\.png/);
  assert.match(prompt, /\/home\/u\/\.ade\/attachments\/id\/file/);
  assert.doesNotMatch(prompt, /—/);
});

test("decodeBase64 rejects invalid input", () => {
  assert.throws(
    () => decodeBase64(""),
    (e) => e.status === 400,
  );
});
