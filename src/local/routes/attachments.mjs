import { createReadStream } from "node:fs";
import {
  decodeBase64,
  readAttachment,
  readAttachmentMeta,
  saveAttachment,
  saveRecording,
  MAX_RECORDING_BYTES,
  MAX_RECORDING_CHUNK_BYTES,
  startRecordingUpload,
  appendRecordingChunk,
  finishRecordingUpload,
  discardRecordingUpload,
} from "../attachments.mjs";
import { body } from "../http.mjs";

/** `/api/attachments`: upload and read files attached to a message. */
export async function attachments(ctx) {
  const { req, res, parts, DATA_DIR, json } = ctx;
  if (parts[0] === "attachments" && parts[1] === "recording") {
    try {
      if (req.method === "POST" && parts.length === 3 && parts[2] === "start")
        return json(res, 201, await startRecordingUpload(DATA_DIR));
      if (req.method === "POST" && parts.length === 4 && parts[3] === "chunk") {
        if (Number(req.headers["content-length"]) > MAX_RECORDING_CHUNK_BYTES)
          return json(res, 413, { error: "Recording chunk is too large." });
        const rawSequence = new URL(req.url ?? "/", "http://localhost").searchParams.get(
          "sequence",
        );
        if (rawSequence === null || !/^\d+$/.test(rawSequence))
          return json(res, 400, { error: "Invalid recording chunk number." });
        const sequence = Number(rawSequence);
        return json(res, 200, await appendRecordingChunk(parts[2], sequence, req));
      }
      if (req.method === "POST" && parts.length === 4 && parts[3] === "finish")
        return json(res, 201, await finishRecordingUpload(DATA_DIR, parts[2]));
      if (req.method === "DELETE" && parts.length === 3) {
        await discardRecordingUpload(parts[2]);
        return json(res, 200, { ok: true });
      }
    } catch (error) {
      if (error?.status) return json(res, error.status, { error: error.message });
      throw error;
    }
  }
  if (
    req.method === "POST" &&
    parts[0] === "attachments" &&
    parts[1] === "recording" &&
    parts.length === 2
  ) {
    if (
      !String(req.headers["content-type"] ?? "")
        .toLowerCase()
        .startsWith("video/webm")
    )
      return json(res, 400, { error: "A WebM recording is required." });
    if (Number(req.headers["content-length"]) > MAX_RECORDING_BYTES)
      return json(res, 413, { error: "The browser recording exceeds 1 GB." });
    try {
      return json(res, 201, await saveRecording(DATA_DIR, req));
    } catch (error) {
      if (error?.status) return json(res, error.status, { error: error.message });
      throw error;
    }
  }
  if (req.method === "POST" && parts[0] === "attachments" && parts.length === 1) {
    try {
      const data = await body(req);
      const bytes = decodeBase64(data.contentBase64);
      const meta = await saveAttachment(DATA_DIR, {
        name: data.name,
        mime: data.mime,
        bytes,
      });
      return json(res, 201, meta);
    } catch (error) {
      if (error?.status) return json(res, error.status, { error: error.message });
      throw error;
    }
  }
  if (req.method === "GET" && parts[0] === "attachments" && parts.length === 2) {
    try {
      const meta = await readAttachmentMeta(DATA_DIR, parts[1]);
      res.statusCode = 200;
      res.setHeader("content-type", meta.mime || "application/octet-stream");
      res.setHeader("cache-control", "private, max-age=3600");
      res.setHeader("content-disposition", `inline; filename="${encodeURIComponent(meta.name)}"`);
      res.setHeader("content-length", meta.size);
      if (!meta.recording) return res.end((await readAttachment(DATA_DIR, parts[1])).bytes);
      res.setHeader("accept-ranges", "bytes");
      let start = 0;
      let end = meta.size - 1;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range));
        if (!match || (!match[1] && !match[2])) {
          res.statusCode = 416;
          res.setHeader("content-range", `bytes */${meta.size}`);
          res.setHeader("content-length", 0);
          return res.end();
        }
        if (!match[1]) start = Math.max(0, meta.size - Number(match[2]));
        else start = Number(match[1]);
        if (match[1] && match[2]) end = Math.min(end, Number(match[2]));
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          start >= meta.size
        ) {
          res.statusCode = 416;
          res.setHeader("content-range", `bytes */${meta.size}`);
          res.setHeader("content-length", 0);
          return res.end();
        }
        res.statusCode = 206;
        res.setHeader("content-range", `bytes ${start}-${end}/${meta.size}`);
        res.setHeader("content-length", end - start + 1);
      }
      const stream = createReadStream(meta.absPath, { start, end });
      stream.on("error", () => res.destroy());
      return stream.pipe(res);
    } catch (error) {
      if (error?.status) return json(res, error.status, { error: error.message });
      throw error;
    }
  }
  return ctx.handled || res.writableEnded;
}
