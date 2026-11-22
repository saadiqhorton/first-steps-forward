import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ConnectorError,
  appliesToLuna,
  appliesToProject,
  createConnectorStore,
  deriveName,
  publicConnector,
} from "./connectors.mjs";
import {
  acpConnectorServers,
  codexConnectorWiring,
  opencodeConnectorServers,
  piConnectorWiring,
  splitAcpServers,
} from "./adapters/connector-wiring.mjs";
import { opencodeComputerEnv } from "./adapters/computer-tools.mjs";
import { codex } from "./adapters/codex.agent.mjs";
import { connectorServers, registerConnectors } from "./computer-pi-extension.mjs";

function fresh() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ade-connectors-"));
  let n = 0;
  const store = createConnectorStore({ dataDir: dir, id: () => `id-${++n}`, now: () => 1000 + n });
  return { dir, store, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const rejects = (promise, pattern) =>
  assert.rejects(
    promise,
    (error) => error instanceof ConnectorError && pattern.test(error.message),
  );

test("the store writes connectors.json privately and the public view hides secrets", async () => {
  const { dir, store, done } = fresh();
  try {
    const created = await store.create({ preset: "exa", apiKey: "sk-secret-1" });
    assert.equal(created.name, "exa");
    assert.equal(created.headers["x-api-key"], "sk-secret-1");
    const file = path.join(dir, "connectors.json");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(dir).mode & 0o777, 0o700 & statSync(dir).mode);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).version, 1);
    const view = publicConnector(created);
    assert.equal(JSON.stringify(view).includes("sk-secret-1"), false);
    assert.deepEqual(view.headers, [{ name: "x-api-key", set: true }]);
    assert.equal(view.keySet, true);
    const parallel = await store.create({ preset: "parallel", apiKey: "pk-1" });
    assert.equal(parallel.headers.Authorization, "Bearer pk-1");
    const keyless = await store.create({ preset: "firecrawl" });
    assert.equal(publicConnector(keyless).keySet, false);
  } finally {
    done();
  }
});

test("a preset added twice gets a distinct name", async () => {
  const { store, done } = fresh();
  try {
    const first = await store.create({ preset: "exa", url: "https://exa-proxy.example.net/mcp" });
    assert.equal(first.name, "exa");
    assert.equal(first.url, "https://exa-proxy.example.net/mcp");
    await rejects(store.create({ preset: "exa", url: "file:///tmp/server" }), /URL/);
    assert.equal((await store.create({ preset: "exa" })).name, "exa_2");
    assert.equal((await store.create({ preset: "exa" })).name, "exa_3");
  } finally {
    done();
  }
});

test("names: derived, de-duplicated, reserved and duplicate ones are refused", async () => {
  assert.equal(deriveName("My Cool Tool!"), "my_cool_tool");
  assert.equal(deriveName("9 lives"), "mcp_9_lives");
  assert.equal(deriveName("ADE tools"), "mcp_ade_tools");
  const { store, done } = fresh();
  try {
    const base = { transport: "http", url: "https://example.com/mcp" };
    assert.equal((await store.create({ ...base, label: "Docs" })).name, "docs");
    assert.equal((await store.create({ ...base, label: "Docs" })).name, "docs_2");
    await rejects(store.create({ ...base, label: "X", name: "docs" }), /already exists/);
    await rejects(store.create({ ...base, label: "X", name: "ade_computer" }), /reserved/);
    await rejects(store.create({ ...base, label: "X", name: "ade_workspace" }), /reserved/);
    await rejects(store.create({ ...base, label: "X", name: "Bad-Name" }), /lowercase/);
  } finally {
    done();
  }
});

test("URLs must be https, or http on localhost, and carry no credentials", async () => {
  const { store, done } = fresh();
  try {
    const make = (url) => store.create({ label: "R", transport: "http", url });
    await rejects(make("http://example.com/mcp"), /https/);
    await rejects(make("ftp://example.com"), /https/);
    await rejects(make("not a url"), /full URL/);
    await rejects(make("https://user:pw@example.com/mcp"), /header/);
    assert.ok(await make("http://127.0.0.1:9000/mcp"));
    assert.ok(await make("http://localhost:9000/mcp"));
    assert.ok(await make("http://[::1]:9000/mcp"));
    assert.ok(await make("https://example.com/mcp"));
  } finally {
    done();
  }
});

