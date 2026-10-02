import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the service at a throwaway HOME *before* importing it, so load()/save()
// touch only the temp workspace and no CLI is ever spawned by these tests.
const home = mkdtempSync(path.join(os.tmpdir(), "ade-home-"));
mkdirSync(path.join(home, ".ade"), { mode: 0o700 });
const workspaceFile = path.join(home, ".ade", "workspace.json");
const seedSession = (id, status) => ({
  id,
  projectId: "p1",
  agentId: "codex",
  createdBy: "codex",
  request: "task",
  criteria: "",
  status,
  messages: [],
  changes: [],
  checks: [],
  logs: [],
  createdAt: 1,
  updatedAt: 1,
});
writeFileSync(
  workspaceFile,
  JSON.stringify({
    projects: [],
    sessions: [
      seedSession("s-ready", "ready"),
      seedSession("s-done", "complete"),
      seedSession("s-stopped", "stopped"),
    ],
    processes: [],
  }),
);
process.env.HOME = home;
// os.homedir() reads USERPROFILE on Windows, not HOME; without this the
// tests would write into the real ~/.ade workspace.
process.env.USERPROFILE = home;
const {
  handleLocalApi,
  devServerArgs,
  detectFramework,
  refreshDevProcess,
  classifyTurnFailure,
  executeChecks,
  checksFor,
  buildManifest,
  computerContext,
} = await import("./ade-local.mjs");

const apiRequest = (urlPath, body) => ({
  url: `http://127.0.0.1:3000${urlPath}`,
  method: body === undefined ? "GET" : "POST",
  headers: { entries: () => [["host", "127.0.0.1:3000"]] },
  // The built server passes a srvx NodeRequest: it exposes NO .socket; the
  // client address lives under runtime.node.req (see the srvx-shape test
  // below). handleLocalApi must still resolve loopback from it.
  runtime: { node: { req: { socket: { remoteAddress: "::ffff:127.0.0.1" } } } },
  text: async () => JSON.stringify(body ?? {}),
});
const call = async (urlPath, body) => {
  const res = await handleLocalApi(apiRequest(urlPath, body));
  return { status: res.status, json: await res.json() };
};

test("session creation rejects a flag-like model id with 400 before any spawn", async () => {
  const res = await call("/api/sessions", {
    projectId: "p1",
    agentId: "codex",
    request: "do something",
    model: "--evil",
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /start with a letter or digit/);
});

test("set-model sanitizes, applies, clears, and respects completed sessions", async () => {
  const bad = await call("/api/sessions/s-ready/model", { model: "no spaces allowed" });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /start with a letter or digit/);

  const set = await call("/api/sessions/s-ready/model", { model: "opencode-go/gpt-5.6-luna" });
  assert.equal(set.status, 200);
  // Response carries both old and new effective values.
  assert.equal(set.json.previousModel, null);
  assert.equal(set.json.model, "opencode-go/gpt-5.6-luna");
  assert.equal(set.json.messages.at(-1).role, "system");
  assert.match(set.json.messages.at(-1).text, /applies from the next CLI turn/);
  const persisted = JSON.parse(readFileSync(workspaceFile, "utf8"));
  assert.equal(
    persisted.sessions.find((s) => s.id === "s-ready").model,
    "opencode-go/gpt-5.6-luna",
  );

  // Same value again: no duplicate system message.
  const again = await call("/api/sessions/s-ready/model", { model: "opencode-go/gpt-5.6-luna" });
  assert.equal(again.status, 200);
  assert.equal(again.json.messages.length, 1);

  // null clears back to the agent default (absent field means default).
  const cleared = await call("/api/sessions/s-ready/model", { model: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.model, null);
  assert.equal(cleared.json.previousModel, "opencode-go/gpt-5.6-luna");
  assert.equal(cleared.json.messages.length, 2);

  const done = await call("/api/sessions/s-done/model", { model: "gpt-5.5" });
  assert.equal(done.status, 409);
  assert.match(done.json.error, /Reopen this session before changing its model/);

  const missing = await call("/api/sessions/nope/model", { model: "gpt-5.5" });
  assert.equal(missing.status, 404);
});

test("built-in folder browser lists directories one level at a time", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ade-browse-"));
  mkdirSync(path.join(root, "alpha"));
  mkdirSync(path.join(root, "beta"));
  mkdirSync(path.join(root, ".secret-dir"));
  writeFileSync(path.join(root, "file.txt"), "not a folder");

  const listed = await call(`/api/browse?path=${encodeURIComponent(root)}`);
  assert.equal(listed.status, 200);
  assert.equal(listed.json.path, root);
  assert.deepEqual(
    listed.json.dirs.map((d) => d.name),
    ["alpha", "beta"],
  );
  assert.ok(listed.json.dirs[0].path.startsWith(root));
  // Dotfolders stay hidden unless explicitly requested; files never appear.
  const withHidden = await call(`/api/browse?path=${encodeURIComponent(root)}&hidden=1`);
  assert.deepEqual(
    withHidden.json.dirs.map((d) => d.name),
    [".secret-dir", "alpha", "beta"],
  );

  // Parent navigation and error paths.
  const parent = await call(`/api/browse?path=${encodeURIComponent(root)}/alpha`);
  assert.equal(parent.json.path, path.join(root, "alpha"));
  assert.equal(parent.json.parent, root);
  const missingPath = await call("/api/browse?path=/definitely/not/here-xyz");
  assert.equal(missingPath.status, 400);
  assert.match(missingPath.json.error, /does not exist/);

  rmSync(root, { recursive: true, force: true });
});

