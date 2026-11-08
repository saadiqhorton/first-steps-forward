// Firefox cookie scope and SameSite conversion follow T3 Code's BrowserImport/FirefoxCookies.ts
// and CookieDatabase.ts. Copyright (c) 2026 T3 Tools Inc. MIT; see THIRD_PARTY_NOTICES.md.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

function roots() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    const support = path.join(home, "Library", "Application Support");
    return [
      ["Firefox", path.join(support, "Firefox")],
      ["Zen", path.join(support, "zen")],
    ];
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    return appData
      ? [
          ["Firefox", path.join(appData, "Mozilla", "Firefox")],
          ["Zen", path.join(appData, "zen")],
        ]
      : [];
  }
  return [
    ["Firefox", path.join(home, ".mozilla", "firefox")],
    ["Firefox", path.join(home, "snap", "firefox", "common", ".mozilla", "firefox")],
    ["Firefox", path.join(home, ".var", "app", "org.mozilla.firefox", ".mozilla", "firefox")],
    ["Zen", path.join(home, ".config", "zen")],
    ["Zen", path.join(home, ".zen")],
    ["Zen", path.join(home, ".var", "app", "app.zen_browser.zen", "zen")],
  ];
}

function profileSections(content) {
  const sections = [];
  let current = null;
  for (const line of content.split(/\r?\n/)) {
    const section = /^\s*\[(Profile\d+)\]\s*$/i.exec(line);
    if (section) {
      current = {};
      sections.push(current);
      continue;
    }
    if (/^\s*\[/.test(line)) {
      current = null;
      continue;
    }
    const value = /^\s*(Name|Path|IsRelative)\s*=(.*)$/i.exec(line);
    if (current && value) current[value[1].toLowerCase()] = value[2].trim();
  }
  return sections;
}

function profileDirectory(root, profile) {
  const candidate = profile.path;
  if (!candidate || candidate.includes("\0")) return null;
  if (profile.isrelative === "0") return path.isAbsolute(candidate) ? path.resolve(candidate) : null;
  if (profile.isrelative !== undefined && profile.isrelative !== "1") return null;
  if (path.isAbsolute(candidate)) return null;
  const directory = path.resolve(root, candidate);
  const relative = path.relative(root, directory);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    return null;
  return directory;
}

/** Lists names only. Cookie values are read only after the user starts an import. */
export async function listFirefoxImportSources() {
  const sources = [];
  const seen = new Set();
  for (const [browser, root] of roots()) {
    let profiles = [];
    try {
      const ini = await fs.readFile(path.join(root, "profiles.ini"), "utf8");
      profiles = profileSections(ini)
        .map((profile) => ({ directory: profileDirectory(root, profile), name: profile.name }))
        .filter((profile) => profile.directory);
    } catch {
      // A profile can exist even if profiles.ini is missing or damaged.
    }
    const found = [];
    const add = async ({ directory, name }) => {
      let db;
      try {
        db = await fs.realpath(path.join(directory, "cookies.sqlite"));
        if (!(await fs.stat(db)).isFile() || seen.has(db)) return;
      } catch {
        return;
      }
      seen.add(db);
      found.push({
        id: createHash("sha256").update(db).digest("hex"),
        name: `${browser} · ${name || path.basename(directory)}`,
        database: db,
      });
    };
    for (const profile of profiles) await add(profile);
    if (!found.length) {
      const fallback = process.platform === "linux" ? root : path.join(root, "Profiles");
      try {
        for (const entry of await fs.readdir(fallback, { withFileTypes: true })) {
          if (entry.isDirectory() || entry.isSymbolicLink())
            await add({ directory: path.join(fallback, entry.name), name: entry.name });
        }
      } catch {
        // The browser may not be installed at this location.
      }
    }
    sources.push(...found);
  }
  return sources;
}

function cookieFor(row, schemaVersion) {
  if (typeof row.host !== "string" || typeof row.name !== "string" || typeof row.value !== "string")
    return null;
  const domainCookie = row.host.startsWith(".");
  const host = domainCookie ? row.host.slice(1) : row.host;
  if (!host || /[\s/@?#\\%]/.test(host)) return null;
  const secure = row.isSecure === 1;
  const cookiePath = typeof row.path === "string" && row.path.startsWith("/") ? row.path : "/";
  const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const url = `${secure ? "https" : "http"}://${authority}${cookiePath}`;
  try {
    new URL(url);
  } catch {
    return null;
  }
  const rawExpiry = Number(row.expiry);
  const expiry = schemaVersion >= 16 ? Math.floor(rawExpiry / 1000) : rawExpiry;
  if (expiry > 0 && expiry <= Math.floor(Date.now() / 1000)) return null;
  let sameSite;
  if (!(
    schemaVersion >= 10 &&
    schemaVersion <= 14 &&
    row.sameSite === 1 &&
    row.rawSameSite === 0
  )) {
    if (row.sameSite === 0) sameSite = "None";
    else if (row.sameSite === 1) sameSite = "Lax";
    else if (row.sameSite === 2) sameSite = "Strict";
  }
  return {
    name: row.name,
    value: row.value,
    ...(domainCookie ? { domain: row.host, path: cookiePath } : { url, path: cookiePath }),
    secure,
    httpOnly: row.isHttpOnly === 1,
    ...(expiry > 0 && Number.isSafeInteger(expiry) ? { expires: expiry } : {}),
    ...(sameSite ? { sameSite } : {}),
  };
}

/** Read an SQLite snapshot without changing the source browser or exposing cookie values to the UI. */
export async function readFirefoxImport(sourceId) {
  const source = (await listFirefoxImportSources()).find((item) => item.id === sourceId);
  if (!source) throw new Error("That browser profile is no longer available.");
  let sqlite;
  try {
    sqlite = await import("node:sqlite");
  } catch {
    throw new Error("Browser import requires Node 22.13 or newer.");
  }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "ade-browser-import-"));
  let original;
  let snapshot;
  try {
    original = new sqlite.DatabaseSync(source.database, { readOnly: true });
    const filename = path.join(temp, "cookies.sqlite");
    if (typeof sqlite.backup === "function") await sqlite.backup(original, filename);
    else original.prepare("VACUUM INTO ?").run(filename);
    original.close();
    original = null;
    snapshot = new sqlite.DatabaseSync(filename, { readOnly: true });
    const version = Number(snapshot.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    const columns = new Set(
      snapshot
        .prepare("PRAGMA table_info(moz_cookies)")
        .all()
        .map((row) => row.name),
    );
    const has = (name) => (columns.has(name) ? name : `NULL AS ${name}`);
    const rows = snapshot
      .prepare(
        `SELECT host, name, value, path, expiry, isSecure, isHttpOnly, ${has("sameSite")}, ${has("rawSameSite")}, ${has("originAttributes")} FROM moz_cookies`,
      )
      .all();
    const cookies = rows
      .map((row) => (row.originAttributes ? null : cookieFor(row, version)))
      .filter(Boolean);
    return { cookies, skipped: rows.length - cookies.length };
  } finally {
    original?.close();
    snapshot?.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
}
