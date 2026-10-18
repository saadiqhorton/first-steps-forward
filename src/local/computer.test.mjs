import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  containerName,
  createComputerManager,
  describeContainer,
  imageTag,
  runArgs,
  viewerUrl,
} from "./computer.mjs";

function fixtureRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "ade-computer-"));
  const dir = path.join(root, "docker", "agent-computer");
  mkdirSync(dir, { recursive: true });
  for (const file of ["Dockerfile", "start.sh", "computer-server.py"])
    writeFileSync(path.join(dir, file), `# ${file}\n`);
  return root;
}
const inspectJson = (running = true) =>
  JSON.stringify([
    {
      State: { Running: running, ExitCode: running ? 0 : 137, StartedAt: "2026-10-01T12:00:00Z" },
      Config: { Image: "ade-computer:abc", Labels: { "ade.vnc": "pw123456", "ade.token": "tok" } },
      NetworkSettings: {
        Ports: {
          "6080/tcp": [{ HostPort: "49001" }],
          "7000/tcp": [{ HostPort: "49002" }],
          "9223/tcp": [{ HostPort: "49003" }],
        },
      },
    },
  ]);

test("container args publish on loopback only, drop caps, and carry secrets as labels", () => {
  const args = runArgs({ projectId: "p/1", image: "img", vncPassword: "pw", controlToken: "tok" });
  assert.equal(containerName("p/1"), "ade-computer-p1");
  assert.ok(args.includes("127.0.0.1::6080") && args.includes("127.0.0.1::7000"));
  assert.ok(args.includes("127.0.0.1::9223"));
  assert.ok(!args.some((a) => /^0\.0\.0\.0|^::/.test(a)));
  assert.ok(args.includes("ALL") && args.includes("no-new-privileges"));
  assert.ok(args.includes("ade.vnc=pw") && args.includes("ade.token=tok"));
  assert.ok(args.includes("host.docker.internal:host-gateway"));
  assert.equal(args.at(-1), "img");
});

test("viewer URLs are loopback noVNC, view-only unless control is asked for", () => {
  assert.match(viewerUrl(49001, "pw"), /^http:\/\/127\.0\.0\.1:49001\/\?/);
  assert.match(viewerUrl(49001, "pw"), /view_only=1/);
  assert.match(viewerUrl(49001, "pw", false), /\/\?/);
  assert.doesNotMatch(viewerUrl(49001, "pw", false), /view_only=/);
  assert.match(viewerUrl(49001, "pw"), /password=pw/);
});

test("describeContainer reads ports, state, and label secrets", () => {
  const info = describeContainer(JSON.parse(inspectJson())[0]);
  assert.deepEqual(
    { ...info, startedAt: undefined },
    {
      running: true,
      exitCode: 0,
      startedAt: undefined,
      image: "ade-computer:abc",
      vncPort: 49001,
      controlPort: 49002,
      cdpPort: 49003,
      vncPassword: "pw123456",
      controlToken: "tok",
    },
  );
  assert.equal(describeContainer(null), null);
});

test("image tag changes when the image sources change", async () => {
  const root = fixtureRoot();
  const dir = path.join(root, "docker", "agent-computer");
  const before = await imageTag(dir);
  writeFileSync(path.join(dir, "start.sh"), "# changed\n");
  assert.notEqual(await imageTag(dir), before);
  assert.match(before, /^ade-computer:[0-9a-f]{12}$/);
});

