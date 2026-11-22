// @ts-check
// Connectors: MCP servers the user lets Luna and/or projects' agents use.
// Stored in <dataDir>/connectors.json (0600). Secrets (header values, env
// values) live only here and in the spawned agent's environment; the public
// view (`publicConnector`) and every error text omit them.
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { STATUS_CODES } from "node:http";
import path from "node:path";

/**
 * @typedef {object} Connector
 * @property {string} id
 * @property {string} name MCP server name agents see
 * @property {string} label
 * @property {"parallel" | "exa" | "firecrawl"} [preset]
 * @property {"http" | "stdio"} transport
 * @property {string} [url]
 * @property {Record<string, string>} [headers]
 * @property {string} [command]
 * @property {string[]} [args]
 * @property {Record<string, string>} [env]
 * @property {boolean} enabled
 * @property {boolean} luna
 * @property {"all" | string[]} projects
 * @property {number} createdAt
 * @property {number} updatedAt
 */

export const PRESETS = [
  {
    id: "parallel",
    label: "Parallel",
    description: "Web search, page fetch and deep research from Parallel.",
    url: "https://mcp.parallel.ai/mcp",
    keyHeader: "Authorization",
    keyPrefix: "Bearer ",
    keyOptional: true,
    keyUrl: "https://platform.parallel.ai",
  },
  {
    id: "exa",
    label: "Exa",
    description: "Exa web search and page fetch.",
    url: "https://mcp.exa.ai/mcp",
    keyHeader: "x-api-key",
    keyPrefix: "",
    keyOptional: true,
    keyUrl: "https://dashboard.exa.ai/api-keys",
  },
  {
    id: "firecrawl",
    label: "Firecrawl",
    description: "Scrape, search, map and crawl the web with Firecrawl.",
    url: "https://mcp.firecrawl.dev/v2/mcp",
    keyHeader: "Authorization",
    keyPrefix: "Bearer ",
    keyOptional: true,
    keyUrl: "https://www.firecrawl.dev/app/api-keys",
  },
];

/** The preset as the API serves it (no prefix detail). */
export const publicPreset = ({ id, label, description, url, keyHeader, keyOptional, keyUrl }) => ({
  id,
  label,
  description,
  url,
  keyHeader,
  keyOptional,
  keyUrl,
});

const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
// A Codex stdio server gets its env through Codex's own environment, so these
// must never be overridden by a connector.
const RESERVED_ENV = /^(ADE_|CODEX_|LD_|DYLD_)|^(PATH|HOME|USERPROFILE|SHELL|NODE_OPTIONS)$/;
const MAX_ENTRIES = 30;

export class ConnectorError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

/** @param {string} text @param {string} [prefix] */
export function deriveName(text, prefix = "mcp_") {
  let name = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(name)) name = `${prefix}${name}`.replace(/_+$/, "");
  if (name.startsWith("ade_")) name = `${prefix}${name}`;
  return name.slice(0, 40).replace(/_+$/, "") || "mcp";
}