test("unknown agents have no model listing", async () => {
  const res = await handleLocalApi({
    url: "http://127.0.0.1:3000/api/agents/claudette/models",
    method: "GET",
    headers: { entries: () => [["host", "127.0.0.1:3000"]] },
    runtime: { node: { req: { socket: { remoteAddress: "::1" } } } },
    text: async () => "",
  });
  assert.equal(res.status, 404);
});

test("self-hosted requests resolve the client address the way srvx presents it", async () => {
  const srvxRequest = (overrides = {}) => ({
    url: "http://127.0.0.1:3000/api/agents/unknown/models",
    method: "GET",
    headers: { entries: () => [["host", "127.0.0.1:3000"]] },
    text: async () => "",
    ...overrides,
  });
  // srvx NodeRequest shape: the raw socket only exists under runtime.node.req.
  const viaRuntime = await handleLocalApi(
    srvxRequest({ runtime: { node: { req: { socket: { remoteAddress: "::ffff:127.0.0.1" } } } } }),
  );
  assert.equal(viaRuntime.status, 404);
  // The .ip mirror counts as the address too.
  assert.equal((await handleLocalApi(srvxRequest({ ip: "::1" }))).status, 404);
  // A plain fetch Request (no runtime, no ip) has no provable address and
  // must fail closed rather than being trusted as loopback.
  assert.equal((await handleLocalApi(srvxRequest())).status, 403);
  // A real remote peer stays rejected.
  const remote = await handleLocalApi(
    srvxRequest({ runtime: { node: { req: { socket: { remoteAddress: "203.0.113.8" } } } } }),
  );
  assert.equal(remote.status, 403);
});

test("loopback guard still rejects non-local hosts", async () => {
  const res = await handleLocalApi({
    url: "http://example.com/api/sessions/s-ready/model",
    method: "POST",
    headers: { entries: () => [["host", "example.com"]] },
    runtime: { node: { req: { socket: { remoteAddress: "::1" } } } },
    text: async () => "{}",
  });
  assert.equal(res.status, 403);
});