test("running status reports the CDP port and whether the image is outdated", async () => {
  const root = fixtureRoot();
  const current = await imageTag(path.join(root, "docker", "agent-computer"));
  const runningWith = (image, ports) => {
    const info = JSON.parse(inspectJson())[0];
    info.Config.Image = image;
    info.NetworkSettings.Ports = ports;
    return JSON.stringify([info]);
  };
  const ports = {
    "6080/tcp": [{ HostPort: "49001" }],
    "7000/tcp": [{ HostPort: "49002" }],
    "9223/tcp": [{ HostPort: "49003" }],
  };
  let stdout = runningWith(current, ports);
  const run = async (bin, args) => {
    if (args[0] === "version") return { code: 0, stdout: "29", stderr: "" };
    if (args[0] === "inspect") return { code: 0, stdout, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  const manager = createComputerManager({ root, run });

  const fresh = await manager.status("p1");
  assert.equal(fresh.status, "running");
  assert.equal(fresh.cdpPort, 49003);
  assert.equal(fresh.outdated, false);

  stdout = runningWith("ade-computer:old", { ...ports, "9223/tcp": undefined });
  const old = await manager.status("p1");
  assert.equal(old.status, "running");
  assert.equal(old.cdpPort, null);
  assert.equal(old.outdated, true);
});

test("status reports Docker missing honestly instead of pretending", async () => {
  const manager = createComputerManager({
    root: fixtureRoot(),
    run: async () => ({ code: 127, stdout: "", stderr: "spawn docker ENOENT" }),
  });
  const status = await manager.status("p1");
  assert.equal(status.status, "unavailable");
  assert.match(status.detail, /Docker is not installed/);
});

test("start builds a missing image, runs the container, waits for health; action proxies", async () => {
  const calls = [];
  let created = false;
  const run = async (bin, args) => {
    calls.push(args.join(" "));
    if (args[0] === "version") return { code: 0, stdout: "29.0.0", stderr: "" };
    if (args[0] === "inspect")
      return created
        ? { code: 0, stdout: inspectJson(), stderr: "" }
        : { code: 1, stdout: "", stderr: "no such" };
    if (args[0] === "image") return { code: 1, stdout: "", stderr: "no such image" };
    if (args[0] === "build") return { code: 0, stdout: "built", stderr: "" };
    if (args[0] === "run") {
      created = true;
      return { code: 0, stdout: "cid", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith("/health")) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, screenshot: "AAAA", width: 1280, height: 800 }),
    };
  };
  const manager = createComputerManager({ root: fixtureRoot(), run, fetchImpl });
  assert.equal((await manager.status("p1")).status, "stopped");
  await manager.start("p1");
  assert.ok(calls.some((c) => c.startsWith("build -t ade-computer:")));
  assert.ok(calls.some((c) => c.startsWith("run -d --name ade-computer-p1")));
  const status = await manager.status("p1");
  assert.equal(status.status, "running");
  assert.match(status.viewerUrl, /:49001\//);
  assert.match(status.controlViewerUrl, /:49001\//);
  assert.doesNotMatch(status.controlViewerUrl, /view_only=/);

  const result = await manager.action("p1", { action: "screenshot" });
  assert.equal(result.status, 200);
  assert.equal(result.payload.screenshot, "AAAA");
  const action = requests.find((r) => r.url.endsWith("/action"));
  assert.equal(action.url, "http://127.0.0.1:49002/action");
  assert.equal(action.init.headers["x-ade-token"], "tok");

  await manager.stop("p1");
  assert.ok(calls.includes("rm -f ade-computer-p1"));
});

test("a failed build surfaces as an error status with the build log", async () => {
  const run = async (bin, args, opts) => {
    if (args[0] === "version") return { code: 0, stdout: "29", stderr: "" };
    if (args[0] === "inspect" || args[0] === "image") return { code: 1, stdout: "", stderr: "" };
    if (args[0] === "build") {
      opts.onOutput?.("Step 1/4\nE: Unable to locate package chromium\n");
      return { code: 1, stdout: "", stderr: "failed" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const manager = createComputerManager({ root: fixtureRoot(), run });
  await assert.rejects(manager.start("p1"), /Building the computer image failed/);
  const status = await manager.status("p1");
  assert.equal(status.status, "error");
  assert.ok(status.log.some((line) => line.includes("Unable to locate package")));
});
