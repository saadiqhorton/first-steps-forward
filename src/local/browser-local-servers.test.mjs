import test from "node:test";
import assert from "node:assert/strict";
import {
  createLocalServerDiscovery,
  parseLsofListeners,
  parseNetstatListeners,
  parseSsListeners,
} from "./browser-local-servers.mjs";

const ssOutput = `LISTEN 0 511 127.0.0.1:5173 0.0.0.0:* users:(("node",pid=11,fd=18))
LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=12,fd=19))
LISTEN 0 511 [::1]:8080 [::]:* users:(("bun",pid=13,fd=20))
LISTEN 0 511 192.168.1.5:9000 0.0.0.0:* users:(("node",pid=14,fd=21))
LISTEN 0 511 127.0.0.1:631 0.0.0.0:* users:(("cupsd",pid=15,fd=7))
LISTEN 0 511 127.0.0.1:5432 0.0.0.0:* users:(("postgres",pid=16,fd=22))`;

test("ss listeners keep only loopback-reachable ports and their process", () => {
  assert.deepEqual(parseSsListeners(ssOutput), [
    { port: 5173, processName: "node", pid: 11 },
    { port: 3000, processName: "node", pid: 12 },
    { port: 8080, processName: "bun", pid: 13 },
    { port: 631, processName: "cupsd", pid: 15 },
    { port: 5432, processName: "postgres", pid: 16 },
  ]);
});

test("lsof and netstat listeners are parsed the same way", () => {
  assert.deepEqual(
    parseLsofListeners(
      `p11\ncnode\nn127.0.0.1:5173\nn192.168.1.5:9000\np12\ncpostgres\nn[::1]:5432`,
    ),
    [
      { port: 5173, processName: "node", pid: 11 },
      { port: 5432, processName: "postgres", pid: 12 },
    ],
  );
  assert.deepEqual(
    parseNetstatListeners(`  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4321
  TCP    192.168.1.5:9000       0.0.0.0:0              LISTENING       4322`),
    [{ port: 5173, pid: 4321 }],
  );
});

function fakeFetch(answers) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const port = Number(new URL(url).port);
    const answer = answers[port];
    if (answer === "throw") throw new Error("connection refused");
    return new Response(answer.body, {
      status: answer.status ?? 200,
      headers: { "content-type": answer.type ?? "text/html" },
    });
  };
  return { fetchImpl, calls };
}

test("only listeners serving an HTML page are offered, sorted and de-duplicated", async () => {
  const { fetchImpl } = fakeFetch({
    3000: { body: "<!doctype html><p>Plain app" },
    5173: { body: "<html><head><title> Vite  +  App </title></head></html>" },
    8080: { body: '{"json":true}', type: "application/json" },
    5432: "throw",
  });
  const discovery = createLocalServerDiscovery({
    platform: "linux",
    run: async () => ({ stdout: ssOutput }),
    fetchImpl,
  });
  const servers = await discovery.scan();
  assert.deepEqual(
    servers.map((server) => [server.port, server.title, server.processName]),
    [
      [3000, "", "node"],
      [5173, "Vite + App", "node"],
    ],
  );
  assert.equal(servers[0].url, "http://127.0.0.1:3000/");
});

test("dead, empty or redirecting ports are not offered", async () => {
  const { fetchImpl } = fakeFetch({
    3000: { body: "", status: 200 },
    5173: { body: "<p>gone</p>", status: 404 },
    8080: { body: "<p>moved</p>", status: 301 },
  });
  const discovery = createLocalServerDiscovery({
    platform: "linux",
    run: async () => ({ stdout: ssOutput }),
    fetchImpl,
  });
  assert.deepEqual(await discovery.scan(), []);
});

test("the scan excludes ADE's own port, system processes and privileged ports", async () => {
  const { fetchImpl, calls } = fakeFetch({
    3000: { body: "<p>app" },
    5173: { body: "<p>app" },
  });
  const discovery = createLocalServerDiscovery({
    platform: "linux",
    run: async () => ({ stdout: ssOutput }),
    fetchImpl,
  });
  const servers = await discovery.scan([3000]);
  assert.deepEqual(
    servers.map((server) => server.port),
    [5173],
  );
  assert.equal(
    calls.some((url) => url.includes(":631")),
    false,
  );
  assert.equal(
    calls.some((url) => url.includes(":3000")),
    false,
  );
});

test("a scan is reused briefly so a polling pane does not rescan every time", async () => {
  let clock = 1_000;
  const { fetchImpl, calls } = fakeFetch({ 3000: { body: "<p>app" } });
  const discovery = createLocalServerDiscovery({
    platform: "linux",
    run: async () => ({ stdout: ssOutput }),
    fetchImpl,
    now: () => clock,
  });
  await discovery.scan();
  const first = calls.length;
  await discovery.scan();
  assert.equal(calls.length, first);
  clock += 3_001;
  await discovery.scan();
  assert.ok(calls.length > first);
});

test("a scan that finds no listener still answers, and a failed command reports no servers", async () => {
  const discovery = createLocalServerDiscovery({
    platform: "linux",
    run: async () => {
      throw new Error("ss is not installed");
    },
    fetchImpl: async () => {
      throw new Error("no probe");
    },
  });
  assert.deepEqual(await discovery.scan(), []);
});