test("non-loopback peers cannot submit requests or poison the captured manifest base URL", async () => {
  const denied = await handleLocalApi({
    url: "http://127.0.0.1:3000/api/projects",
    method: "POST",
    headers: { entries: () => [["host", "attacker.example:9443"]] },
    runtime: { node: { req: { socket: { remoteAddress: "203.0.113.8" } } } },
    text: async () => "{}",
  });
  assert.equal(denied.status, 403);
  const project = { id: "peer-check", name: "peer", path: home };
  const manifest = await buildManifest({ agentId: "codex" }, project);
  assert.equal(manifest.agentComputer.available, true);
  assert.equal(computerContext(project).env.ADE_API, "http://127.0.0.1:3000");
  const spoofedHost = await handleLocalApi({
    url: "http://attacker.example:9443/api/agents/unknown/models",
    method: "GET",
    headers: { entries: () => [["host", "attacker.example:9443"]] },
    runtime: { node: { req: { socket: { remoteAddress: "::1" } } } },
    text: async () => "",
  });
  assert.equal(spoofedHost.status, 403);
  assert.equal(computerContext(project).env.ADE_API, "http://127.0.0.1:3000");

  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    const response = await handleLocalApi({
      url: "http://127.0.0.1:3000/api/agents/unknown/models",
      method: "GET",
      headers: { entries: () => [["host", "127.0.0.1:3000"]] },
      runtime: { node: { req: { socket: { remoteAddress: address } } } },
      text: async () => "",
    });
    assert.equal(response.status, 404, `${address} should be accepted as loopback`);
  }
});

test("opt-in exposure is token-gated, loopback stays exempt, and login sets the cookie", async () => {
  const lanRequest = (overrides = {}) => ({
    url: "http://192.168.1.50:3000/api/agents/unknown/models",
    method: "GET",
    headers: { entries: () => [["host", "192.168.1.50:3000"]] },
    runtime: { node: { req: { socket: { remoteAddress: "203.0.113.8" } } } },
    text: async () => "",
    ...overrides,
  });
  const bearerHeaders = () => ({
    entries: () => [
      ["host", "192.168.1.50:3000"],
      ["authorization", "Bearer lan-secret"],
    ],
  });
  process.env.ADE_HOST = "192.168.1.50";
  try {
    // No ADE_TOKEN → the address is never treated as exposed.
    assert.equal((await handleLocalApi(lanRequest())).status, 403);
    process.env.ADE_TOKEN = "lan-secret";
    const denied = await handleLocalApi(lanRequest());
    assert.equal(denied.status, 401);
    const deniedBody = await denied.json();
    assert.equal(deniedBody.authRequired, true);
    // A Host header naming some other authority is refused even with the
    // right token (DNS-rebinding fence on a specific bind).
    const rebound = await handleLocalApi(
      lanRequest({
        url: "http://example.com/api/agents/unknown/models",
        headers: {
          entries: () => [
            ["host", "example.com"],
            ["authorization", "Bearer lan-secret"],
          ],
        },
      }),
    );
    assert.equal(rebound.status, 401);
    // Bearer and cookie both authorize.
    assert.equal((await handleLocalApi(lanRequest({ headers: bearerHeaders() }))).status, 404);
    assert.equal(
      (
        await handleLocalApi(
          lanRequest({
            headers: {
              entries: () => [
                ["host", "192.168.1.50:3000"],
                ["cookie", "ade_auth=lan-secret"],
              ],
            },
          }),
        )
      ).status,
      404,
    );
    // Loopback peers stay exempt without any token — but only under their
    // own loopback Host name (the strict original rules).
    assert.equal(
      (
        await handleLocalApi({
          url: "http://127.0.0.1:3000/api/agents/unknown/models",
          method: "GET",
          headers: { entries: () => [["host", "127.0.0.1:3000"]] },
          runtime: { node: { req: { socket: { remoteAddress: "::1" } } } },
          text: async () => "",
        })
      ).status,
      404,
    );
    // A loopback reverse proxy (`tailscale serve`) forwards with a preserved
    // non-loopback Host and X-Forwarded-Proto; its browser Origin (https,
    // different authority) must be accepted.
    const proxied = await handleLocalApi({
      url: "http://hackpad-tailnet:3000/api/agents/unknown/models",
      method: "GET",
      headers: {
        entries: () => [
          ["host", "hackpad-tailnet:3000"],
          ["x-forwarded-proto", "https"],
          ["origin", "https://hackpad-tailnet.ts.net"],
        ],
      },
      runtime: { node: { req: { socket: { remoteAddress: "127.0.0.1" } } } },
      text: async () => "",
    });
    assert.equal(proxied.status, 404);
    // ...but a browser-shaped request without X-Forwarded-Proto stays
    // unauthorized (401) in exposed mode — the Host fence governs who is
    // allowed, not the status code.
    const browserShaped = await handleLocalApi({
      url: "http://hackpad-tailnet:3000/api/agents/unknown/models",
      method: "GET",
      headers: { entries: () => [["host", "hackpad-tailnet:3000"]] },
      runtime: { node: { req: { socket: { remoteAddress: "203.0.113.8" } } } },
      text: async () => "",
    });
    assert.equal(browserShaped.status, 401);
    // Login: wrong token 401; right token sets the HttpOnly session cookie.
    const badLogin = await handleLocalApi({
      url: "http://192.168.1.50:3000/api/auth",
      method: "POST",
      headers: { entries: () => [["host", "192.168.1.50:3000"]] },
      runtime: { node: { req: { socket: { remoteAddress: "203.0.113.8" } } } },
      text: async () => JSON.stringify({ token: "nope" }),
    });
    assert.equal(badLogin.status, 401);
    const login = await handleLocalApi({
      url: "http://192.168.1.50:3000/api/auth",
      method: "POST",
      headers: { entries: () => [["host", "192.168.1.50:3000"]] },
      runtime: { node: { req: { socket: { remoteAddress: "203.0.113.8" } } } },
      text: async () => JSON.stringify({ token: "lan-secret" }),
    });
    assert.equal(login.status, 200);
    assert.match(String(login.headers.get("set-cookie")), /ade_auth=lan-secret/);
    assert.match(String(login.headers.get("set-cookie")), /HttpOnly/);
    // The exempt token exchange must not be usable to poison the captured
    // dev-control base URL with a forged loopback Host header: the capture
    // only accepts provably local requests, so the remote peer's 401 leaves
    // the manifest URL untouched.
    const poisoned = await handleLocalApi({
      url: "http://127.0.0.1:9999/api/auth",
      method: "POST",
      headers: { entries: () => [["host", "127.0.0.1:9999"]] },
      runtime: { node: { req: { socket: { remoteAddress: "203.0.113.8" } } } },
      text: async () => JSON.stringify({ token: "nope" }),
    });
    assert.equal(poisoned.status, 401);
    assert.equal(
      computerContext({ id: "peer-check", name: "peer", path: home }).env.ADE_API,
      "http://127.0.0.1:3000",
    );
    // A 0.0.0.0 bind spans interfaces: any Host name is accepted (token still
    // gates), so LAN IPs, Tailscale IPs, and MagicDNS names all work.
    process.env.ADE_HOST = "0.0.0.0";
    assert.equal(
      (
        await handleLocalApi(
          lanRequest({
            url: "http://hackpad-tailnet:3000/api/agents/unknown/models",
            headers: {
              entries: () => [
                ["host", "hackpad-tailnet:3000"],
                ["authorization", "Bearer lan-secret"],
              ],
            },
          }),
        )
      ).status,
      404,
    );
    // Loopback hostnames must never be treated as an exposed bind.
    process.env.ADE_HOST = "localhost";
    assert.equal((await handleLocalApi(lanRequest())).status, 403);
  } finally {
    delete process.env.ADE_HOST;
    delete process.env.ADE_TOKEN;
  }
});

