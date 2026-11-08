// Opening a link in ADE's browser tab. Chat links and terminal links announce a URL here;
// the shell brings the browser tab forward and the pane navigates the shared page.

export const BROWSER_OPEN_EVENT = "ade:browser-open";
/** Zoom changes announce themselves so the page can show the new level briefly. */
export const BROWSER_ZOOM_EVENT = "ade:browser-zoom";

/** True for a URL the agent browser can open (it navigates http(s) only). */
export function isPreviewableUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

/** Ask ADE to show `url` in the browser tab. False for a URL the preview cannot load. */
export function requestPreviewOpen(url) {
  if (!isPreviewableUrl(url)) return false;
  window.dispatchEvent(new CustomEvent(BROWSER_OPEN_EVENT, { detail: { url } }));
  return true;
}

/** Links T3 shows inside the preview: local HTML pages and PDFs. */
export function isPreviewableFile(path) {
  return /\.(?:html?|pdf)$/i.test(path.split(/[?#]/, 1)[0] ?? "");
}

/** A workspace file path from a link, or null when the link is a web address, anchor or mail. */
export function workspaceFileFromLink(href) {
  if (!href || href.startsWith("#")) return null;
  if (/^file:\/\//i.test(href)) {
    try {
      return decodeURIComponent(new URL(href).pathname);
    } catch {
      return null;
    }
  }
  // Any other scheme is a web address, mail link or similar; only bare paths are files.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  return isPreviewableFile(href) ? (href.split(/[?#]/, 1)[0] ?? href) : null;
}

/** ADE's own origin serves a workspace file to the browser, at a path its own assets can join. */
export function previewFileUrl(projectId, filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  // An absolute path travels as one encoded segment so its slashes survive the URL split.
  const path = normalized.startsWith("/")
    ? encodeURIComponent(normalized)
    : normalized
        .replace(/^\.\/+/, "")
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
  return `${window.location.origin}/api/projects/${encodeURIComponent(projectId)}/browser/files/${path}`;
}

/** Serve a project file to the browser tab, which then loads it as a normal page. */
export function requestPreviewFileOpen(projectId, filePath) {
  return requestPreviewOpen(previewFileUrl(projectId, filePath));
}
