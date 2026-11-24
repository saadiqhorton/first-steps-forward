/**
 * A small SSE fan-out. `emit` sends invalidations (payloads name the data to
 * refetch); `push` sends the data itself, for text that grows as it streams.
 */
export function createEventHub({
  heartbeatMs = 25_000,
  coalesceMs = 100,
  logsMs = 250,
  pushMs = 100,
} = {}) {
  const clients = new Set();
  const pending = new Map();
  const versions = new Map();
  const clientListeners = new Set();
  let heartbeat = null;

  const send = (client, event, data) => {
    if (client.res.destroyed || client.res.writableEnded) return;
    if (event === "computer" && client.project && data.scope !== `computer:${client.project}`)
      return;
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const ensureHeartbeat = () => {
    if (clients.size && !heartbeat) {
      heartbeat = setInterval(() => {
        for (const client of clients) {
          if (!client.res.destroyed && !client.res.writableEnded) client.res.write(": ping\n\n");
        }
      }, heartbeatMs);
      heartbeat.unref?.();
    } else if (!clients.size && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    for (const listener of clientListeners) listener(clients.size);
  };

  return {
    /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
    connect(req, res, project = "") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.flushHeaders?.();
      const client = { req, res, project };
      clients.add(client);
      // The client uses this to detect proxies that buffer the stream.
      res.write("event: ready\ndata: {}\n\n");
      ensureHeartbeat();
      const close = () => {
        clients.delete(client);
        req.off("aborted", close);
        res.off("close", close);
        ensureHeartbeat();
      };
      req.once("aborted", close);
      res.once("close", close);
      return close;
    },
    emit(scope) {
      if (typeof scope !== "string" || !scope) return;
      const previous = pending.get(scope);
      if (previous) return;
      const timer = setTimeout(
        () => {
          pending.delete(scope);
          const version = (versions.get(scope) ?? 0) + 1;
          versions.set(scope, version);
          const category = scope.split(":", 1)[0];
          const event =
            category === "computer" ? "computer" : category === "logs" ? "logs" : category;
          const data = { scope, version };
          for (const client of clients) send(client, event, data);
          // Log lines come in bursts and each update redraws the Activity list.
        },
        Math.max(coalesceMs, scope.startsWith("logs:") ? logsMs : 0),
      );
      timer.unref?.();
      pending.set(scope, timer);
    },
    /**
     * Send `event` with what `build` returns when the push is due, so calls in
     * quick succession for one `key` go out as one. Null sends nothing.
     * @param {string} event @param {string} key @param {() => object | null} build
     */
    push(event, key, build) {
      const id = `push ${event} ${key}`;
      if (pending.has(id)) return;
      const timer = setTimeout(() => {
        pending.delete(id);
        const data = build();
        if (data) for (const client of clients) send(client, event, data);
      }, pushMs);
      timer.unref?.();
      pending.set(id, timer);
    },
    clientCount: () => clients.size,
    activeProjects: () => [
      ...new Set([...clients].map((client) => client.project).filter(Boolean)),
    ],
    onClientsChanged(listener) {
      clientListeners.add(listener);
      listener(clients.size);
      return () => clientListeners.delete(listener);
    },
    close() {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      for (const client of clients) client.res.end();
      clients.clear();
    },
  };
}