test("oversized request bodies are refused without being fully read", async () => {
  const huge = "x".repeat(2 * 1024 * 1024);
  const declared = await handleLocalApi({
    url: "http://192.168.1.50:3000/api/auth",
    method: "POST",
    headers: {
      get: (name) => (name === "content-length" ? String(huge.length) : null),
      entries: () => [
        ["host", "192.168.1.50:3000"],
        ["content-length", String(huge.length)],
      ],
    },
    runtime: { node: { req: { socket: { remoteAddress: "203.0.113.8" } } } },
    text: async () => JSON.stringify({ token: huge }),
  });
  assert.equal(declared.status, 413);
  let cancelled = false;
  const stream = new ReadableStream({
    // A pull-based attacker body: every read yields another large chunk, so
    // the reader hits the cap mid-stream and must actually cancel.
    pull(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(700_000)));
    },
    cancel() {
      cancelled = true;
    },
  });
  const streamed = await handleLocalApi({
    url: "http://127.0.0.1:3000/api/auth",
    method: "POST",
    headers: { entries: () => [["host", "127.0.0.1:3000"]] },
    runtime: { node: { req: { socket: { remoteAddress: "127.0.0.1" } } } },
    body: stream,
  });
  assert.equal(streamed.status, 413);
  assert.equal(cancelled, true);
});

