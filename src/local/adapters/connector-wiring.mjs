// @ts-check
// How each agent receives a turn's connectors (MCP servers the user added).
// `connectors` are full connectors from ../connectors.mjs, secrets included.
// Rules: no secret ever appears in argv. ACP and OpenCode carry them in the
// protocol message / config env; Codex and Pi get every secret as its own
// environment variable that their config only references by name.

/** @typedef {import("../connectors.mjs").Connector} Connector */

const envKey = (name) => name.toUpperCase().replace(/[^A-Z0-9]/g, "_");

/** The env var that carries one secret of a connector, e.g. ADE_MCP_EXA_0. */
export const secretVar = (connector, index) => `ADE_MCP_${envKey(connector.name)}_${index}`;

/** ACP `mcpServers` entries. */
export function acpConnectorServers(connectors = []) {
  return connectors.map((connector) =>
    connector.transport === "http"
      ? {
          type: "http",
          name: connector.name,
          url: connector.url,
          headers: Object.entries(connector.headers ?? {}).map(([name, value]) => ({
            name,
            value,
          })),
        }
      : {
          name: connector.name,
          command: connector.command,
          args: connector.args ?? [],
          env: Object.entries(connector.env ?? {}).map(([name, value]) => ({ name, value })),
        },
  );
}

/**
 * Codex `-c` overrides plus the spawn env that holds the secrets.
 * http: `env_http_headers` maps header name → env var name.
 * stdio: `env_vars` forwards the listed variables from Codex's own env.
 * @returns {{ args: string[], env: Record<string, string> }}
 */
export function codexConnectorWiring(connectors = []) {
  /** @type {string[]} */
  const args = [];
  /** @type {Record<string, string>} */
  const env = {};
  for (const connector of connectors) {
    const server = `mcp_servers.${connector.name}`;
    const set = (key, value) => args.push("-c", `${server}.${key}=${value}`);
    if (connector.transport === "http") {
      set("url", JSON.stringify(connector.url));
      const headers = Object.entries(connector.headers ?? {});
      if (headers.length) {
        const map = headers.map(([header], index) => {
          const variable = secretVar(connector, index);
          env[variable] = connector.headers?.[header] ?? "";
          return `${JSON.stringify(header)}=${JSON.stringify(variable)}`;
        });
        set("env_http_headers", `{${map.join(",")}}`);
      }
    } else {
      set("command", JSON.stringify(connector.command));
      set("args", JSON.stringify(connector.args ?? []));
      const names = Object.keys(connector.env ?? {});
      if (names.length) {
        for (const name of names) env[name] = connector.env?.[name] ?? "";
        set("env_vars", JSON.stringify(names));
      }
    }
    // `codex exec` cannot ask, and its approval policy denies MCP tools whose
    // server is not pre-approved. The user added this connector on purpose.
    set("default_tools_approval_mode", '"approve"');
    set("startup_timeout_sec", "30");
    set("tool_timeout_sec", "300");
  }
  return { args, env };
}

/** OpenCode `mcp` config entries by server name. */
export function opencodeConnectorServers(connectors = []) {
  return Object.fromEntries(
    connectors.map((connector) => [
      connector.name,
      connector.transport === "http"
        ? {
            type: "remote",
            url: connector.url,
            ...(Object.keys(connector.headers ?? {}).length ? { headers: connector.headers } : {}),
            enabled: true,
          }
        : {
            type: "local",
            command: [connector.command, ...(connector.args ?? [])],
            ...(Object.keys(connector.env ?? {}).length ? { environment: connector.env } : {}),
            enabled: true,
          },
    ]),
  );
}

/**
 * Pi: the list the extension registers (references only) and the env that
 * carries it and every secret. Pi expands `${NAME}` in header and env values.
 * @returns {{ env: Record<string, string>, servers: object[] }}
 */
export function piConnectorWiring(connectors = []) {
  /** @type {Record<string, string>} */
  const env = {};
  const servers = connectors.map((connector) => {
    /** @param {Record<string, string> | undefined} values */
    const refs = (values) =>
      Object.fromEntries(
        Object.entries(values ?? {}).map(([name, value], index) => {
          const variable = secretVar(connector, index);
          env[variable] = value;
          return [name, `\${${variable}}`];
        }),
      );
    return connector.transport === "http"
      ? { name: connector.name, url: connector.url, headers: refs(connector.headers) }
      : {
          name: connector.name,
          command: connector.command,
          args: connector.args ?? [],
          env: refs(connector.env),
        };
  });
  if (servers.length) env.ADE_CONNECTORS = JSON.stringify(servers);
  return { env, servers };
}

/** Drops http servers an ACP agent cannot reach; returns what to keep and what was skipped. */
export function splitAcpServers(mcpServers = [], capabilities = {}) {
  const canHttp = capabilities?.mcpCapabilities?.http === true;
  const kept = mcpServers.filter((server) => server?.type !== "http" || canHttp);
  const skipped = mcpServers.filter((server) => server?.type === "http" && !canHttp);
  return { kept, skipped: skipped.map((server) => server.name) };
}
