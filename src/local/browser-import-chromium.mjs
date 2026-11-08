// Adapted from T3 Code's BrowserImport/{Sources,ChromiumKeys,ChromiumCookies,CookieDatabase}.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License; see THIRD_PARTY_NOTICES.md.
import { createHash, createDecipheriv, pbkdf2Sync } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function browserRoots() {
  const home = os.homedir();
  const mac = path.join(home, "Library", "Application Support");
  const linux = path.join(home, ".config");
  const windows = process.env.LOCALAPPDATA;
  const defs = [
    ["Chrome", "Google/Chrome", "google-chrome", null, "Chrome Safe Storage", "Chrome", "chrome"],
    ["Chromium", "Chromium", "chromium", null, "Chromium Safe Storage", "Chromium", "chromium"],
    [
      "Microsoft Edge",
      "Microsoft Edge",
      "microsoft-edge",
      null,
      "Microsoft Edge Safe Storage",
      "Microsoft Edge",
      "msedge",
    ],
    [
      "Brave",
      "BraveSoftware/Brave-Browser",
      "BraveSoftware/Brave-Browser",
      null,
      "Brave Safe Storage",
      "Brave",
      "brave",
    ],
    ["Vivaldi", "Vivaldi", "vivaldi", null, "Vivaldi Safe Storage", "Vivaldi", "chrome"],
    ["Opera", "com.operasoftware.Opera", "opera", null, "Opera Safe Storage", "Opera", "opera"],
    ["Arc", "Arc/User Data", null, null, "Arc Safe Storage", "Arc", null],
    [
      "Helium",
      "net.imput.helium",
      "net.imput.helium",
      "imput/Helium/User Data",
      "Helium Storage Key",
      "Helium",
      "chromium",
    ],
  ];
  return defs.flatMap(([name, macDir, linuxDir, windowsDir, service, account, application]) => {
    const root =
      process.platform === "darwin" && macDir
        ? path.join(mac, macDir)
        : process.platform === "linux" && linuxDir
          ? path.join(linux, linuxDir)
          : process.platform === "win32" && windows && windowsDir
            ? path.join(windows, windowsDir)
            : null;
    return root ? [{ name, root, service, account, application }] : [];
  });
}

function safeDirectory(name) {
  return (
    typeof name === "string" && !!name && name !== "." && name !== ".." && !/[\\/\0]/.test(name)
  );
}

async function filePath(file) {
  try {
    const result = await fs.realpath(file);
    return (await fs.stat(result)).isFile() ? result : null;
  } catch {
    return null;
  }
}

/** Discover profile names without opening cookie databases or the system key store. */
export async function listChromiumImportSources() {
  const sources = [];
  const seen = new Set();
  for (const definition of browserRoots()) {
    let state = {};
    try {
      const stateFile = path.join(definition.root, "Local State");
      if ((await fs.stat(stateFile)).size <= 10 * 1024 * 1024)
        state = JSON.parse(await fs.readFile(stateFile, "utf8"));
    } catch {
      /* Scan on-disk profiles if metadata is unavailable. */
    }
    const cache = state?.profile?.info_cache;
    const declared =
      cache && typeof cache === "object" ? Object.keys(cache).filter(safeDirectory) : [];
    let entries = [];
    try {
      entries = (await fs.readdir(definition.root)).filter(safeDirectory);
    } catch {
      continue;
    }
    const directories = [...new Set([".", ...declared, ...entries])];
    for (const directory of directories) {
      const location = directory === "." ? definition.root : path.join(definition.root, directory);
      const database =
        (await filePath(path.join(location, "Network", "Cookies"))) ??
        (await filePath(path.join(location, "Cookies")));
      if (!database || seen.has(database)) continue;
      seen.add(database);
      const displayName =
        directory === "."
          ? "Default"
          : (typeof cache?.[directory]?.name === "string" ? cache[directory].name.trim() : "") ||
            directory;
      sources.push({
        ...definition,
        database,
        id: createHash("sha256").update(database).digest("hex"),
        name: `${definition.name} · ${displayName}`,
      });
    }
  }
  return sources;
}