test("dev-server launch flags map by framework (next vs vite vs unknown)", () => {
  // next rejects --host outright: it takes -H/--hostname and -p.
  assert.deepEqual(devServerArgs("next", 3100), ["--", "-H", "127.0.0.1", "-p", "3100"]);
  // vite and other --host users take the long flags.
  assert.deepEqual(devServerArgs("vite", 3100), ["--", "--host", "127.0.0.1", "--port", "3100"]);
  // Unknown frameworks get only the port (the env PORT is added at spawn).
  assert.deepEqual(devServerArgs("unknown", 3100), ["--", "--port", "3100"]);

  assert.equal(detectFramework({ dependencies: { next: "^15.0.0" } }, "dev"), "next");
  assert.equal(detectFramework({}, "next dev -p 3000"), "next");
  assert.equal(detectFramework({ devDependencies: { vite: "^6.0.0" } }, "dev"), "vite");
  assert.equal(detectFramework({}, "vite --open"), "vite");
  assert.equal(detectFramework({}, "node server.mjs"), "unknown");
  assert.equal(detectFramework(undefined, ""), "unknown");
});

test("bootstrap dev-script re-scan refreshes the process record with a stable id", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-devscan-"));
  const project = { id: "proj-devscan", name: "devscan", path: dir };

  // Unreadable package.json: a distinct note, not a silent "no script".
  let res = await refreshDevProcess(project);
  assert.equal(res.proc, null);
  assert.equal(res.changed, true);
  assert.match(project.devScriptNote, /could not be read or parsed/);

  // Readable but no scripts.dev: no record, and the note clears.
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", scripts: {} }));
  res = await refreshDevProcess(project);
  assert.equal(res.proc, null);
  assert.equal(project.devScriptNote, undefined);

  // scripts.dev appears: the record is created on the rescan.
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "x", scripts: { dev: "vite dev" } }),
  );
  res = await refreshDevProcess(project);
  assert.equal(res.proc.command, "npm run dev");
  assert.equal(res.changed, true);
  const procId = res.proc.id;

  // The package manager changes: same id, refreshed command.
  writeFileSync(path.join(dir, "yarn.lock"), "");
  res = await refreshDevProcess(project);
  assert.equal(res.proc.id, procId);
  assert.equal(res.proc.command, "yarn run dev");
  assert.equal(res.changed, true);

  // Malformed: the record keeps its id, the note is recorded — and an
  // unchanged note does not churn state on every poll.
  writeFileSync(path.join(dir, "package.json"), "{ not json");
  res = await refreshDevProcess(project);
  assert.equal(res.proc.id, procId);
  assert.match(project.devScriptNote, /could not be read or parsed/);
  res = await refreshDevProcess(project);
  assert.equal(res.changed, false);

  // Removing scripts.dev retires the stopped record.
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", scripts: {} }));
  res = await refreshDevProcess(project);
  assert.equal(res.proc, null);
  assert.equal(project.devScriptNote, undefined);

  rmSync(dir, { recursive: true, force: true });
});