test("header and env secrets: non-empty sets, empty keeps, null removes", async () => {
  const { store, done } = fresh();
  try {
    const remote = await store.create({
      label: "Remote",
      transport: "http",
      url: "https://example.com/mcp",
      headers: { "X-One": "one", "X-Two": "two" },
    });
    const kept = await store.update(remote.id, { headers: { "X-One": "", "x-two": "2b" } });
    assert.deepEqual(kept.headers, { "X-One": "one", "x-two": "2b" });
    const removed = await store.update(remote.id, { headers: { "X-One": null } });
    assert.deepEqual(removed.headers, { "x-two": "2b" });
    await rejects(store.update(remote.id, { headers: { "bad name": "v" } }), /Header names/);
    await rejects(store.update(remote.id, { headers: { A: "x\r\ny" } }), /line breaks/);

    const local = await store.create({
      label: "Local",
      transport: "stdio",
      command: "npx",
      args: ["-y", "tool"],
      env: { TOKEN: "t1", OTHER: "o1" },
    });
    const changed = await store.update(local.id, { env: { TOKEN: "", OTHER: null, NEW: "n" } });
    assert.deepEqual(changed.env, { TOKEN: "t1", NEW: "n" });
    await rejects(store.update(local.id, { env: { PATH: "/x" } }), /reserved/);
    await rejects(store.update(local.id, { url: "https://example.com" }), /remote/);
    await rejects(store.update(remote.id, { command: "ls" }), /local/);
  } finally {
    done();
  }
});

test("preset apiKey: set adds the prefixed header, null removes, empty keeps; identity is fixed", async () => {
  const { store, done } = fresh();
  try {
    const parallel = await store.create({ preset: "parallel" });
    const set = await store.update(parallel.id, { apiKey: "abc" });
    assert.equal(set.headers.Authorization, "Bearer abc");
    assert.equal(
      (await store.update(parallel.id, { apiKey: "" })).headers.Authorization,
      "Bearer abc",
    );
    assert.deepEqual((await store.update(parallel.id, { apiKey: null })).headers, {});
    await rejects(store.update(parallel.id, { name: "other" }), /name cannot/);
    await rejects(store.update(parallel.id, { transport: "stdio" }), /transport cannot/);
    const moved = await store.update(parallel.id, { url: "https://mcp.example.net/tools" });
    assert.equal(moved.url, "https://mcp.example.net/tools");
    await rejects(store.update(parallel.id, { url: "file:///tmp/server" }), /URL/);
    const custom = await store.create({
      label: "C",
      transport: "http",
      url: "https://example.com/mcp",
    });
    await rejects(store.update(custom.id, { apiKey: "k" }), /preset/);
    await assert.rejects(store.update("missing", {}), (e) => e.status === 404);
  } finally {
    done();
  }
});

test("scopes: unknown projects are refused and the luna/project filters follow enabled and scope", async () => {
  const { store, done } = fresh();
  try {
    const ctx = { projectIds: ["p1", "p2"] };
    await rejects(store.create({ preset: "exa", projects: ["nope"] }, ctx), /no longer exists/);
    await rejects(store.create({ preset: "exa", projects: "some" }, ctx), /all/);
    const all = await store.create({ preset: "exa" }, ctx);
    assert.equal(all.luna, true);
    assert.equal(all.projects, "all");
    const lunaOnly = await store.create({ preset: "parallel", luna: true, projects: [] }, ctx);
    const projOnly = await store.create(
      { preset: "firecrawl", luna: false, projects: ["p2"] },
      ctx,
    );
    assert.deepEqual(
      (await store.forLuna()).map((c) => c.name),
      ["exa", "parallel"],
    );
    assert.deepEqual(
      (await store.forProject("p1")).map((c) => c.name),
      ["exa"],
    );
    assert.deepEqual(
      (await store.forProject("p2")).map((c) => c.name),
      ["exa", "firecrawl"],
    );
    await store.update(all.id, { enabled: false });
    assert.deepEqual(
      (await store.forLuna()).map((c) => c.name),
      ["parallel"],
    );
    assert.deepEqual(
      (await store.forProject("p2")).map((c) => c.name),
      ["firecrawl"],
    );
    assert.equal(appliesToLuna(projOnly), false);
    assert.equal(appliesToProject(lunaOnly, "p1"), false);
    await rejects(store.update(projOnly.id, { projects: ["zz"] }, ctx), /no longer exists/);
    await store.remove(projOnly.id);
    assert.equal((await store.list()).length, 2);
  } finally {
    done();
  }
});

const http = (extra = {}) => ({
  id: "1",
  name: "exa",
  transport: "http",
  url: "https://mcp.exa.ai/mcp",
  headers: { "x-api-key": "sk-secret-1", Authorization: "Bearer tok-2" },
  enabled: true,
  luna: true,
  projects: "all",
  ...extra,
});
const stdio = () => ({
  id: "2",
  name: "local_tool",
  transport: "stdio",
  command: "npx",
  args: ["-y", "tool"],
  env: { TOOL_TOKEN: "env-secret-3" },
  enabled: true,
  luna: true,
  projects: "all",
});

test("ACP wiring: http and stdio servers, and http dropped without mcpCapabilities.http", () => {
  const servers = acpConnectorServers([http(), stdio()]);
  assert.deepEqual(servers[0], {
    type: "http",
    name: "exa",
    url: "https://mcp.exa.ai/mcp",
    headers: [
      { name: "x-api-key", value: "sk-secret-1" },
      { name: "Authorization", value: "Bearer tok-2" },
    ],
  });
  assert.deepEqual(servers[1], {
    name: "local_tool",
    command: "npx",
    args: ["-y", "tool"],
    env: [{ name: "TOOL_TOKEN", value: "env-secret-3" }],
  });
  assert.deepEqual(splitAcpServers(servers, {}).skipped, ["exa"]);
  assert.equal(splitAcpServers(servers, {}).kept.length, 1);
  assert.equal(splitAcpServers(servers, { mcpCapabilities: { http: true } }).kept.length, 2);
});

