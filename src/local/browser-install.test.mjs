import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import { browserRelease, chromePlatform, createBrowserInstaller } from "./browser-install.mjs";

/** A stored (uncompressed) zip with unix modes, enough for the installer's checks. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data = Buffer.alloc(0), mode } of entries) {
    const nameBytes = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(((mode ?? (name.endsWith("/") ? 0o040755 : 0o100644)) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const shellArchive = () =>
  zip([
    { name: "chrome-headless-shell-linux64/" },
    {
      name: "chrome-headless-shell-linux64/chrome-headless-shell",
      data: Buffer.from("#!/bin/sh\n"),
      mode: 0o100755,
    },
    { name: "chrome-headless-shell-linux64/resources.pak", data: Buffer.from("pak") },
  ]);

const baseDirs = [];
process.once("exit", () => {
  for (const dir of baseDirs) rmSync(dir, { recursive: true, force: true });
});

function setup(archive, { sha256, bytes, body } = {}) {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), "ade-browser-install-"));
  baseDirs.push(baseDir);
  const release = {
    version: "1.0.0",
    platform: "linux64",
    url: "https://storage.example/chrome-headless-shell-linux64.zip",
    bytes: bytes ?? archive.length,
    sha256: sha256 ?? createHash("sha256").update(archive).digest("hex"),
  };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return new Response(body?.() ?? archive, {
      headers: body ? {} : { "content-length": String(archive.length) },
    });
  };
  const installer = createBrowserInstaller({
    baseDir,
    platform: "linux",
    arch: "x64",
    release,
    fetchImpl,
  });
  return { baseDir, installer, calls };
}

test("the pinned release covers each Chrome for Testing platform", () => {
  assert.equal(chromePlatform("linux", "x64"), "linux64");
  assert.equal(chromePlatform("darwin", "arm64"), "mac-arm64");
  assert.equal(chromePlatform("win32", "arm64"), "win64");
  assert.equal(chromePlatform("linux", "ia32"), null);
  assert.equal(chromePlatform("freebsd", "x64"), null);
  const release = browserRelease("linux", "x64");
  assert.match(
    release.url,
    /chrome-for-testing-public\/.+\/linux64\/chrome-headless-shell-linux64\.zip$/,
  );
  assert.match(release.sha256, /^[0-9a-f]{64}$/);
});

test("installs a verified archive once and finds it afterwards", async () => {
  const { baseDir, installer, calls } = setup(shellArchive());
  const executable = await installer.executable();
  assert.equal(
    executable,
    path.join(
      baseDir,
      "tools",
      "chrome-headless-shell",
      "linux64",
      "1.0.0",
      "chrome-headless-shell",
    ),
  );
  assert.equal(statSync(executable).mode & 0o777, 0o755);
  assert.equal(await installer.executable(), executable);
  assert.equal(await installer.installed(), executable);
  assert.equal(calls.length, 1);
  assert.equal(installer.status().state, "installed");
});

test("a download that fails its SHA-256 check installs nothing and is retried", async () => {
  const { installer, calls } = setup(shellArchive(), { sha256: "0".repeat(64) });
  await assert.rejects(installer.executable(), (error) => {
    assert.equal(error.code, "browser_install_failed");
    assert.match(error.message, /SHA-256/);
    return true;
  });
  // The caller saw the failure, so the next call starts over (T3's clearFailure).
  assert.equal(installer.status().state, "idle");
  assert.equal(await installer.installed(), null);
  await assert.rejects(installer.executable(), { code: "browser_install_failed" });
  assert.equal(calls.length, 2);
});

test("a download whose size disagrees with the pin is refused before reading it", async () => {
  const { installer } = setup(shellArchive(), { bytes: 7 });
  await assert.rejects(installer.executable(), /size did not match/);
});

test("entries outside the headless shell's folder are refused as unsafe", async () => {
  const archive = zip([
    {
      name: "chrome-headless-shell-linux64/chrome-headless-shell",
      data: Buffer.from("x"),
      mode: 0o100755,
    },
    { name: "elsewhere/evil", data: Buffer.from("x") },
  ]);
  const { installer } = setup(archive);
  await assert.rejects(installer.executable(), /unexpected or unsafe entry/);
  assert.equal(await installer.installed(), null);
});

test("an archive without the executable is refused", async () => {
  const archive = zip([
    { name: "chrome-headless-shell-linux64/resources.pak", data: Buffer.from("pak") },
  ]);
  const { installer } = setup(archive);
  await assert.rejects(installer.executable(), /does not contain chrome-headless-shell/);
});

test("callers get download progress after the wait while the install keeps going", async () => {
  const archive = shellArchive();
  let finish;
  const stalled = new Promise((resolve) => (finish = resolve));
  const { installer } = setup(archive, {
    body: () =>
      new ReadableStream({
        async start(controller) {
          controller.enqueue(archive.subarray(0, 10));
          await stalled;
          controller.enqueue(archive.subarray(10));
          controller.close();
        },
      }),
  });
  await assert.rejects(installer.executable({ wait: 30 }), (error) => {
    assert.equal(error.code, "browser_installing");
    assert.equal(error.progress.downloadedBytes, 10);
    assert.equal(error.progress.totalBytes, archive.length);
    return true;
  });
  assert.equal(installer.status().state, "installing");
  const done = installer.executable({ wait: Infinity });
  finish();
  assert.match(await done, /chrome-headless-shell$/);
});

test("hosts without a headless shell are unsupported", async () => {
  const installer = createBrowserInstaller({
    baseDir: os.tmpdir(),
    platform: "linux",
    arch: "ia32",
  });
  assert.equal(installer.status().state, "unsupported");
  assert.match(installer.status().detail, /linux-ia32/);
  await assert.rejects(installer.executable(), { code: "browser_unsupported" });
});