function uniqueName(base, taken) {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, 40 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function checkName(name, taken) {
  if (typeof name !== "string" || !NAME.test(name))
    throw new ConnectorError(
      "The server name must start with a lowercase letter and use only lowercase letters, numbers and underscores (40 characters at most).",
    );
  if (name.startsWith("ade_"))
    throw new ConnectorError('Server names starting with "ade_" are reserved for ADE.');
  if (taken.has(name)) throw new ConnectorError(`A connector named "${name}" already exists.`);
  return name;
}

function checkLabel(label) {
  const text = typeof label === "string" ? label.trim() : "";
  if (!text || text.length > 60)
    throw new ConnectorError("Give the connector a name of 1 to 60 characters.");
  return text;
}

function checkUrl(value) {
  let url;
  try {
    url = new URL(typeof value === "string" ? value.trim() : "");
  } catch {
    throw new ConnectorError("Enter a full URL, like https://example.com/mcp.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    throw new ConnectorError("The URL must start with https:// (http:// works only on localhost).");
  if (url.username || url.password)
    throw new ConnectorError("Put keys in a header, not in the URL.");
  return url.toString();
}

function checkHeaderValue(value) {
  if (typeof value !== "string" || /[\r\n\0]/.test(value) || value.length > 4000)
    throw new ConnectorError("A header value cannot contain line breaks.");
  return value;
}

/** @returns {"all" | string[]} */
function checkScope(projects, projectIds) {
  if (projects === "all") return "all";
  if (!Array.isArray(projects) || projects.some((id) => typeof id !== "string"))
    throw new ConnectorError('Projects must be "all" or a list of project ids.');
  const unique = [...new Set(projects)];
  if (projectIds) {
    const unknown = unique.find((id) => !projectIds.includes(id));
    if (unknown) throw new ConnectorError("One of the chosen projects no longer exists.");
  }
  return unique;
}

/**
 * Apply a secret map patch: non-empty string sets, "" keeps, null removes.
 * @param {Record<string, string> | undefined} current
 * @param {unknown} patch
 * @param {{ nameRule: RegExp, nameMessage: string, caseless: boolean, checkValue: (v: unknown) => string, reserved?: RegExp }} rules
 */
function mergeSecrets(current, patch, rules) {
  if (!isObject(patch)) throw new ConnectorError("Expected a list of names and values.");
  const next = { ...(current ?? {}) };
  const find = (name) =>
    Object.keys(next).find((key) =>
      rules.caseless ? key.toLowerCase() === name.toLowerCase() : key === name,
    );
  for (const [name, value] of Object.entries(/** @type {Record<string, unknown>} */ (patch))) {
    if (!rules.nameRule.test(name)) throw new ConnectorError(rules.nameMessage);
    if (rules.reserved?.test(name))
      throw new ConnectorError(`"${name}" is reserved and cannot be set.`);
    const existing = find(name);
    if (value === null) {
      if (existing) delete next[existing];
    } else if (value === "") {
      // keep what is stored
    } else {
      if (existing) delete next[existing];
      next[name] = rules.checkValue(value);
    }
  }
  if (Object.keys(next).length > MAX_ENTRIES) throw new ConnectorError("Too many entries.");
  return next;
}

const headerRules = {
  nameRule: HEADER_NAME,
  nameMessage: "Header names use letters, numbers and hyphens.",
  caseless: true,
  checkValue: checkHeaderValue,
};
const envRules = {
  nameRule: ENV_NAME,
  nameMessage: "Environment variable names use letters, numbers and underscores.",
  caseless: false,
  reserved: RESERVED_ENV,
  checkValue: (value) => {
    if (typeof value !== "string" || value.includes("\0") || value.length > 4000)
      throw new ConnectorError("An environment value is not valid.");
    return value;
  },
};

function checkCommand(command) {
  if (
    typeof command !== "string" ||
    !command.trim() ||
    command.length > 500 ||
    /[\0\r\n]/.test(command)
  )
    throw new ConnectorError("Enter the command to run.");
  return command.trim();
}
function checkArgs(args) {
  if (
    !Array.isArray(args) ||
    args.length > 100 ||
    args.some((arg) => typeof arg !== "string" || arg.length > 2000 || arg.includes("\0"))
  )
    throw new ConnectorError("Arguments must be a list of text values.");
  return args;
}

/** What the API may show: names of secrets, never values. */
export function publicConnector(connector) {
  const { headers, env, ...rest } = connector;
  const preset = PRESETS.find((item) => item.id === connector.preset);
  return {
    ...rest,
    ...(headers
      ? { headers: Object.keys(headers).map((name) => ({ name, set: !!headers[name] })) }
      : {}),
    ...(env ? { env: Object.keys(env).map((name) => ({ name, set: !!env[name] })) } : {}),
    ...(preset
      ? {
          keySet: Object.keys(headers ?? {}).some(
            (name) => name.toLowerCase() === preset.keyHeader.toLowerCase() && !!headers?.[name],
          ),
        }
      : {}),
  };
}

/** Does this connector apply to Luna / to a project? Disabled ones apply nowhere. */
export const appliesToLuna = (connector) => connector.enabled && connector.luna;
export const appliesToProject = (connector, projectId) =>
  connector.enabled && (connector.projects === "all" || connector.projects.includes(projectId));

/**
 * @param {{ dataDir: string, now?: () => number, id?: () => string }} options
 */
export function createConnectorStore({ dataDir, now = Date.now, id = randomUUID }) {
  const file = path.join(dataDir, "connectors.json");
  /** Writes run one at a time so concurrent edits never lose each other. */
  let queue = Promise.resolve();

  /** @returns {Promise<Connector[]>} */
  async function read() {
    let text;
    try {
      text = await fs.readFile(file, "utf8");
    } catch (/** @type {any} */ error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("connectors.json is not valid JSON; fix or remove it in ADE's data folder.");
    }
    return Array.isArray(data?.connectors) ? data.connectors : [];
  }

  async function write(connectors) {
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ version: 1, connectors }, null, 2), { mode: 0o600 });
    await fs.chmod(tmp, 0o600).catch(() => {});
    await fs.rename(tmp, file);
  }

  /** @template T @param {(connectors: Connector[]) => Promise<{ connectors?: Connector[], result: T }> | { connectors?: Connector[], result: T }} change */
  function mutate(change) {
    const run = queue.then(async () => {
      const connectors = await read();
      const outcome = await change(connectors);
      if (outcome.connectors) await write(outcome.connectors);
      return outcome.result;
    });
    queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  return {
    file,
    list: read,
    async listPublic() {
      return (await read()).map(publicConnector);
    },
    async get(connectorId) {
      return (await read()).find((item) => item.id === connectorId);
    },
    /** Full connectors (secrets included) for a Luna turn. */
    async forLuna() {
      return (await read()).filter(appliesToLuna);
    },
    /** Full connectors (secrets included) for a project turn. */
    async forProject(projectId) {
      return (await read()).filter((item) => appliesToProject(item, projectId));
    },
    /**
     * @param {Record<string, any>} input
     * @param {{ projectIds?: string[] }} [context]
     */
    create(input, { projectIds } = {}) {
      return mutate((connectors) => {
        if (!isObject(input)) throw new ConnectorError("Send the connector as a JSON object.");
        const taken = new Set(connectors.map((item) => item.name));
        const stamp = now();
        /** @type {Connector} */
        let connector;
        const common = {
          id: id(),
          enabled: true,
          luna: input.luna === undefined ? true : input.luna === true,
          projects: checkScope(input.projects === undefined ? "all" : input.projects, projectIds),
          createdAt: stamp,
          updatedAt: stamp,
        };
        if (input.luna !== undefined && typeof input.luna !== "boolean")
          throw new ConnectorError("luna must be true or false.");
        if (input.preset !== undefined) {
          const preset = PRESETS.find((item) => item.id === input.preset);
          if (!preset) throw new ConnectorError("That preset does not exist.");
          const name =
            input.name === undefined ? uniqueName(preset.id, taken) : checkName(input.name, taken);
          /** @type {Record<string, string>} */
          const headers = {};
          if (input.apiKey !== undefined && input.apiKey !== null && input.apiKey !== "") {
            if (typeof input.apiKey !== "string" || /[\r\n\0\s]/.test(input.apiKey.trim()))
              throw new ConnectorError("The API key is not valid.");
            headers[preset.keyHeader] = `${preset.keyPrefix}${input.apiKey.trim()}`;
          }
          connector = {
            ...common,
            name,
            label: preset.label,
            preset: /** @type {"parallel" | "exa" | "firecrawl"} */ (preset.id),
            transport: "http",
            url: input.url === undefined ? preset.url : checkUrl(input.url),
            headers,
          };
        } else {
          const label = checkLabel(input.label);
          const name =
            input.name === undefined || input.name === ""
              ? uniqueName(deriveName(label), taken)
              : checkName(input.name, taken);
          if (input.transport === "http") {
            connector = {
              ...common,
              name,
              label,
              transport: "http",
              url: checkUrl(input.url),
              headers:
                input.headers === undefined ? {} : mergeSecrets({}, input.headers, headerRules),
            };
          } else if (input.transport === "stdio") {
            connector = {
              ...common,
              name,
              label,
              transport: "stdio",
              command: checkCommand(input.command),
              args: input.args === undefined ? [] : checkArgs(input.args),
              env: input.env === undefined ? {} : mergeSecrets({}, input.env, envRules),
            };
          } else throw new ConnectorError("Choose a remote URL or a local command.");
        }
        // Empty-string secrets on create mean "nothing", so drop them.
        return { connectors: [...connectors, connector], result: connector };
      });
    },
    /**
     * @param {string} connectorId
     * @param {Record<string, any>} patch
     * @param {{ projectIds?: string[] }} [context]
     */
    update(connectorId, patch, { projectIds } = {}) {
      return mutate((connectors) => {
        const index = connectors.findIndex((item) => item.id === connectorId);
        if (index < 0) throw new ConnectorError("That connector does not exist.", 404);
        if (!isObject(patch)) throw new ConnectorError("Send the changes as a JSON object.");
        const current = connectors[index];
        const next = { ...current };
        for (const key of ["name", "transport", "preset"])
          if (patch[key] !== undefined && patch[key] !== current[key])
            throw new ConnectorError(`The ${key} cannot be changed.`);
        if (patch.label !== undefined) next.label = checkLabel(patch.label);
        for (const key of /** @type {const} */ (["enabled", "luna"])) {
          if (patch[key] === undefined) continue;
          if (typeof patch[key] !== "boolean")
            throw new ConnectorError(`${key} must be true or false.`);
          next[key] = patch[key];
        }
        if (patch.projects !== undefined) next.projects = checkScope(patch.projects, projectIds);
        const http = current.transport === "http";
        const remoteOnly = ["url", "headers", "apiKey"].filter((k) => patch[k] !== undefined);
        const localOnly = ["command", "args", "env"].filter((k) => patch[k] !== undefined);
        if (!http && remoteOnly.length)
          throw new ConnectorError("That setting applies only to remote connectors.");
        if (http && localOnly.length)
          throw new ConnectorError("That setting applies only to local connectors.");
        if (patch.url !== undefined) {
          next.url = checkUrl(patch.url);
        }
        if (patch.headers !== undefined)
          next.headers = mergeSecrets(next.headers, patch.headers, headerRules);
        if (patch.apiKey !== undefined) {
          const preset = PRESETS.find((item) => item.id === current.preset);
          if (!preset) throw new ConnectorError("Only preset connectors take an API key.");
          if (patch.apiKey === null) {
            next.headers = mergeSecrets(next.headers, { [preset.keyHeader]: null }, headerRules);
          } else if (typeof patch.apiKey !== "string")
            throw new ConnectorError("The API key is not valid.");
          else if (patch.apiKey.trim() !== "") {
            if (/[\r\n\0\s]/.test(patch.apiKey.trim()))
              throw new ConnectorError("The API key is not valid.");
            next.headers = mergeSecrets(
              next.headers,
              { [preset.keyHeader]: `${preset.keyPrefix}${patch.apiKey.trim()}` },
              headerRules,
            );
          }
        }
        if (patch.command !== undefined) next.command = checkCommand(patch.command);
        if (patch.args !== undefined) next.args = checkArgs(patch.args);
        if (patch.env !== undefined) next.env = mergeSecrets(next.env, patch.env, envRules);
        next.updatedAt = now();
        const updated = [...connectors];
        updated[index] = next;
        return { connectors: updated, result: next };
      });
    },
    remove(connectorId) {
      return mutate((connectors) => {
        if (!connectors.some((item) => item.id === connectorId))
          throw new ConnectorError("That connector does not exist.", 404);
        return {
          connectors: connectors.filter((item) => item.id !== connectorId),
          result: true,
        };
      });
    },
  };
}

const stores = new Map();
/** One store (and write queue) per data folder. */
export function connectorStore(dataDir) {
  if (!stores.has(dataDir)) stores.set(dataDir, createConnectorStore({ dataDir }));
  return stores.get(dataDir);
}

// ---- Connection test over Streamable HTTP -------------------------------------------------

const PROTOCOL_VERSION = "2025-06-18";

/** Reads the JSON-RPC message with `rpcId` from a JSON body or an SSE stream. */
async function readRpc(response, rpcId) {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream")) return pick(await response.json(), rpcId);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The server sent an empty reply.");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) continue;
        let message;
        try {
          message = JSON.parse(data);
        } catch {
          continue;
        }
        const found = pick(message, rpcId, true);
        if (found) return found;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  throw new Error("The server closed the stream without answering.");
}

