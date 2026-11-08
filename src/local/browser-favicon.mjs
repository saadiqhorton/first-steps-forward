// Favicon capture follows T3 Code's apps/desktop/src/preview/FaviconCapture.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.

const MAX_BYTES = 100_000;
const MAX_URL = 2_048;
const MAX_INLINE = Math.ceil((MAX_BYTES * 4) / 3) + 128;
const MAX_CANDIDATES = 8;
const CAPTURE_TIMEOUT_MS = 5_000;

function httpOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function decodeInline(value) {
  if (value.length > MAX_INLINE) return null;
  const match = /^data:(image\/[a-z0-9.+-]+)((?:;[^,]*)?),(.*)$/is.exec(value);
  if (!match) return null;
  const parameters = match[2].toLowerCase().split(";").filter(Boolean);
  if (parameters.includes("base64") && parameters.at(-1) !== "base64") return null;
  try {
    let bytes;
    if (parameters.at(-1) === "base64") {
      if (!/^[a-z0-9+/]*={0,2}$/i.test(match[3]) || match[3].length % 4 === 1) return null;
      bytes = Buffer.from(match[3], "base64");
      if (bytes.toString("base64").replace(/=+$/, "") !== match[3].replace(/=+$/, "")) return null;
    } else {
      bytes = Buffer.from(decodeURIComponent(match[3]), "utf8");
    }
    return bytes.length > 0 && bytes.length <= MAX_BYTES ? { bytes, mime: match[1] } : null;
  } catch {
    return null;
  }
}

async function readBounded(response) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BYTES) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return total > 0 ? Buffer.concat(chunks, total) : null;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
}

async function readCandidate(candidate, pageOrigin, context, signal) {
  if (/^data:/i.test(candidate)) return decodeInline(candidate);
  const origin = candidate.length <= MAX_URL ? httpOrigin(candidate) : null;
  if (!origin) return null;
  const headers = {};
  if (origin === pageOrigin) {
    const cookies = await context.cookies(candidate);
    // Partitioned cookies cannot be reproduced safely outside the browser's storage partition.
    const usable = cookies.filter((cookie) => !cookie.partitionKey);
    if (usable.length)
      headers.cookie = usable.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }
  const response = await fetch(candidate, { signal, redirect: "error", headers });
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  const bytes = await readBounded(response);
  if (!bytes) return null;
  const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  // Browsers commonly serve .ico as application/octet-stream or without an image content type.
  const mime = type?.startsWith("image/") ? type : "image/x-icon";
  return { bytes, mime };
}

const DISCOVER = `(() => {
  const result = [];
  let scanned = 0;
  for (const link of document.querySelectorAll('link[rel]')) {
    if (result.length >= ${MAX_CANDIDATES} || ++scanned > 64) break;
    if (!String(link.rel).toLowerCase().split(/\\s+/).includes('icon')) continue;
    const value = link.href;
    if (typeof value === 'string' && value.length <= ${MAX_INLINE}) result.push(value);
  }
  return result;
})()`;

/**
 * Captures a small PNG from the current page's declared icons. Uses an isolated CDP world so
 * page scripts cannot alter the DOM/image/canvas methods, and never sends profile cookies to
 * cross-origin icons. Call on page load and discard the result if that tab has since navigated.
 * @param {import("playwright-core").Page} page
 * @returns {Promise<string | null>} A PNG data URL, or null if no icon could be captured.
 */
export async function captureBrowserFavicon(page) {
  const pageUrl = page.url();
  const origin = httpOrigin(pageUrl);
  if (!origin) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CAPTURE_TIMEOUT_MS);
  const bounded = (work) =>
    new Promise((resolve, reject) => {
      if (abort.signal.aborted) return reject(new Error("Favicon capture timed out."));
      const onAbort = () => reject(new Error("Favicon capture timed out."));
      abort.signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve(work)
        .then(resolve, reject)
        .finally(() => abort.signal.removeEventListener("abort", onAbort));
    });
  let cdp;
  try {
    cdp = await bounded(
      page
        .context()
        .newCDPSession(page)
        .then((session) => {
          if (abort.signal.aborted) void session.detach().catch(() => {});
          return session;
        }),
    );
    const { frameTree } = await bounded(cdp.send("Page.getFrameTree"));
    const { executionContextId } = await bounded(
      cdp.send("Page.createIsolatedWorld", {
        frameId: frameTree.frame.id,
        worldName: "ade-favicon",
      }),
    );
    const result = await bounded(
      cdp.send("Runtime.evaluate", {
        expression: DISCOVER,
        contextId: executionContextId,
        returnByValue: true,
      }),
    );
    const values = Array.isArray(result.result.value) ? result.result.value : [];
    const candidates = [
      ...new Set([...values.filter((value) => typeof value === "string"), `${origin}/favicon.ico`]),
    ].slice(0, MAX_CANDIDATES);
    for (const candidate of candidates) {
      if (abort.signal.aborted || page.url() !== pageUrl) break;
      try {
        const icon = await bounded(readCandidate(candidate, origin, page.context(), abort.signal));
        if (!icon || abort.signal.aborted || page.url() !== pageUrl) continue;
        const dataUrl = `data:${icon.mime};base64,${icon.bytes.toString("base64")}`;
        const expression = `new Promise((resolve) => {
          const image = new Image();
          const timeout = setTimeout(() => resolve(null), 1000);
          image.onerror = () => { clearTimeout(timeout); resolve(null); };
          image.onload = () => {
            clearTimeout(timeout);
            if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 1048576) return resolve(null);
            const canvas = document.createElement('canvas');
            canvas.width = 32; canvas.height = 32;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(null);
            const scale = Math.min(32 / image.naturalWidth, 32 / image.naturalHeight);
            const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
            ctx.drawImage(image, (32 - width) / 2, (32 - height) / 2, width, height);
            resolve(canvas.toDataURL('image/png'));
          };
          image.src = ${JSON.stringify(dataUrl)};
        })`;
        const raster = await bounded(
          cdp.send("Runtime.evaluate", {
            expression,
            contextId: executionContextId,
            awaitPromise: true,
            returnByValue: true,
          }),
        );
        const value = raster.result.value;
        if (
          page.url() === pageUrl &&
          typeof value === "string" &&
          /^data:image\/png;base64,[a-z0-9+/]+=*$/i.test(value) &&
          value.length <= MAX_INLINE
        )
          return value;
      } catch {
        // Try the next icon when a candidate is invalid or cannot be reached.
      }
    }
  } catch {
    // Navigation and page closure can invalidate the isolated world during capture.
  } finally {
    clearTimeout(timer);
    void cdp?.detach().catch(() => {});
  }
  return null;
}