test("failureKind reflects only the current turn: cleared by success and generic failures", () => {
  const session = {
    messages: [{ id: "m0", role: "system", text: "rate limit reached", at: 1 }],
    logs: ["rate limit reached"],
  };
  // This turn's slice excludes the old rate-limit line (logStart/messageStart
  // are recorded when the turn starts).
  session.messages.push({ id: "m1", role: "user", text: "try again", at: 2 });
  session.logs.push("Context manifest: ...", "Error: something broke");

  const failed = classifyTurnFailure(session, 1, 1, 1);
  assert.equal(failed.kind, "process");
  assert.equal(session.failureKind, undefined);

  // Quota wording inside THIS turn's output is still classified and kept.
  session.logs.push("You've hit your usage limit.");
  const quota = classifyTurnFailure(session, 1, 1, 1);
  assert.equal(quota.kind, "provider_quota");
  assert.equal(session.failureKind, "provider_quota");

  // A successful turn clears it, and later turns cannot resurrect it.
  const ok = classifyTurnFailure(session, 0, session.logs.length, session.messages.length);
  assert.equal(ok.kind, undefined);
  assert.equal(session.failureKind, undefined);
  const later = classifyTurnFailure(session, 1, session.logs.length, session.messages.length);
  assert.equal(later.kind, "process");
  assert.equal(session.failureKind, undefined);

  // A later turn that quota-classifies re-arms the diagnosis…
  session.logs.push("You've hit your usage limit.");
  const rearm = classifyTurnFailure(session, 1, session.logs.length - 1, session.messages.length);
  assert.equal(rearm.kind, "provider_quota");
  assert.equal(session.failureKind, "provider_quota");

  // …and a subsequent GENERIC failure must clear it again: failureKind
  // always describes the current turn, never a stale one.
  session.logs.push("Error: socket hang up");
  const generic = classifyTurnFailure(session, 1, session.logs.length - 1, session.messages.length);
  assert.equal(generic.kind, "process");
  assert.equal(session.failureKind, undefined);
});

test("run-checks refuses unless the session is ready", async () => {
  const done = await call("/api/sessions/s-done/checks", {});
  assert.equal(done.status, 409);
  assert.match(done.json.error, /ready to review/);
  assert.match(done.json.error, /"complete"/);

  const stopped = await call("/api/sessions/s-stopped/checks", {});
  assert.equal(stopped.status, 409);
  assert.match(stopped.json.error, /"stopped"/);
});

test("checksFor returns one clear skip when package.json is missing", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-nopf-"));
  writeFileSync(path.join(dir, "app.py"), "import streamlit as st\n");
  writeFileSync(path.join(dir, "requirements.txt"), "streamlit\n");
  const checks = await checksFor({ id: "p-py", path: dir });
  assert.equal(checks.length, 1);
  assert.equal(checks[0].name, "Project checks");
  assert.equal(checks[0].status, "skipped");
  assert.match(checks[0].detail, /No package\.json/);
  assert.match(checks[0].detail, /Python/);
  assert.doesNotMatch(checks[0].detail, /ENOENT/);
  rmSync(dir, { recursive: true, force: true });
});

test("executeChecks claims verifying before its first await and honors a stop during it", async () => {
  // Register a throwaway project with no scripts, so no check ever spawns.
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-checks-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", scripts: {} }));
  const created = await call("/api/projects", { path: dir });
  assert.equal(created.status, 201);

  const initialChecks = [{ name: "Project checks", status: "not_run", detail: "Not run yet." }];
  const session = {
    id: "s-exec-race",
    projectId: created.json.project.id,
    status: "ready",
    messages: [],
    logs: [],
    checks: initialChecks,
    queuedMessages: [],
  };

  // executeChecks runs synchronously up to its first await (checksFor);
  // simulate /stop landing exactly during that yield.
  const running = executeChecks(session);
  assert.equal(session.status, "verifying"); // claimed before the first await
  session.status = "stopped"; // what /stop does mid-yield
  session.checksCancelled = true;
  await running;

  // The loop must not overwrite the stop with verifying/ready, nor replace
  // the existing checks list.
  assert.equal(session.status, "stopped");
  assert.deepEqual(session.checks, initialChecks);
  rmSync(dir, { recursive: true, force: true });
});

test("refresh normalizes stale launch args while the record is not running", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-args-"));
  const project = { id: "proj-argsnorm", name: "argsnorm", path: dir };
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "x", scripts: { dev: "vite dev" } }),
  );

  let res = await refreshDevProcess(project);
  const proc = res.proc;
  assert.deepEqual(proc.args, ["run", "dev"]);

  // Args persisted by the old start route while stopped: re-derived on rescan.
  proc.args = ["run", "dev", "--", "--host", "127.0.0.1", "--port", "3000"];
  res = await refreshDevProcess(project);
  assert.deepEqual(proc.args, ["run", "dev"]);
  assert.equal(res.changed, true);

  // A running record keeps the args its live child was launched with.
  proc.status = "running";
  proc.args = ["run", "dev", "--", "3000"];
  res = await refreshDevProcess(project);
  assert.deepEqual(proc.args, ["run", "dev", "--", "3000"]);
  assert.equal(res.changed, false);

  // Once it is not running again, the next rescan re-derives them.
  proc.status = "stopped";
  res = await refreshDevProcess(project);
  assert.deepEqual(proc.args, ["run", "dev"]);
  assert.equal(res.changed, true);
  rmSync(dir, { recursive: true, force: true });
});

