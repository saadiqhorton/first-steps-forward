// Adapted from T3 Code's BrowserImport/{SafariCookies,Sources,CookieDatabase}.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DENIED =
  "Allow Full Disk Access for the app running ADE in macOS System Settings, then try again.";

/** Discovery reads profile names and file metadata, never cookie contents. */
export async function listSafariImportSources() {
  if (process.platform !== "darwin") return [];
  const library = path.join(
    os.homedir(),
    "Library",
    "Containers",
    "com.apple.Safari",
    "Data",
    "Library",
  );
  const candidates = [
    { name: "Safari · Personal", file: path.join(library, "Cookies", "Cookies.binarycookies") },
  ];
  let declared = [];
  let database;
  try {
    const sqlite = await import("node:sqlite");
    database = new sqlite.DatabaseSync(path.join(library, "Safari", "SafariTabs.db"), {
      readOnly: true,
    });
    declared = database
      .prepare(
        "SELECT title, external_uuid FROM bookmarks WHERE parent = 0 AND type = 1 AND subtype = 2 AND deleted = 0 ORDER BY order_index",
      )
      .all();
  } catch {
    /* Metadata can be unavailable until Full Disk Access is granted. */
  } finally {
    database?.close();
  }
  const personal = declared.find((item) => item.external_uuid === "DefaultProfile");
  if (typeof personal?.title === "string" && personal.title.trim())
    candidates[0].name = `Safari · ${personal.title.trim()}`;
  const store = path.join(library, "WebKit", "WebsiteDataStore");
  let profiles = declared
    .filter((item) => typeof item.external_uuid === "string" && UUID.test(item.external_uuid))
    .map((item) => ({
      id: item.external_uuid.toLowerCase(),
      name:
        typeof item.title === "string" && item.title.trim()
          ? item.title.trim()
          : item.external_uuid,
    }));
  if (!declared.length) {
    try {
      profiles = (await fs.readdir(store))
        .filter((id) => UUID.test(id))
        .map((id) => ({ id, name: id }));
    } catch {
      /* May need Full Disk Access. */
    }
  }
  for (const profile of profiles)
    candidates.push({
      name: `Safari · ${profile.name}`,
      file: path.join(store, profile.id, "Cookies", "Cookies.binarycookies"),
    });
  const result = [];
  for (const candidate of candidates) {
    try {
      const info = await fs.stat(candidate.file);
      if (!info.isFile()) continue;
    } catch (error) {
      // macOS may hide file metadata before Full Disk Access. Keep the standard Safari entry
      // available so selecting it can explain the required access.
      if (candidate !== candidates[0] || !["EPERM", "EACCES"].includes(error?.code)) continue;
    }
    result.push({ ...candidate, id: createHash("sha256").update(candidate.file).digest("hex") });
  }
  return result;
}

function invalid() {
  return new Error("The Safari cookie file is invalid or incomplete.");
}
function cstring(buffer, offset) {
  const end = buffer.indexOf(0, offset);
  if (end < 0) throw invalid();
  return buffer.toString("utf8", offset, end);
}

function parseCookies(data) {
  if (data.length < 8 || data.toString("latin1", 0, 4) !== "cook") throw invalid();
  const pageCount = data.readUInt32BE(4);
  if (pageCount > (data.length - 8) / 4) throw invalid();
  let pageStart = 8 + pageCount * 4;
  const cookies = [];
  let skipped = 0;
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const size = data.readUInt32BE(8 + pageIndex * 4);
    if (size < 12 || pageStart + size > data.length) throw invalid();
    const page = data.subarray(pageStart, pageStart + size);
    pageStart += size;
    const count = page.readUInt32LE(4);
    if (count > (page.length - 12) / 4) throw invalid();
    const tableEnd = 12 + count * 4;
    const ranges = [];
    for (let index = 0; index < count; index++) {
      const start = page.readUInt32LE(8 + index * 4);
      if (start < tableEnd || start + 56 > page.length) throw invalid();
      const end = start + page.readUInt32LE(start);
      if (end < start + 56 || end > page.length || ranges.some(([a, b]) => start < b && end > a))
        throw invalid();
      ranges.push([start, end]);
      const record = page.subarray(start, end);
      const offsets = [16, 20, 24, 28].map((position) => record.readUInt32LE(position));
      if (offsets.some((offset) => offset < 56 || offset >= record.length)) throw invalid();
      const [domain, name, rawPath, value] = offsets.map((offset) => cstring(record, offset));
      const domainCookie = domain.startsWith(".");
      const host = domainCookie ? domain.slice(1) : domain;
      if (!host || !name || /[\s/@?#\\%]/.test(host)) {
        skipped++;
        continue;
      }
      const cookiePath = rawPath.startsWith("/") ? rawPath : "/";
      const flags = record.readUInt32LE(8);
      const secure = (flags & 1) !== 0;
      const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
      const url = `${secure ? "https" : "http"}://${authority}${cookiePath}`;
      try {
        new URL(url);
      } catch {
        skipped++;
        continue;
      }
      const rawExpiry = record.readDoubleLE(40);
      const expires = rawExpiry > 0 ? Math.floor(rawExpiry) + 978_307_200 : 0;
      if (expires > 0 && expires <= Math.floor(Date.now() / 1000)) {
        skipped++;
        continue;
      }
      cookies.push({
        name,
        value,
        ...(domainCookie ? { domain, path: cookiePath } : { url, path: cookiePath }),
        secure,
        httpOnly: (flags & 4) !== 0,
        sameSite: "Lax",
        ...(Number.isSafeInteger(expires) && expires > 0 ? { expires } : {}),
      });
    }
  }
  const trailer = data.length - pageStart;
  if (!(
    trailer === 0 ||
    trailer === 8 ||
    (trailer >= 12 && trailer === 12 + data.readUInt32BE(pageStart + 8))
  ))
    throw invalid();
  return { cookies, skipped };
}

/** Read the selected Safari jar only when the user explicitly imports it. */
export async function readSafariImport(sourceId) {
  const source = (await listSafariImportSources()).find((item) => item.id === sourceId);
  if (!source) throw new Error("That browser profile is no longer available.");
  try {
    return parseCookies(await fs.readFile(source.file));
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error?.code)) throw new Error(DENIED);
    throw error;
  }
}