// Never print the keyring result, include it in errors, or put it in command-line arguments.
function readProcess(program, args, input, { nativeHelper = false, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const chunks = [];
    const errors = [];
    let size = 0;
    let errorSize = 0;
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size <= 64 * 1024) chunks.push(chunk);
      else child.kill();
    });
    child.stderr.on("data", (chunk) => {
      errorSize += chunk.length;
      if (errorSize <= 8192) errors.push(chunk);
    });
    child.once("error", (cause) => {
      const error = new Error("The operating system key store is unavailable.");
      if (cause?.code === "ENOENT") error.code = "keyring_tool_missing";
      reject(error);
    });
    child.once("close", (code) => {
      if (code !== 0 || size > 64 * 1024) {
        const denied = nativeHelper
          ? code === 3
          : /cancel(?:led|ed)|denied|locked|dismissed/i.test(
              Buffer.concat(errors).toString("utf8"),
            );
        const error = new Error(
          denied
            ? "Access to the operating system key store was denied."
            : "The operating system key store did not provide a key.",
        );
        if (denied) error.code = "keyring_denied";
        else if (nativeHelper && code === 4) error.code = "keyring_tool_missing";
        reject(error);
      } else {
        const output = Buffer.concat(chunks);
        resolve(raw ? output : output.toString("utf8").replace(/\r?\n$/, ""));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}

const derive = (passphrase, iterations) =>
  pbkdf2Sync(passphrase, "saltysalt", iterations, 16, "sha1");

async function linuxKeyringSecret(application) {
  try {
    // ctypes talks directly to the same libsecret API used by T3's native helper.
    // Isolated Python ignores user site packages and PYTHON* environment variables.
    return await readProcess(
      "python3",
      ["-I", fileURLToPath(new URL("./browser-secret-linux.py", import.meta.url)), application],
      undefined,
      { nativeHelper: true, raw: true },
    );
  } catch (error) {
    if (error?.code !== "keyring_tool_missing") throw error;
    return readProcess("secret-tool", ["lookup", "application", application]);
  }
}

async function chromiumKeys(source) {
  if (process.platform === "linux") {
    let secret;
    let keyringToolMissing = false;
    try {
      if (source.application) secret = await linuxKeyringSecret(source.application);
    } catch (error) {
      if (error?.code === "keyring_denied") throw error;
      keyringToolMissing = error?.code === "keyring_tool_missing";
      /* v10 cookies may still use Chromium's standard fallback. */
    }
    return {
      v10: derive("peanuts", 1),
      v11: secret?.length ? derive(secret, 1) : null,
      empty: derive("", 1),
      keyringToolMissing,
    };
  }
  if (process.platform === "darwin") {
    const secret = await readProcess("/usr/bin/security", [
      "find-generic-password",
      "-w",
      "-s",
      source.service,
      "-a",
      source.account,
    ]);
    if (!secret) throw new Error("The operating system key store did not provide a key.");
    return { v10: derive(secret, 1003) };
  }
  if (process.platform === "win32") {
    const state = JSON.parse(await fs.readFile(path.join(source.root, "Local State"), "utf8"));
    if (state?.os_crypt?.app_bound_encrypted_key)
      throw new Error("This browser uses app-bound encryption that cannot be imported.");
    const encrypted = Buffer.from(state?.os_crypt?.encrypted_key ?? "", "base64");
    if (encrypted.subarray(0, 5).toString("ascii") !== "DPAPI")
      throw new Error("The browser's encryption key is unavailable.");
    const script =
      "Add-Type -AssemblyName System.Security;$v=[Console]::In.ReadToEnd();$b=[Convert]::FromBase64String($v);$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($p))";
    const root = process.env.SystemRoot ?? process.env.WINDIR;
    const binary = root
      ? path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe";
    const key = Buffer.from(
      await readProcess(
        binary,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        encrypted.subarray(5).toString("base64"),
      ),
      "base64",
    );
    if (key.length !== 32) throw new Error("The browser's encryption key is unavailable.");
    return { gcm: key };
  }
  throw new Error("Browser import is not supported on this operating system.");
}

function decryptValue(encrypted, keys, domain, version) {
  const data = Buffer.from(encrypted);
  const prefix = data.subarray(0, 3).toString("ascii");
  const payload = data.subarray(3);
  const unbind = (plain) => {
    if (version < 24) return plain.toString("utf8");
    const digest = createHash("sha256").update(domain).digest();
    return plain.length >= 32 && plain.subarray(0, 32).equals(digest)
      ? plain.subarray(32).toString("utf8")
      : null;
  };
  if (process.platform === "win32") {
    if (prefix !== "v10" || !keys.gcm || payload.length < 28) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", keys.gcm, payload.subarray(0, 12));
      decipher.setAuthTag(payload.subarray(-16));
      return unbind(Buffer.concat([decipher.update(payload.subarray(12, -16)), decipher.final()]));
    } catch {
      return null;
    }
  }
  if (prefix === "v10" || prefix === "v11") {
    const primary = prefix === "v10" ? keys.v10 : keys.v11;
    for (const key of [primary, keys.empty].filter(Boolean)) {
      try {
        const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
        const value = unbind(Buffer.concat([decipher.update(payload), decipher.final()]));
        if (value !== null) return value;
      } catch {
        /* Try the next permitted key. */
      }
    }
    return null;
  }
  if (prefix === "v20") return null;
  return unbind(data);
}

function cookieFor(row, value) {
  const domain = row.host_key;
  if (typeof domain !== "string" || typeof row.name !== "string" || typeof value !== "string")
    return null;
  const domainCookie = domain.startsWith(".");
  const host = domainCookie ? domain.slice(1) : domain;
  if (!host || /[\s/@?#\\%]/.test(host)) return null;
  const cookiePath = typeof row.path === "string" && row.path.startsWith("/") ? row.path : "/";
  const secure = row.is_secure === 1;
  const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const url = `${secure ? "https" : "http"}://${authority}${cookiePath}`;
  try {
    new URL(url);
  } catch {
    return null;
  }
  const expires =
    Number(row.expires_seconds) > 0 ? Number(row.expires_seconds) - 11_644_473_600 : 0;
  if (expires > 0 && expires <= Math.floor(Date.now() / 1000)) return null;
  if (expires < 0) return null;
  const sameSite =
    row.samesite === 0 ? "None" : row.samesite === 1 ? "Lax" : row.samesite === 2 ? "Strict" : null;
  return {
    name: row.name,
    value,
    ...(domainCookie ? { domain, path: cookiePath } : { url, path: cookiePath }),
    secure,
    httpOnly: row.is_httponly === 1,
    ...(expires > 0 && Number.isSafeInteger(expires) ? { expires } : {}),
    ...(sameSite ? { sameSite } : {}),
  };
}

/** Snapshot and decrypt only the selected browser's cookies. */
export async function readChromiumImport(sourceId) {
  const source = (await listChromiumImportSources()).find((item) => item.id === sourceId);
  if (!source) throw new Error("That browser profile is no longer available.");
  let sqlite;
  try {
    sqlite = await import("node:sqlite");
  } catch {
    throw new Error("Browser import requires Node 22.13 or newer.");
  }
  const keys = await chromiumKeys(source);
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
    const metadata = snapshot.prepare("SELECT value FROM meta WHERE key = 'version'").get();
    const version = metadata ? Number(metadata.value) : NaN;
    if (!Number.isSafeInteger(version) || version < 0)
      throw new Error("Invalid browser cookie database.");
    const columns = new Set(
      snapshot
        .prepare("PRAGMA table_info(cookies)")
        .all()
        .map((row) => row.name),
    );
    const topFrame = columns.has("top_frame_site_key")
      ? "top_frame_site_key"
      : "'' AS top_frame_site_key";
    const rows = snapshot
      .prepare(
        `SELECT host_key, name, value, encrypted_value, path, expires_utc / 1000000 AS expires_seconds, is_secure, is_httponly, samesite, ${topFrame} FROM cookies`,
      )
      .all();
    const cookies = [];
    let skipped = 0;
    let missingKey = false;
    for (const row of rows) {
      if (row.top_frame_site_key || typeof row.host_key !== "string") {
        skipped++;
        continue;
      }
      const encrypted = row.encrypted_value;
      if (encrypted != null && !(encrypted instanceof Uint8Array)) {
        skipped++;
        continue;
      }
      const value = encrypted?.length
        ? decryptValue(encrypted, keys, row.host_key, version)
        : row.value;
      if (
        value === null &&
        process.platform === "linux" &&
        !keys.v11 &&
        encrypted?.length &&
        Buffer.from(encrypted).subarray(0, 3).toString("ascii") === "v11"
      )
        missingKey = true;
      const cookie = cookieFor(row, value);
      if (cookie) cookies.push(cookie);
      else skipped++;
    }
    if (missingKey && !cookies.length)
      throw new Error(
        keys.keyringToolMissing
          ? "Install Python 3 and libsecret, or install secret-tool, and unlock your system keyring to import these cookies."
          : "The operating system key store did not provide a key.",
      );
    return { cookies, skipped, ...(missingKey ? { keyringMissing: true } : {}) };
  } finally {
    original?.close();
    snapshot?.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
}