function pick(message, rpcId, soft = false) {
  const items = Array.isArray(message) ? message : [message];
  const match = items.find((item) => item?.id === rpcId);
  if (!match) {
    if (soft) return null;
    throw new Error("The server's reply was not a valid MCP response.");
  }
  if (match.error) throw new Error(`Server error: ${match.error.message ?? "unknown"}`);
  return match.result ?? {};
}

/**
 * Connects to an http connector, lists its tools, and says what went wrong in plain words.
 * Header values are scrubbed from any error text.
 * @param {Connector} connector
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: true, tools: string[] } | { ok: false, error: string }>}
 */
export async function testConnector(connector, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const secrets = Object.values(connector.headers ?? {}).filter((value) => value.length > 3);
  const scrub = (text) => secrets.reduce((out, secret) => out.split(secret).join("***"), text);
  const signal = AbortSignal.timeout(timeoutMs);
  /** @type {Record<string, string>} */
  const baseHeaders = {
    ...(connector.headers ?? {}),
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  let session = "";
  let version = PROTOCOL_VERSION;
  async function post(message) {
    const response = await fetchImpl(/** @type {string} */ (connector.url), {
      method: "POST",
      headers: {
        ...baseHeaders,
        ...(session ? { "mcp-session-id": session } : {}),
        ...(session ? { "mcp-protocol-version": version } : {}),
      },
      body: JSON.stringify(message),
      signal,
      redirect: "error",
    });
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      throw new Error(
        `HTTP ${response.status} ${response.statusText || STATUS_CODES[response.status] || ""}`.trim(),
      );
    }
    const sid = response.headers.get("mcp-session-id");
    if (sid) session = sid;
    return response;
  }
  try {
    const init = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "ade", version: "1" },
      },
    });
    const initResult = await readRpc(init, 1);
    if (typeof initResult.protocolVersion === "string") version = initResult.protocolVersion;
    const ack = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    ack.body?.cancel().catch(() => {});
    const listed = await readRpc(
      await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      2,
    );
    const tools = (Array.isArray(listed.tools) ? listed.tools : [])
      .map((tool) => tool?.name)
      .filter((name) => typeof name === "string");
    return { ok: true, tools };
  } catch (/** @type {any} */ error) {
    const timedOut = signal.aborted;
    const message = timedOut
      ? `No answer within ${Math.round(timeoutMs / 1000)} seconds.`
      : error instanceof Error
        ? error.message
        : String(error);
    const cause = !timedOut && error?.cause?.code ? ` (${error.cause.code})` : "";
    return { ok: false, error: scrub(`${message}${cause}`).slice(0, 300) };
  }
}
