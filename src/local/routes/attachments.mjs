/** Route module. Dependencies are supplied by the request context. */
export async function attachments(ctx) {
  const { req, res, parts, decodeBase64, readAttachment, saveAttachment, DATA_DIR, json, body } =
    ctx;
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
      const meta = await readAttachment(DATA_DIR, parts[1]);
      res.statusCode = 200;
      res.setHeader("content-type", meta.mime || "application/octet-stream");
      res.setHeader("cache-control", "private, max-age=3600");
      res.setHeader("content-disposition", `inline; filename="${encodeURIComponent(meta.name)}"`);
      return res.end(meta.bytes);
    } catch (error) {
      if (error?.status) return json(res, error.status, { error: error.message });
      throw error;
    }
  }
  return ctx.handled || res.writableEnded;
}
