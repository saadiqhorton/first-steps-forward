// The production ADE server: one node:http listener for the built UI, the
// local API, and the agent-browser stream. `npm run dev` mounts the same API
// and stream on Vite's server instead (adeLocalApi in ade-local.mjs).
import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { handle, handleUpgrade, setListenAddress, signInFromLink, start } from "./ade-local.mjs";
import { DEFAULT_PORT } from "../shared/runtime-contract.mjs";

// TanStack Start's SPA build writes the app shell here (spa.prerender.outputPath).
const SHELL = "_shell.html";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
};

/**
 * Starts ADE: loads the workspace, then listens. Resolves once listening.
 * @param {{ host?: string, port?: number, staticDir: string }} options
 *   `staticDir` is the SPA build's client directory (assets plus the shell HTML).
 * @returns {Promise<http.Server>}
 */
export async function startAdeServer({ host = "127.0.0.1", port = DEFAULT_PORT, staticDir }) {
  await start();
  const root = path.resolve(staticDir);
  const server = http.createServer((req, res) => {
    const pathname = requestPath(req.url);
    if (pathname === null) return send(res, 400, "Bad request");
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      handle(req, res).catch((error) => {
        if (res.headersSent) return res.destroy();
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: error?.message ?? String(error) }));
      });
      return;
    }
    if (signInFromLink(req, res)) return;
    serveStatic(root, pathname, req, res).catch(() => {
      if (res.headersSent) res.destroy();
      else send(res, 500, "Internal server error");
    });
  });
  server.on("upgrade", (req, socket, head) => {
    if (handleUpgrade(req, socket, head)) return;
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(undefined);
    });
  });
  setListenAddress(server.address());
  return server;
}

/** The request's path, still percent-encoded; null when it cannot be parsed. */
function requestPath(url = "/") {
  try {
    // Prefix origin-form targets so "//x" stays a path instead of becoming a host.
    return new URL(url.startsWith("/") ? `http://ade${url}` : url).pathname;
  } catch {
    return null;
  }
}

function send(res, status, text) {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(text);
}

/**
 * Serves a file from `root`. A path that names no file and has no extension is
 * a client route, so it gets the SPA shell; a missing asset is a plain 404.
 */
async function serveStatic(root, pathname, req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("allow", "GET, HEAD");
    return send(res, 405, "Method not allowed");
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, "Bad request");
  }
  if (decoded.includes("\0")) return send(res, 400, "Bad request");
  // Decoding can turn %2e%2e%2f into "../", so the resolved path is what gets checked.
  const file = path.resolve(root, `.${decoded}`);
  if (file !== root && !file.startsWith(root + path.sep)) return send(res, 404, "Not found");
  const stat = await fs.stat(file).catch(() => null);
  // Vite content-hashes everything under /assets/, so a name never changes meaning;
  // everything else (the shell above all) must be revalidated to pick up a new build.
  const hashed = path.relative(root, file).startsWith(`assets${path.sep}`);
  if (stat?.isFile()) return sendFile(file, stat, hashed, req, res);
  if (path.extname(decoded)) return send(res, 404, "Not found");
  const shell = path.join(root, SHELL);
  const shellStat = await fs.stat(shell).catch(() => null);
  if (!shellStat?.isFile()) return send(res, 404, "Not found (run `npm run build` first)");
  return sendFile(shell, shellStat, false, req, res);
}

async function sendFile(file, stat, immutable, req, res) {
  const tag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  res.setHeader(
    "content-type",
    TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
  );
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("etag", tag);
  res.setHeader("cache-control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
  if (req.headers["if-none-match"] === tag) {
    res.statusCode = 304;
    return res.end();
  }
  res.statusCode = 200;
  res.setHeader("content-length", stat.size);
  if (req.method === "HEAD") return res.end();
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("error", reject);
    res.on("close", resolve);
    stream.pipe(res);
  });
}
