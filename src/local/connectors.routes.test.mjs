import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
// The route reads only its own temp data folder, but keep HOME off the real one anyway.
const home = mkdtempSync(path.join(os.tmpdir(), "ade-connectors-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
const { connectors } = await import("./routes/connectors.mjs");

function call(dataDir, method, parts, payload, extra = {}) {
  const responses = [];
  const ctx = {
    req: {
      method,
      url: `/api/${parts.join("/")}`,
      headers: {},
      ...(payload === undefined
        ? {}
        : {
            [Symbol.asyncIterator]: async function* () {
              yield Buffer.from(JSON.stringify(payload));
            },
          }),
    },
    res: {},
    parts,
    DATA_DIR: dataDir,
    state: { projects: [{ id: "p1" }, { id: "p2" }] },
    json: (_res, status, value) => {
      responses.push([status, value]);
      return true;
    },
    ...extra,
  };
  return connectors(ctx).then((handled) => ({
    handled,
    status: responses[0]?.[0],
    body: responses[0]?.[1],
  }));
}

test("CRUD over /api/connectors never returns a secret", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-connectors-routes-"));
  const everything = [];
  try {
    const empty = await call(dir, "GET", ["connectors"]);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.connectors, []);
    assert.deepEqual(
      empty.body.presets.map((p) => p.id),
      ["parallel", "exa", "firecrawl"],
    );
    assert.equal(empty.body.presets[1].keyHeader, "x-api-key");

    const added = await call(dir, "POST", ["connectors"], {
      preset: "exa",
      apiKey: "sk-route-secret",
      projects: ["p1"],
    });
    everything.push(added);
    assert.equal(added.status, 201);
    const id = added.body.connector.id;
    assert.equal(added.body.connector.keySet, true);
    assert.deepEqual(added.body.connector.projects, ["p1"]);

    const custom = await call(dir, "POST", ["connectors"], {
      label: "Local",
      transport: "stdio",
      command: "node",
      args: ["x.js"],
      env: { TOKEN: "env-route-secret" },
    });
    everything.push(custom);
    assert.deepEqual(custom.body.connector.env, [{ name: "TOKEN", set: true }]);

    const bad = await call(dir, "POST", ["connectors"], { preset: "exa", projects: ["ghost"] });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /no longer exists/);

    const patched = await call(dir, "PATCH", ["connectors", id], { enabled: false, apiKey: null });
    everything.push(patched);
    assert.equal(patched.body.connector.enabled, false);
    assert.equal(patched.body.connector.keySet, false);
    assert.equal((await call(dir, "PATCH", ["connectors", "nope"], {})).status, 404);

    everything.push(await call(dir, "GET", ["connectors"]));
    assert.equal(JSON.stringify(everything).includes("route-secret"), false);

    const stdioTest = await call(dir, "POST", ["connectors", custom.body.connector.id, "test"]);
    assert.equal(stdioTest.status, 400);
    assert.equal(stdioTest.body.error, "Testing runs only for remote connectors.");

    assert.deepEqual((await call(dir, "DELETE", ["connectors", id])).body, { ok: true });
    assert.equal((await call(dir, "DELETE", ["connectors", id])).status, 404);
    assert.equal((await call(dir, "GET", ["skills"])).handled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function stub(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/mcp` }),
    );
  });
}
const readJson = async (req) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
};

test("POST /test runs initialize, initialized and tools/list against a stub MCP server", async () => {
  const seen = [];
  const { server, url } = await stub(async (req, res) => {
    const message = await readJson(req);
    seen.push({
      method: message.method,
      auth: req.headers["x-api-key"],
      session: req.headers["mcp-session-id"],
    });
    if (message.method === "initialize") {
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "sess-1" });
      return res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { protocolVersion: "2025-06-18" },
        }),
      );
    }
    if (message.method === "notifications/initialized") {
      res.writeHead(202);
      return res.end();
    }
    // tools/list answers as an SSE stream
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "search" }, { name: "fetch" }] } })}\n\n`,
    );
    res.end();
  });
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-connectors-routes-"));
  try {
    const added = await call(dir, "POST", ["connectors"], {
      label: "Stub",
      transport: "http",
      url,
      headers: { "x-api-key": "stub-secret" },
    });
    const result = await call(dir, "POST", ["connectors", added.body.connector.id, "test"]);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, tools: ["search", "fetch"] });
    assert.deepEqual(
      seen.map((s) => s.method),
      ["initialize", "notifications/initialized", "tools/list"],
    );
    assert.ok(seen.every((s) => s.auth === "stub-secret"));
    assert.equal(seen[2].session, "sess-1");
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /test reports the real reason for a 401 and never echoes the key", async () => {
  const { server, url } = await stub((req, res) => {
    res.writeHead(401, { "content-type": "text/plain" });
    res.end("denied for stub-secret");
  });
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-connectors-routes-"));
  try {
    const added = await call(dir, "POST", ["connectors"], {
      label: "Stub",
      transport: "http",
      url,
      headers: { Authorization: "Bearer stub-secret" },
    });
    const result = await call(dir, "POST", ["connectors", added.body.connector.id, "test"]);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: false, error: "HTTP 401 Unauthorized" });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /test reports an unreachable server without throwing", async () => {
  const { server, url } = await stub(() => {});
  await new Promise((resolve) => server.close(resolve));
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-connectors-routes-"));
  try {
    const added = await call(dir, "POST", ["connectors"], {
      label: "Down",
      transport: "http",
      url,
    });
    const result = await call(dir, "POST", ["connectors", added.body.connector.id, "test"]);
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, false);
    assert.ok(result.body.error.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
