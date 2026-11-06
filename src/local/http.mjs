// Converts the HTTP response lifecycle into a transport-neutral cancellation signal.
export function responseClosedSignal(res) {
  const controller = new AbortController();
  const abortIfDisconnected = () => {
    if (!res.writableEnded) controller.abort();
  };
  if (res.destroyed) abortIfDisconnected();
  else res.once("close", abortIfDisconnected);
  return controller.signal;
}

// JSON responses and request bodies, shared by the API router and its route modules.
export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}
function isAttachmentUploadPath(pathname) {
  const cleaned = String(pathname ?? "").replace(/\/$/, "");
  return cleaned === "/api/attachments" || cleaned === "/attachments";
}

export class PayloadTooLarge extends Error {
  constructor() {
    super("Request body too large.");
    this.status = 413;
  }
}
// API request bodies are small JSON (attachments up to 14 MB). A larger body is
// refused before it is read, or as soon as it outgrows the limit: an exposed
// instance must not let an unauthenticated peer stream an unbounded body into memory.
export async function body(req) {
  const url = new URL(req.url, "http://127.0.0.1");
  const attachmentUpload = req.method === "POST" && isAttachmentUploadPath(url.pathname);
  const limit = attachmentUpload ? 14 * 1024 * 1024 : 1_000_000;
  if (Number(req.headers["content-length"]) > limit) throw new PayloadTooLarge();
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new PayloadTooLarge();
  }
  return raw ? JSON.parse(raw) : {};
}