test("Codex wiring keeps every secret out of argv and puts it in the spawn env", () => {
  const { args, env } = codexConnectorWiring([http(), stdio()]);
  const text = args.join("\n");
  for (const secret of ["sk-secret-1", "tok-2", "env-secret-3"])
    assert.equal(text.includes(secret), false, `${secret} must not be in argv`);
  assert.ok(args.includes('mcp_servers.exa.url="https://mcp.exa.ai/mcp"'));
  assert.ok(
    args.includes(
      'mcp_servers.exa.env_http_headers={"x-api-key"="ADE_MCP_EXA_0","Authorization"="ADE_MCP_EXA_1"}',
    ),
  );
  assert.ok(args.includes('mcp_servers.local_tool.env_vars=["TOOL_TOKEN"]'));
  assert.ok(args.includes('mcp_servers.local_tool.args=["-y","tool"]'));
  assert.ok(args.includes("mcp_servers.exa.tool_timeout_sec=300"));
  assert.equal(env.ADE_MCP_EXA_0, "sk-secret-1");
  assert.equal(env.ADE_MCP_EXA_1, "Bearer tok-2");
  assert.equal(env.TOOL_TOKEN, "env-secret-3");
});

test("Codex command carries connectors on exec and resume, with secrets only in env", () => {
  const base = {
    projectPath: "/tmp/p",
    prompt: "go",
    session: { id: "s", agentSessionId: "thread-1" },
    connectors: [http()],
  };
  for (const continuing of [false, true]) {
    const [bin, args, env] = codex.command({ ...base, continuing });
    assert.equal(bin, "codex");
    assert.ok(args.some((a) => a.startsWith("mcp_servers.exa.url=")));
    assert.equal(args.join("\n").includes("sk-secret-1"), false);
    assert.equal(env.ADE_MCP_EXA_0, "sk-secret-1");
  }
  assert.equal(codex.command({ ...base, connectors: [], continuing: false })[2], undefined);
});

test("OpenCode wiring: remote and local servers, merged with the user's own config", () => {
  const mcp = opencodeConnectorServers([http(), stdio()]);
  assert.deepEqual(mcp.exa, {
    type: "remote",
    url: "https://mcp.exa.ai/mcp",
    headers: { "x-api-key": "sk-secret-1", Authorization: "Bearer tok-2" },
    enabled: true,
  });
  assert.deepEqual(mcp.local_tool, {
    type: "local",
    command: ["npx", "-y", "tool"],
    environment: { TOOL_TOKEN: "env-secret-3" },
    enabled: true,
  });
  assert.deepEqual(opencodeComputerEnv(null, undefined, undefined, []), {});
  const env = opencodeComputerEnv(
    null,
    JSON.stringify({ theme: "x", mcp: { mine: {} } }),
    undefined,
    [http()],
  );
  const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.theme, "x");
  assert.deepEqual(Object.keys(config.mcp).sort(), ["exa", "mine"]);
});

test("Pi wiring references secrets by name; the secrets live only in env", () => {
  const { env, servers } = piConnectorWiring([http(), stdio()]);
  assert.deepEqual(servers[0].headers, {
    "x-api-key": "${ADE_MCP_EXA_0}",
    Authorization: "${ADE_MCP_EXA_1}",
  });
  assert.deepEqual(servers[1].env, { TOOL_TOKEN: "${ADE_MCP_LOCAL_TOOL_0}" });
  assert.equal(env.ADE_MCP_EXA_0, "sk-secret-1");
  assert.equal(env.ADE_MCP_LOCAL_TOOL_0, "env-secret-3");
  const listing = env.ADE_CONNECTORS;
  for (const secret of ["sk-secret-1", "tok-2", "env-secret-3"])
    assert.equal(listing.includes(secret), false);
});

test("the Pi extension registers connectors with pi.registerMcpServer, secrets only as ${ENV} references", () => {
  const wiring = piConnectorWiring([http(), stdio()]);
  const registered = [];
  const pi = { registerMcpServer: (name, config) => registered.push([name, config]) };
  const names = registerConnectors(pi, connectorServers(wiring.env.ADE_CONNECTORS));
  assert.deepEqual(names, ["exa", "local_tool"]);
  assert.equal(registered[0][1].url, "https://mcp.exa.ai/mcp");
  assert.equal(registered[0][1].headers["x-api-key"], "${ADE_MCP_EXA_0}");
  assert.equal(registered[1][1].command, "npx");
  assert.equal(registered[1][1].env.TOOL_TOKEN, "${ADE_MCP_LOCAL_TOOL_0}");
  assert.equal(JSON.stringify(registered).includes("sk-secret-1"), false);
  assert.deepEqual(registerConnectors({}, [{ name: "x" }]), []);
  assert.deepEqual(connectorServers("not json"), []);
});
