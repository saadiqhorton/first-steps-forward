// Drives ade-local's handle(req, res) the way node:http does, with a chosen
// peer address: over a real socket a test could only ever be a loopback peer.
// server.test.mjs covers the real listener end to end.
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

/**
 * @param {(req: any, res: any) => Promise<void>} handle ade-local's handle
 * @param {{
 *   url: string,
 *   method?: string,
 *   headers?: Record<string, string>,
 *   body?: unknown,
 *   remoteAddress?: string | null,
 * }} request `url` is absolute; its authority is the Host header unless
 *   `headers.host` says otherwise. A string body is sent as is, an iterable of
 *   chunks is streamed, and anything else defined is sent as JSON. A null
 *   `remoteAddress` is a request whose socket has no address.
 * @returns {Promise<Response>}
 */
export async function callApi(handle, request) {
  const { url, headers = {}, body, remoteAddress = "127.0.0.1" } = request;
  const method = request.method ?? (body === undefined ? "GET" : "POST");
  const target = new URL(url);
  const chunks =
    body === undefined
      ? []
      : typeof body === "string"
        ? [body]
        : typeof body === "object" && body !== null && Symbol.asyncIterator in body
          ? body
          : [JSON.stringify(body)];
  const req = Object.assign(Readable.from(chunks), {
    method,
    url: `${target.pathname}${target.search}`,
    headers: Object.fromEntries(
      Object.entries({ host: target.host, ...headers }).map(([k, v]) => [k.toLowerCase(), v]),
    ),
    socket: { remoteAddress: remoteAddress ?? undefined },
  });
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    /** @type {Record<string, string | string[]>} */
    headers: {},
    body: /** @type {string | Buffer} */ (""),
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
    end(value) {
      this.body = value ?? "";
      this.headersSent = this.writableEnded = true;
      this.emit("finish");
      this.emit("close");
    },
  });
  await handle(req, res);
  const out = new Headers();
  for (const [name, value] of Object.entries(res.headers))
    for (const item of [value].flat()) out.append(name, String(item));
  const empty = [204, 304].includes(res.statusCode);
  return new Response(empty ? null : res.body, { status: res.statusCode, headers: out });
}
