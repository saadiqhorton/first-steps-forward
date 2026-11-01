import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import {
  launchRemote,
  networkAddresses,
  remoteToken,
  shareOnTailnet,
  tailscaleStatus,
} from "./remote.mjs";

const tmp = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-remote-"));
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** A stand-in for `tailscale serve`: `script` drives the child once it is spawned. */
function fakeTailscale(script) {
  const spawned = [];
  const spawn = (bin, args) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      signals: [],
      kill(signal) {
        this.signals.push(signal);
        setImmediate(() => this.emit("close", null));
        return true;
      },
    });
    spawned.push({ bin, args, child });
    setImmediate(() => script(child));
    return child;
  };
  return { spawn, spawned };
}
const sharing = (child) => child.stdout.write("Available within your tailnet:\n\nhttps://box/\n");
const denied = (child) => {
  child.stderr.write("Access denied: serve config denied\nUse 'sudo tailscale serve'\n");
  child.emit("close", 1);
};

const status = (fields) => async () => ({
  code: 0,
  stdout: JSON.stringify({
    BackendState: "Running",
    Self: { DNSName: "box.tail1234.ts.net." },
    CertDomains: ["box.tail1234.ts.net"],
    ...fields,
  }),
  stderr: "",
});
const noTailscale = async () => ({ code: 127, stdout: "", stderr: "spawn tailscale ENOENT" });
const interfaces = {
  lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  wlan0: [
    { address: "192.168.1.20", family: "IPv4", internal: false },
    { address: "fe80::1", family: "IPv6", internal: false },
  ],
  tailscale0: [{ address: "100.86.51.32", family: "IPv4", internal: false }],
  docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
  eth1: [{ address: "169.254.3.4", family: "IPv4", internal: false }],
};

test("the access token is made once, private, and shared by concurrent starts", async () => {
  const dir = path.join(tmp(), ".ade");
  const tokens = await Promise.all(Array.from({ length: 5 }, () => remoteToken(dir)));
  assert.match(tokens[0], /^[0-9a-f]{32}$/);
  assert.deepEqual(new Set(tokens).size, 1);
  assert.equal(await remoteToken(dir), tokens[0], "a restart keeps the same token");
  if (process.platform !== "win32")
    assert.equal(statSync(path.join(dir, "remote-token")).mode & 0o777, 0o600);
});

test("Tailscale counts only when connected, and HTTPS only with certificates on", async () => {
  assert.deepEqual(await tailscaleStatus(status()), { name: "box.tail1234.ts.net", https: true });
  assert.deepEqual(await tailscaleStatus(status({ CertDomains: null })), {
    name: "box.tail1234.ts.net",
    https: false,
  });
  assert.equal(await tailscaleStatus(status({ BackendState: "Stopped" })), null);
  assert.equal(await tailscaleStatus(noTailscale), null);
  assert.equal(await tailscaleStatus(async () => ({ code: 0, stdout: "not json" })), null);
});

test("sharing on the tailnet runs `tailscale serve` until stopped", async () => {
  const { spawn, spawned } = fakeTailscale(sharing);
  let exited = false;
  const share = await shareOnTailnet(3000, { spawn, onExit: () => (exited = true) });
  assert.deepEqual(spawned[0].args, ["serve", "--https=443", "http://127.0.0.1:3000"]);
  share.stop();
  assert.deepEqual(spawned[0].child.signals, ["SIGINT"], "SIGINT lets Tailscale drop the share");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(exited, true);
});

test("a share Tailscale refuses, cannot run, or never confirms is reported", async () => {
  await assert.rejects(shareOnTailnet(3000, fakeTailscale(denied)), /Access denied/);
  await assert.rejects(
    shareOnTailnet(
      3000,
      fakeTailscale((child) => child.emit("error", new Error("spawn ENOENT"))),
    ),
    /ENOENT/,
  );
  const silent = fakeTailscale(() => {});
  await assert.rejects(
    shareOnTailnet(3000, { spawn: silent.spawn, timeoutMs: 20 }),
    /did not start/,
  );
  assert.deepEqual(silent.spawned[0].child.signals, ["SIGINT"]);
});

test("network addresses split Tailscale from the local network and skip bridges", () => {
  assert.deepEqual(networkAddresses(interfaces), {
    tailnet: ["100.86.51.32"],
    lan: ["192.168.1.20"],
  });
});

/** launchRemote with fakes; returns what ADE was launched with and what it printed. */
async function remote({ run, script = sharing, env = {}, launch } = {}) {
  const launched = [];
  const lines = [];
  const tailscale = fakeTailscale(script);
  const result = await launchRemote({
    staticDir: "/static",
    port: 3000,
    dataDir: path.join(tmp(), ".ade"),
    env,
    log: (line) => lines.push(line),
    run,
    spawn: tailscale.spawn,
    interfaces,
    launch:
      launch ??
      (async (options) => {
        launched.push(options);
        return { server: {}, url: "unused" };
      }),
  });
  return { result, launched, output: lines.join("\n"), env, tailscale };
}

test("with Tailscale, ADE stays on loopback and prints one HTTPS sign-in link", async () => {
  const { result, launched, output, env } = await remote({ run: status() });
  assert.equal(launched[0].host, "127.0.0.1");
  assert.match(env.ADE_TOKEN, /^[0-9a-f]{32}$/);
  assert.deepEqual(result.links, [`https://box.tail1234.ts.net/api/auth?token=${env.ADE_TOKEN}`]);
  assert.equal(result.url, "http://127.0.0.1:3000");
  assert.match(output, /only devices on your tailnet/);
  assert.doesNotMatch(output, /plain HTTP/);
});

test("without Tailscale, ADE listens on the network and prints a link per address", async () => {
  const { result, launched, output, env } = await remote({ run: noTailscale });
  assert.equal(launched[0].host, "0.0.0.0");
  assert.deepEqual(result.links, [
    `http://100.86.51.32:3000/api/auth?token=${env.ADE_TOKEN}`,
    `http://192.168.1.20:3000/api/auth?token=${env.ADE_TOKEN}`,
  ]);
  assert.match(output, /plain HTTP/);
  assert.match(output, /install Tailscale/);
});

test("when Tailscale cannot share, ADE falls back to the network and says why", async () => {
  const { launched, output } = await remote({ run: status(), script: denied });
  assert.equal(launched[0].host, "0.0.0.0");
  assert.match(output, /Tailscale could not share ADE \(Access denied/);
  const off = await remote({ run: status({ CertDomains: [] }) });
  assert.equal(off.launched[0].host, "0.0.0.0");
  assert.match(off.output, /Turn on HTTPS for your tailnet/);
});

test("a token the user set is kept, and a failed start ends the share", async () => {
  const { env } = await remote({ run: status(), env: { ADE_TOKEN: " mine " } });
  assert.equal(env.ADE_TOKEN, "mine");
  const tailscale = fakeTailscale(sharing);
  const inUse = Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
  await assert.rejects(
    launchRemote({
      staticDir: "/static",
      port: 3000,
      dataDir: path.join(tmp(), ".ade"),
      env: {},
      log() {},
      run: status(),
      spawn: tailscale.spawn,
      interfaces,
      launch: async () => {
        throw inUse;
      },
    }),
    inUse,
  );
  assert.deepEqual(tailscale.spawned[0].child.signals, ["SIGINT"]);
  await assert.rejects(
    launchRemote({ staticDir: "/static", port: 0, dataDir: tmp(), env: {} }),
    /needs a fixed port/,
  );
});