test("project dev control: 404 guidance, inline re-scan on start, 409 while running, idempotent stop", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-devctl-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x" }));
  const reg = await call("/api/projects", { path: dir });
  assert.equal(reg.status, 201);
  const pid = reg.json.project.id;

  try {
    // No dev script even after the inline re-scan -> 404 with instructions
    // (and nothing is spawned).
    const miss = await call(`/api/projects/${pid}/dev/start`, {});
    assert.equal(miss.status, 404);
    assert.match(miss.json.error, /No dev script/);
    assert.match(miss.json.guidance, /nohup/);
    assert.match(miss.json.guidance, /tell the user/);

    // Status before any record exists.
    const st0 = await call(`/api/projects/${pid}/dev`);
    assert.equal(st0.status, 200);
    assert.equal(st0.json.found, false);

    // Mid-turn scaffold: scripts.dev + a tiny server appear. Start must
    // detect them INLINE — a route without the re-scan would still 404.
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "x", scripts: { dev: "node server.js" } }),
    );
    writeFileSync(
      path.join(dir, "server.js"),
      "require('node:http').createServer((q, s) => s.end('ok')).listen(Number(process.env.PORT) || 0);\n",
    );
    const up = await call(`/api/projects/${pid}/dev/start`, {});
    assert.equal(up.status, 200);
    assert.equal(up.json.status, "running");
    assert.ok(up.json.port > 0, "port is only reported after a real listen");
    assert.equal(up.json.command, "npm run dev");

    // Double start -> 409 carrying the current record.
    const again = await call(`/api/projects/${pid}/dev/start`, {});
    assert.equal(again.status, 409);
    assert.equal(again.json.status, "running");
    assert.ok(again.json.port > 0);

    // Status: found, running, bounded output tail (no full dump).
    const st = await call(`/api/projects/${pid}/dev`);
    assert.equal(st.json.found, true);
    assert.equal(st.json.status, "running");
    assert.equal(st.json.port, up.json.port);
    assert.ok(Array.isArray(st.json.outputTail) && st.json.outputTail.length <= 5);
    const stop1 = await call(`/api/projects/${pid}/dev/stop`, {});
    assert.equal(stop1.status, 200);
    assert.equal(stop1.json.status, "stopped");
    assert.equal(stop1.json.port, 0);
    // Idempotent: stopping an already-stopped record is still a 200 no-op.
    const stop2 = await call(`/api/projects/${pid}/dev/stop`, {});
    assert.equal(stop2.status, 200);
    assert.equal(stop2.json.status, "stopped");
  } finally {
    await call(`/api/projects/${pid}/dev/stop`, {}).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dev stop returns 404 without a process record", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-stop-missing-"));
  try {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x" }));
    const project = await call("/api/projects", { path: dir });
    const stopped = await call(`/api/projects/${project.json.project.id}/dev/stop`, {});
    assert.equal(stopped.status, 404);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("project and legacy start routes share a synchronous claim", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-start-race-"));
  let projectId;
  try {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "x", scripts: { dev: "node server.js" } }),
    );
    writeFileSync(
      path.join(dir, "server.js"),
      "require('node:http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.PORT));\n",
    );
    const registered = await call("/api/projects", { path: dir });
    projectId = registered.json.project.id;
    const procId = registered.json.process.id;
    const both = await Promise.all([
      call(`/api/projects/${projectId}/dev/start`, {}),
      call(`/api/processes/${procId}/start`, {}),
      call(`/api/projects/${projectId}/dev/start`, {}),
    ]);
    const scoped = both[0];
    assert.equal(scoped.status, 200);
    assert.equal(scoped.json.status, "running");
    const status = await call(`/api/projects/${projectId}/dev`);
    assert.equal(status.json.port, scoped.json.port);
    // Both competing endpoints report the claimed start as starting, rather
    // than returning the stale stopped state before the child is spawned.
    assert.equal(both[1].status, 200);
    assert.equal(both[1].json.status, "starting");
    assert.equal(both[2].status, 409);
    assert.equal(both[2].json.status, "starting");
    const state = await call(`/api/projects/${projectId}/dev`);
    assert.equal(state.json.status, "running");
    const stopped = await call(`/api/projects/${projectId}/dev/stop`, {});
    assert.equal(stopped.status, 200);
    assert.equal((await call(`/api/projects/${projectId}/dev`)).json.status, "stopped");
  } finally {
    if (projectId) await call(`/api/projects/${projectId}/dev/stop`, {}).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dev stop during starting kills the child and missing records are 404", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-stop-starting-"));
  let projectId;
  try {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "x", scripts: { dev: "node server.js" } }),
    );
    writeFileSync(
      path.join(dir, "server.js"),
      "setTimeout(()=>require('node:http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.PORT)), 3000);\n",
    );
    const registered = await call("/api/projects", { path: dir });
    projectId = registered.json.project.id;
    const starting = call(`/api/projects/${projectId}/dev/start`, {});
    let current;
    for (let i = 0; i < 100; i += 1) {
      current = await call(`/api/projects/${projectId}/dev`);
      if (current.json.status === "starting") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(current.json.status, "starting");
    const stopped = await call(`/api/projects/${projectId}/dev/stop`, {});
    assert.equal(stopped.status, 200);
    assert.equal(stopped.json.status, "stopped");
    await starting;
  } finally {
    if (projectId) await call(`/api/projects/${projectId}/dev/stop`, {}).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

test("manifest gives every agent its computer: tools, real ADE URL, and verify-visually rules", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-computer-mf-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x" }));
  // Any loopback request records the serving Host; this call also registers
  // the fixture project.
  const reg = await call("/api/projects", { path: dir });
  assert.equal(reg.status, 201);
  const project = reg.json.project;

  const manifest = await buildManifest({ request: "scaffold a thing", agentId: "codex" }, project);
  assert.equal(manifest.devControl, undefined);
  assert.equal(manifest.agentComputer.available, true);
  assert.equal(manifest.agentComputer.screen, "1280x800");
  for (const tool of ["computer_screenshot", "computer_open_url", "dev_server_start"])
    assert.ok(manifest.agentComputer.tools.includes(tool), `manifest lists ${tool}`);
  const ctx = computerContext(project);
  assert.deepEqual(ctx.env, { ADE_API: "http://127.0.0.1:3000", ADE_PROJECT_ID: project.id });
  assert.ok(ctx.mcpScript.endsWith(path.join("src", "local", "computer-mcp.mjs")));
  assert.ok(ctx.piExtension.endsWith(path.join("src", "local", "computer-pi-extension.mjs")));

  // Dev servers belong to ADE (via the tools); detached servers stay forbidden,
  // and visible changes must be checked on the computer before "done".
  const dev = manifest.constraints.find((c) => c.includes("dev_server_start"));
  assert.ok(dev && dev.includes("never start a server yourself"));
  assert.ok(manifest.constraints.some((c) => c.includes("verify it on your agent computer")));

  // Pi gets the same computer (as a Pi extension), not a "use the UI" fallback.
  const piManifest = await buildManifest({ request: "preview it", agentId: "pi" }, project);
  assert.equal(piManifest.agentComputer.available, true);
  assert.match(piManifest.otherServices, /does not verify/);
  assert.ok(
    piManifest.constraints.some((c) =>
      c.includes("instead of asking the user which frontend port"),
    ),
  );
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "x", scripts: { dev: "vite", "dev:backend": "backend dev" } }),
  );
  const serviceManifest = await buildManifest({ request: "preview it", agentId: "pi" }, project);
  assert.match(serviceManifest.otherServices, /dev:backend/);
  assert.match(serviceManifest.otherServices, /does not verify whether these services are running/);
  rmSync(dir, { recursive: true, force: true });
});
